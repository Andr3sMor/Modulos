import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from "@angular/core";
import { CommonModule } from "@angular/common";

@Component({
  selector: "app-policia-captcha",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="captcha-overlay" *ngIf="visible">
      <div class="captcha-modal">
        <div class="captcha-header">
          <span>🚔 Consulta Antecedentes Policiales</span>
          <button class="close-btn" (click)="cancelar()">✕</button>
        </div>
        <div class="captcha-body">
          <p>
            Para consultar la cédula <strong>{{ cedula }}</strong
            >, verifica que no eres un robot:
          </p>
          <div id="recaptcha-policia" class="recaptcha-container"></div>
          <p class="captcha-hint" *ngIf="!tokenResuelto">
            👆 Haz clic en el checkbox de arriba
          </p>
          <p class="captcha-ok" *ngIf="tokenResuelto">
            ✅ Verificación completada. Consultando...
          </p>
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
        border-radius: 12px;
        padding: 0;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        min-width: 340px;
        overflow: hidden;
      }
      .captcha-header {
        background: #1a3a5c;
        color: white;
        padding: 16px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
      }
      .close-btn {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
      }
      .captcha-body {
        padding: 24px;
        text-align: center;
      }
      .captcha-body p {
        margin: 0 0 16px;
        color: #444;
      }
      .recaptcha-container {
        display: flex;
        justify-content: center;
        margin: 16px 0;
      }
      .captcha-hint {
        color: #888;
        font-size: 13px;
      }
      .captcha-ok {
        color: #2e7d32;
        font-weight: 600;
      }
    `,
  ],
})
export class PoliciaCaptchaComponent implements OnInit, OnDestroy {
  @Input() cedula = "";
  @Input() visible = false;
  @Output() tokenObtenido = new EventEmitter<string>();
  @Output() cancelado = new EventEmitter<void>();

  readonly SITEKEY = "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH";
  tokenResuelto = false;
  private widgetId: number | null = null;

  get grecaptcha(): any {
    return (window as any)["grecaptcha"];
  }

  ngOnInit() {
    this.cargarScript();
  }

  ngOnDestroy() {
    this.resetWidget();
  }

  private cargarScript() {
    if (document.getElementById("recaptcha-script")) {
      this.renderWidget();
      return;
    }
    const script = document.createElement("script");
    script.id = "recaptcha-script";
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => this.renderWidget();
    document.head.appendChild(script);
  }

  private renderWidget() {
    const tryRender = () => {
      const container = document.getElementById("recaptcha-policia");
      if (!container || !this.grecaptcha?.render) {
        setTimeout(tryRender, 300);
        return;
      }
      this.resetWidget();
      this.widgetId = this.grecaptcha.render("recaptcha-policia", {
        sitekey: this.SITEKEY,
        callback: (token: string) => {
          this.tokenResuelto = true;
          setTimeout(() => this.tokenObtenido.emit(token), 500);
        },
        "expired-callback": () => {
          this.tokenResuelto = false;
        },
        "error-callback": () => {
          this.tokenResuelto = false;
        },
      });
    };
    setTimeout(tryRender, 200);
  }

  private resetWidget() {
    if (this.widgetId !== null && this.grecaptcha?.reset) {
      try {
        this.grecaptcha.reset(this.widgetId);
      } catch {}
      this.widgetId = null;
    }
    this.tokenResuelto = false;
  }

  mostrar() {
    this.visible = true;
    this.tokenResuelto = false;
    setTimeout(() => this.renderWidget(), 100);
  }

  cancelar() {
    this.visible = false;
    this.resetWidget();
    this.cancelado.emit();
  }
}
