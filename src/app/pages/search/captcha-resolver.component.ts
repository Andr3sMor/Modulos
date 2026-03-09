import { Component, Input, Output, EventEmitter } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ConsultaService } from "../../services/consulta.service";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";

@Component({
  selector: "app-captcha-resolver",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="visible" class="overlay">
      <div class="modal">
        <div class="modal-header">
          <span>🔒 Verificación requerida — Policía Nacional</span>
          <button class="btn-x" (click)="cancelar()">✕</button>
        </div>

        <div class="instrucciones">
          <p>El sitio de la Policía requiere que resuelvas el captcha.</p>
          <p>
            Haz clic en <strong>"No soy un robot"</strong> y completa el
            desafío:
          </p>
        </div>

        <!-- reCAPTCHA widget real -->
        <div class="captcha-wrapper">
          <div id="recaptcha-manual-container"></div>
        </div>

        <div *ngIf="error" class="error-msg">⚠️ {{ error }}</div>
        <div *ngIf="cargando" class="loading-msg">⏳ Verificando...</div>

        <div class="footer-btns">
          <button
            class="btn-cancelar"
            (click)="cancelar()"
            [disabled]="cargando"
          >
            Cancelar
          </button>
          <button
            class="btn-enviar"
            (click)="enviarToken()"
            [disabled]="cargando || !tokenResuelto"
          >
            {{ cargando ? "Verificando..." : "✅ Enviar verificación" }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .modal {
        background: white;
        border-radius: 12px;
        padding: 24px;
        width: 100%;
        max-width: 420px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 700;
        font-size: 0.95rem;
        color: #1f2937;
      }
      .instrucciones {
        font-size: 0.88rem;
        color: #4b5563;
        line-height: 1.5;
      }
      .instrucciones p {
        margin: 4px 0;
      }
      .captcha-wrapper {
        display: flex;
        justify-content: center;
        min-height: 80px;
      }
      .error-msg {
        color: #dc2626;
        font-size: 0.85rem;
        text-align: center;
      }
      .loading-msg {
        color: #2563eb;
        font-size: 0.85rem;
        text-align: center;
      }
      .footer-btns {
        display: flex;
        gap: 10px;
      }
      .btn-cancelar {
        flex: 1;
        padding: 10px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: white;
        cursor: pointer;
        font-size: 0.9rem;
      }
      .btn-enviar {
        flex: 2;
        padding: 10px;
        border: none;
        border-radius: 8px;
        background: #2563eb;
        color: white;
        font-weight: 700;
        cursor: pointer;
        font-size: 0.9rem;
      }
      .btn-enviar:disabled {
        background: #93c5fd;
        cursor: not-allowed;
      }
      .btn-x {
        background: none;
        border: none;
        font-size: 1.1rem;
        cursor: pointer;
        color: #6b7280;
        padding: 4px 8px;
        border-radius: 4px;
      }
    `,
  ],
})
export class CaptchaResolverComponent {
  @Input() set abrirCon(data: { sessionId: string } | null) {
    if (data) {
      this.sessionId = data.sessionId;
      this.visible = true;
      this.tokenResuelto = "";
      this.error = "";
      this.cargando = false;
      setTimeout(() => this.renderizarRecaptcha(), 300);
    }
  }

  @Output() resuelto = new EventEmitter<any>();
  @Output() cancelado = new EventEmitter<void>();

  visible = false;
  sessionId = "";
  tokenResuelto = "";
  cargando = false;
  error = "";
  private widgetId: any = null;

  constructor(private consultaService: ConsultaService) {}

  private renderizarRecaptcha() {
    const container = document.getElementById("recaptcha-manual-container");
    if (!container) return;
    container.innerHTML = "";

    // Cargar script de reCAPTCHA si no está cargado
    if (!(window as any).grecaptcha) {
      const script = document.createElement("script");
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.onload = () => this.renderWidget(container);
      document.head.appendChild(script);
    } else {
      this.renderWidget(container);
    }
  }

  private renderWidget(container: HTMLElement) {
    try {
      const gc = (window as any).grecaptcha;
      if (!gc?.render) {
        setTimeout(() => this.renderWidget(container), 500);
        return;
      }
      this.widgetId = gc.render(container, {
        sitekey: "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH",
        callback: (token: string) => {
          this.tokenResuelto = token;
          this.error = "";
        },
        "expired-callback": () => {
          this.tokenResuelto = "";
          this.error = "El captcha expiró. Por favor resuélvelo de nuevo.";
        },
      });
    } catch (e) {
      console.error("Error renderizando reCAPTCHA:", e);
    }
  }

  enviarToken() {
    if (!this.tokenResuelto) {
      this.error = "Primero resuelve el captcha.";
      return;
    }
    this.cargando = true;
    this.error = "";

    this.consultaService
      .resolverCaptcha(this.sessionId, this.tokenResuelto)
      .subscribe({
        next: (resultado) => {
          this.cargando = false;
          this.visible = false;
          this.resuelto.emit(resultado);
        },
        error: (err) => {
          this.cargando = false;
          this.error =
            err.error?.detalle || "Error al verificar. Intenta de nuevo.";
          // Resetear captcha
          (window as any).grecaptcha?.reset(this.widgetId);
          this.tokenResuelto = "";
        },
      });
  }

  cancelar() {
    this.visible = false;
    this.tokenResuelto = "";
    this.error = "";
    this.cancelado.emit();
  }
}
