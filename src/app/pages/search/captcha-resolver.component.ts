import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  NgZone,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpClient } from "@angular/common/http";

declare const grecaptcha: any;

@Component({
  selector: "app-captcha-resolver",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="captcha-overlay">
      <div class="captcha-modal">
        <div class="captcha-header">
          <span class="captcha-icon">🛡️</span>
          <h3>Verificación requerida</h3>
          <p>
            El portal de la Policía Nacional requiere verificar que no eres un
            robot. Por favor completa el captcha para continuar.
          </p>
        </div>

        <div class="captcha-body">
          <div id="captcha-container"></div>

          <div *ngIf="error" class="captcha-error">⚠️ {{ error }}</div>

          <div *ngIf="resolviendo" class="captcha-loading">
            <span class="spinner"></span>
            Consultando antecedentes...
          </div>
        </div>

        <div class="captcha-footer">
          <button
            class="btn-cancelar"
            (click)="cancelar()"
            [disabled]="resolviendo"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .captcha-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }

      .captcha-modal {
        background: white;
        border-radius: 16px;
        padding: 32px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .captcha-header {
        text-align: center;
      }

      .captcha-icon {
        font-size: 40px;
      }

      .captcha-header h3 {
        margin: 12px 0 8px;
        font-size: 20px;
        font-weight: 600;
        color: #1a1a2e;
      }

      .captcha-header p {
        color: #666;
        font-size: 14px;
        line-height: 1.5;
        margin: 0;
      }

      .captcha-body {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        min-height: 78px;
      }

      .captcha-error {
        color: #dc3545;
        font-size: 13px;
        text-align: center;
      }

      .captcha-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #555;
        font-size: 14px;
      }

      .spinner {
        width: 18px;
        height: 18px;
        border: 2px solid #ddd;
        border-top-color: #4361ee;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        display: inline-block;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .captcha-footer {
        display: flex;
        justify-content: center;
      }

      .btn-cancelar {
        padding: 10px 28px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: white;
        color: #555;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-cancelar:hover:not(:disabled) {
        background: #f5f5f5;
        border-color: #aaa;
      }

      .btn-cancelar:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class CaptchaResolverComponent implements OnInit, OnDestroy {
  @Input() cedula!: string;
  @Input() sessionId!: string;
  @Input() idType: string = "CC";

  @Output() resuelto = new EventEmitter<any>();
  @Output() cancelado = new EventEmitter<void>();

  resolviendo = false;
  error = "";

  private readonly SITEKEY = "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH";
  private readonly API = "https://modulos-backend.onrender.com";
  private widgetId: number | null = null;

  constructor(
    private http: HttpClient,
    private zone: NgZone,
  ) {}

  ngOnInit() {
    this.cargarCaptcha();
  }

  ngOnDestroy() {
    if (this.widgetId !== null) {
      try {
        grecaptcha.reset(this.widgetId);
      } catch (_) {}
    }
  }

  private cargarCaptcha() {
    const cargar = () => {
      const container = document.getElementById("captcha-container");
      if (!container) return;

      this.widgetId = grecaptcha.render(container, {
        sitekey: this.SITEKEY,
        callback: (token: string) => this.zone.run(() => this.onToken(token)),
        "expired-callback": () =>
          this.zone.run(() => {
            this.error = "El captcha expiró. Por favor inténtalo de nuevo.";
            this.resolviendo = false;
          }),
        "error-callback": () =>
          this.zone.run(() => {
            this.error = "Error al cargar el captcha.";
          }),
      });
    };

    // Si grecaptcha ya está cargado, usarlo directamente
    if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
      setTimeout(cargar, 100);
      return;
    }

    // Si no, cargar el script de Google
    if (!document.getElementById("recaptcha-script")) {
      const script = document.createElement("script");
      script.id = "recaptcha-script";
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => setTimeout(cargar, 300);
      document.head.appendChild(script);
    } else {
      // Script ya existe, esperar a que grecaptcha esté listo
      const interval = setInterval(() => {
        if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
          clearInterval(interval);
          cargar();
        }
      }, 100);
    }
  }

  private onToken(token: string) {
    this.resolviendo = true;
    this.error = "";

    // Enviar el token al backend junto con la cédula
    this.http
      .post(`${this.API}/api/consulta-antecedentes`, {
        cedula: this.cedula,
        id_type: this.idType,
        captchaToken: token,
        sessionId: this.sessionId,
      })
      .subscribe({
        next: (res: any) => {
          this.resolviendo = false;
          this.resuelto.emit(res.data);
        },
        error: (err) => {
          this.resolviendo = false;
          this.error =
            err.error?.detalle || "Error al consultar. Intenta de nuevo.";
          // Reset captcha para que el usuario pueda reintentar
          if (this.widgetId !== null) {
            try {
              grecaptcha.reset(this.widgetId);
            } catch (_) {}
          }
        },
      });
  }

  cancelar() {
    this.cancelado.emit();
  }
}
