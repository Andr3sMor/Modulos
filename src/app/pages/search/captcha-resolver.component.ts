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
import { ConsultaService } from "../../services/consulta.service";

/**
 * CaptchaResolverComponent
 *
 * Flujo:
 *  1. Muestra un modal con botón "Abrir portal de la Policía"
 *  2. Abre popup → /api/policia-captcha-bridge/:sessionId (página del backend)
 *  3. Esa página abre la Policía en otra ventana + hace polling del token
 *  4. La extensión rektcaptcha resuelve el captcha en la ventana de la Policía
 *  5. La página bridge detecta el token y lo envía al backend
 *  6. El backend notifica via SSE con el resultado final
 *  7. Este componente recibe el SSE, cierra el popup y emite el resultado
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
            Se abrirá una ventana auxiliar que cargará el portal de la
            Policía.<br />
            <strong>La extensión rektcaptcha</strong> resolverá el captcha
            automáticamente. Esta ventana se actualizará sola cuando termine.
          </p>
        </div>

        <div class="captcha-body">
          <div *ngIf="estado === 'esperando'" class="captcha-action">
            <button class="btn-abrir" (click)="abrirBridge()">
              🌐 Iniciar verificación
            </button>
          </div>

          <div *ngIf="estado === 'abierto'" class="captcha-loading">
            <span class="spinner"></span>
            Resolviendo captcha en la ventana abierta...
            <button class="btn-secundario" (click)="abrirBridge()">
              🔄 Volver a abrir
            </button>
          </div>

          <div *ngIf="estado === 'consultando'" class="captcha-loading">
            <span class="spinner"></span>
            Captcha resuelto — consultando antecedentes...
          </div>

          <div *ngIf="estado === 'error'" class="captcha-error">
            ⚠️ {{ mensajeError }}
            <button class="btn-secundario" (click)="reintentar()">
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
        width: 100%;
        transition: background 0.2s;
      }
      .btn-abrir:hover {
        background: #3451d1;
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
      .btn-secundario {
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
  @Input() sessionId!: string;
  @Input() popupUrl!: string; // /api/policia-captcha-bridge/:sessionId

  @Output() resuelto = new EventEmitter<any>();
  @Output() cancelado = new EventEmitter<void>();

  estado: "esperando" | "abierto" | "consultando" | "error" = "esperando";
  mensajeError = "";

  private popup: Window | null = null;
  private sseSubscription: any = null;
  private popupCheck: any = null;

  constructor(
    private consultaService: ConsultaService,
    private zone: NgZone,
  ) {}

  ngOnInit() {
    // Conectar SSE inmediatamente para escuchar el resultado
    this.sseSubscription = this.consultaService
      .suscribirCaptchaStatus(this.sessionId)
      .subscribe({
        next: (event) => {
          this.zone.run(() => {
            if (event.tipo === "resultado") {
              this.estado = "consultando";
              this.cerrarPopup();
              // Pequeño delay para mostrar "consultando" antes de emitir
              setTimeout(() => this.resuelto.emit(event.datos), 500);
            } else if (event.tipo === "error") {
              this.estado = "error";
              this.mensajeError = event.datos?.error || "Error desconocido.";
              this.cerrarPopup();
            } else if (event.tipo === "captcha_listo") {
              // El usuario confirmó en la bridge page — estado intermedio
              this.estado = "consultando";
            }
          });
        },
        error: () => {
          this.zone.run(() => {
            if (this.estado !== "consultando") {
              this.estado = "error";
              this.mensajeError = "Error de conexión con el servidor.";
            }
          });
        },
      });
  }

  ngOnDestroy() {
    this.limpiar();
  }

  abrirBridge() {
    this.cerrarPopup();

    // popupUrl = https://modulos-backend.onrender.com/api/policia-captcha-bridge/:sessionId
    this.popup = window.open(
      this.popupUrl,
      "policia_bridge",
      "width=560,height=520,scrollbars=no,resizable=no",
    );

    if (!this.popup) {
      this.estado = "error";
      this.mensajeError =
        "No se pudo abrir la ventana. Por favor permite las ventanas emergentes para este sitio.";
      return;
    }

    this.estado = "abierto";

    // Detectar si el usuario cierra el popup manualmente
    this.popupCheck = setInterval(() => {
      if (this.popup?.closed) {
        clearInterval(this.popupCheck);
        this.zone.run(() => {
          if (this.estado === "abierto") {
            this.estado = "esperando";
          }
        });
      }
    }, 1000);
  }

  reintentar() {
    this.estado = "esperando";
    this.mensajeError = "";
  }

  cancelar() {
    this.limpiar();
    this.cancelado.emit();
  }

  private cerrarPopup() {
    clearInterval(this.popupCheck);
    if (this.popup && !this.popup.closed) {
      this.popup.close();
    }
    this.popup = null;
  }

  private limpiar() {
    this.cerrarPopup();
    if (this.sseSubscription) {
      this.sseSubscription.unsubscribe();
      this.sseSubscription = null;
    }
  }
}
