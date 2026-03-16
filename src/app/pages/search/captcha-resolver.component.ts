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

/**
 * CaptchaResolverComponent
 *
 * Flujo:
 *  1. Se muestra un modal indicando que se abrirá una ventana de la Policía
 *  2. Abre un popup con la URL de antecedentes.policia.gov.co
 *  3. La extensión rektcaptcha (instalada en el browser del usuario) resuelve
 *     el reCAPTCHA automáticamente en ese popup
 *  4. El popup extrae el token y lo envía al padre via postMessage
 *  5. Este componente recibe el token, lo envía al backend con el sessionId
 *  6. Emite el resultado final al componente padre
 *
 * IMPORTANTE: El usuario debe tener instalada la extensión rektcaptcha
 * en su navegador para que el captcha se resuelva automáticamente.
 * Sin la extensión, el usuario puede resolverlo manualmente en el popup.
 */
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
            Se abrirá una ventana del portal de la Policía Nacional.<br />
            <strong>Si tienes la extensión rektcaptcha</strong>, el captcha se
            resolverá automáticamente.<br />
            <strong>Si no</strong>, resuélvelo manualmente y la consulta
            continuará sola.
          </p>
        </div>

        <div class="captcha-body">
          <!-- Estado: esperando que el usuario abra el popup -->
          <div *ngIf="estado === 'esperando'" class="captcha-action">
            <button class="btn-abrir" (click)="abrirPopup()">
              🌐 Abrir portal de la Policía
            </button>
            <p class="captcha-hint">
              Una vez resuelto el captcha, esta ventana se actualizará
              automáticamente.
            </p>
          </div>

          <!-- Estado: popup abierto, esperando resolución -->
          <div *ngIf="estado === 'popup-abierto'" class="captcha-loading">
            <span class="spinner"></span>
            Esperando que resuelvas el captcha en la ventana abierta...
            <button class="btn-reabrir" (click)="abrirPopup()">
              🔄 Volver a abrir
            </button>
          </div>

          <!-- Estado: token recibido, consultando backend -->
          <div *ngIf="estado === 'consultando'" class="captcha-loading">
            <span class="spinner"></span>
            Captcha resuelto — consultando antecedentes...
          </div>

          <!-- Estado: error -->
          <div *ngIf="estado === 'error'" class="captcha-error">
            ⚠️ {{ mensajeError }}
            <button class="btn-reintentar" (click)="reintentar()">
              🔄 Reintentar
            </button>
          </div>
        </div>

        <div class="captcha-footer">
          <button
            class="btn-cancelar"
            (click)="cancelar()"
            [disabled]="estado === 'consultando'"
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
        max-width: 460px;
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
        line-height: 1.6;
        margin: 0;
      }
      .captcha-body {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        min-height: 80px;
      }
      .captcha-action {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 100%;
      }
      .btn-abrir {
        padding: 12px 32px;
        background: #4361ee;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
        width: 100%;
      }
      .btn-abrir:hover {
        background: #3451d1;
      }
      .captcha-hint {
        color: #888;
        font-size: 12px;
        text-align: center;
        margin: 0;
      }
      .captcha-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        color: #555;
        font-size: 14px;
        text-align: center;
      }
      .btn-reabrir {
        padding: 8px 20px;
        background: transparent;
        border: 1px solid #4361ee;
        color: #4361ee;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
      }
      .captcha-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        color: #dc3545;
        font-size: 13px;
        text-align: center;
      }
      .btn-reintentar {
        padding: 8px 20px;
        background: #dc3545;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
      }
      .spinner {
        width: 20px;
        height: 20px;
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
  @Input() popupUrl!: string;
  @Input() idType: string = "CC";

  @Output() resuelto = new EventEmitter<any>();
  @Output() cancelado = new EventEmitter<void>();

  estado: "esperando" | "popup-abierto" | "consultando" | "error" = "esperando";
  mensajeError = "";

  private readonly API = "https://modulos-backend.onrender.com";
  private popup: Window | null = null;
  private messageListener: ((e: MessageEvent) => void) | null = null;
  private popupCheckInterval: any = null;

  constructor(
    private http: HttpClient,
    private zone: NgZone,
  ) {}

  ngOnInit() {
    // Escuchar mensajes del popup (el popup envía el token via postMessage)
    this.messageListener = (event: MessageEvent) => {
      // Aceptar mensajes del dominio de la Policía o de cualquier origen
      // (el popup no puede postMessage cross-origin directamente, ver nota abajo)
      if (event.data?.type === "CAPTCHA_TOKEN" && event.data?.token) {
        this.zone.run(() => this.onTokenRecibido(event.data.token));
      }
    };
    window.addEventListener("message", this.messageListener);
  }

  ngOnDestroy() {
    this.limpiar();
  }

  abrirPopup() {
    // Cerrar popup anterior si existe
    if (this.popup && !this.popup.closed) {
      this.popup.close();
    }

    // La URL del popup es la página real de la Policía
    // La extensión rektcaptcha la detecta y resuelve el captcha automáticamente
    const url =
      this.popupUrl ||
      "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";
    this.popup = window.open(
      url,
      "policia_captcha",
      "width=900,height=700,scrollbars=yes",
    );

    if (!this.popup) {
      this.estado = "error";
      this.mensajeError =
        "No se pudo abrir la ventana. Permite las ventanas emergentes para este sitio.";
      return;
    }

    this.estado = "popup-abierto";

    // Polling: verificar si el popup se cerró (el usuario lo cerró manualmente)
    // o si la extensión resolvió el captcha y el popup envió el token
    this.popupCheckInterval = setInterval(() => {
      if (this.popup?.closed) {
        clearInterval(this.popupCheckInterval);
        if (this.estado === "popup-abierto") {
          // El usuario cerró el popup sin resolver el captcha
          this.zone.run(() => {
            this.estado = "esperando";
          });
        }
      }
    }, 1000);
  }

  private onTokenRecibido(token: string) {
    console.log("[CaptchaResolver] Token recibido del popup");
    this.estado = "consultando";

    // Cerrar popup
    if (this.popup && !this.popup.closed) {
      this.popup.close();
    }
    clearInterval(this.popupCheckInterval);

    // Enviar token al backend
    this.http
      .post(`${this.API}/api/consulta-antecedentes`, {
        cedula: this.cedula,
        tipoDocumento: this.idType,
        captchaToken: token,
        sessionId: this.sessionId,
      })
      .subscribe({
        next: (res: any) => {
          this.estado = "consultando";
          this.resuelto.emit(res);
        },
        error: (err) => {
          this.estado = "error";
          this.mensajeError =
            err.error?.detalle || "Error al consultar. Intenta de nuevo.";
        },
      });
  }

  reintentar() {
    this.estado = "esperando";
    this.mensajeError = "";
  }

  cancelar() {
    this.limpiar();
    this.cancelado.emit();
  }

  private limpiar() {
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
    if (this.popupCheckInterval) {
      clearInterval(this.popupCheckInterval);
    }
    if (this.popup && !this.popup.closed) {
      this.popup.close();
    }
  }
}
