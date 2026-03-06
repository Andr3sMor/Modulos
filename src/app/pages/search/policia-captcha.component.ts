import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  NgZone,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpClient } from "@angular/common/http";

@Component({
  selector: "app-policia-captcha",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="overlay" *ngIf="visible">
      <div class="modal">
        <div class="header">
          <span>🚔 Antecedentes Policiales — {{ cedula }}</span>
          <button class="close" (click)="cancelar()">✕</button>
        </div>

        <!-- Cargando -->
        <div
          class="body center"
          *ngIf="status === 'cargando' || status === 'iniciando'"
        >
          <div class="spinner"></div>
          <p>{{ mensajeEstado }}</p>
        </div>

        <!-- Captcha listo: mostrar screenshot -->
        <div class="body" *ngIf="status === 'captcha'">
          <p class="instruccion">
            👆 Haz clic en el checkbox "<strong>No soy un robot</strong>" en la
            imagen:
          </p>
          <div class="screenshot-wrapper" (click)="onClickImagen($event)">
            <img
              [src]="screenshotUrl"
              alt="Formulario de la Policía"
              class="screenshot"
              #screenshotImg
            />
            <div class="click-hint">
              Haz clic directamente sobre el checkbox ▼
            </div>
          </div>
          <p class="nota">
            Si aparece un challenge de imágenes, haz clic en ellas también.
          </p>
        </div>

        <!-- Consultando -->
        <div class="body center" *ngIf="status === 'consultando'">
          <div class="spinner"></div>
          <p>✅ Captcha resuelto. Consultando resultado...</p>
        </div>

        <!-- Error -->
        <div class="body center" *ngIf="status === 'error'">
          <p class="error">❌ {{ mensajeEstado }}</p>
          <button class="btn-retry" (click)="cancelar()">Cerrar</button>
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
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 16px;
      }
      .modal {
        background: white;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
        width: 100%;
        max-width: 720px;
        max-height: 92vh;
        display: flex;
        flex-direction: column;
      }
      .header {
        background: #1a3a5c;
        color: white;
        padding: 14px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
        font-size: 15px;
        flex-shrink: 0;
      }
      .close {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
      }
      .body {
        padding: 20px;
        overflow-y: auto;
      }
      .body.center {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 40px 20px;
      }
      .instruccion {
        margin: 0 0 12px;
        color: #333;
        font-size: 14px;
      }
      .nota {
        margin: 10px 0 0;
        color: #888;
        font-size: 12px;
      }
      .screenshot-wrapper {
        border: 2px solid #1a3a5c;
        border-radius: 8px;
        overflow: hidden;
        cursor: crosshair;
        position: relative;
      }
      .screenshot {
        width: 100%;
        display: block;
      }
      .click-hint {
        background: rgba(26, 58, 92, 0.85);
        color: white;
        font-size: 12px;
        text-align: center;
        padding: 6px;
      }
      .spinner {
        width: 40px;
        height: 40px;
        border: 4px solid #eee;
        border-top-color: #1a3a5c;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 16px;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .error {
        color: #c62828;
        font-weight: 600;
        margin-bottom: 16px;
      }
      .btn-retry {
        background: #1a3a5c;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 10px 24px;
        cursor: pointer;
      }
    `,
  ],
})
export class PoliciaCaptchaComponent implements OnDestroy {
  @Input() cedula = "";
  @Input() visible = false;
  @Output() resultadoObtenido = new EventEmitter<{
    tieneAntecedentes: boolean;
    mensaje: string;
  }>();
  @Output() cancelado = new EventEmitter<void>();

  status = "idle";
  mensajeEstado = "";
  screenshotUrl = "";
  sessionId = "";

  private pollTimer: any = null;
  private screenshotTimer: any = null;

  constructor(
    private http: HttpClient,
    private zone: NgZone,
  ) {}

  ngOnDestroy() {
    this.limpiar();
  }

  // Llamado desde search.component cuando el usuario hace clic en el botón
  iniciar(cedula: string, tipoDocumento: string) {
    this.cedula = cedula;
    this.visible = true;
    this.status = "iniciando";
    this.mensajeEstado = "Aceptando términos y cargando formulario...";

    this.http
      .post<any>("/api/policia/iniciar", { cedula, tipoDocumento })
      .subscribe({
        next: (r) => {
          this.sessionId = r.sessionId;
          this.mensajeEstado = "Llenando formulario...";
          this.status = "cargando";
          this.iniciarPolling();
        },
        error: (e) => {
          this.status = "error";
          this.mensajeEstado = e.error?.error || "Error al iniciar";
        },
      });
  }

  private iniciarPolling() {
    this.pollTimer = setInterval(() => {
      this.http.get<any>(`/api/policia/status/${this.sessionId}`).subscribe({
        next: (r) => {
          this.zone.run(() => {
            this.status = r.status;

            if (r.status === "captcha") {
              clearInterval(this.pollTimer);
              this.mensajeEstado = "Captcha listo";
              this.iniciarScreenshots();
            } else if (r.status === "listo") {
              clearInterval(this.pollTimer);
              this.limpiar();
              this.resultadoObtenido.emit(r.resultado);
              this.visible = false;
            } else if (r.status === "error") {
              clearInterval(this.pollTimer);
              this.mensajeEstado = r.resultado?.error || "Error desconocido";
            }
          });
        },
      });
    }, 1500);
  }

  private iniciarScreenshots() {
    // Actualizar screenshot cada 1.5s mientras el usuario interactúa
    this.actualizarScreenshot();
    this.screenshotTimer = setInterval(() => this.actualizarScreenshot(), 1500);
  }

  private actualizarScreenshot() {
    // Agregar timestamp para evitar caché
    this.screenshotUrl = `/api/policia/screenshot/${this.sessionId}?t=${Date.now()}`;
  }

  onClickImagen(event: MouseEvent) {
    const img = event.target as HTMLImageElement;
    const rect = img.getBoundingClientRect();

    // Calcular coordenadas relativas a la imagen
    const scaleX = 1280 / rect.width;
    const scaleY = 900 / rect.height;
    const x = Math.round((event.clientX - rect.left) * scaleX);
    const y = Math.round((event.clientY - rect.top) * scaleY);

    console.log(`Clic en imagen: (${x}, ${y})`);

    this.http
      .post<any>(`/api/policia/clic/${this.sessionId}`, { x, y })
      .subscribe({
        next: (r) => {
          this.zone.run(() => {
            if (r.tokenObtenido) {
              clearInterval(this.screenshotTimer);
              this.status = "consultando";
              // Continuar polling para obtener resultado final
              this.iniciarPolling();
            } else {
              // Actualizar screenshot para mostrar el challenge de imágenes
              this.actualizarScreenshot();
            }
          });
        },
        error: () => this.actualizarScreenshot(),
      });
  }

  cancelar() {
    this.limpiar();
    this.visible = false;
    this.cancelado.emit();
  }

  private limpiar() {
    clearInterval(this.pollTimer);
    clearInterval(this.screenshotTimer);
    this.status = "idle";
    this.sessionId = "";
    this.screenshotUrl = "";
  }
}
