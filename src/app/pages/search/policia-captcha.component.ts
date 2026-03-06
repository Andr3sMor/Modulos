import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

@Component({
  selector: "app-policia-captcha",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="captcha-overlay" *ngIf="visible">
      <div class="captcha-modal">
        <div class="captcha-header">
          <span>🚔 Consulta Antecedentes Policiales</span>
          <button class="close-btn" (click)="cancelar()">✕</button>
        </div>

        <div class="captcha-body">
          <!-- PASO 1: Instrucciones -->
          <div class="step" *ngIf="!resuelto">
            <div class="step-num">
              Cédula a consultar: <strong>{{ cedula }}</strong>
            </div>

            <div class="instructions">
              <div class="step-item">
                <span class="step-badge">1</span>
                <span
                  >Haz clic en el botón de abajo para abrir el sitio de la
                  Policía</span
                >
              </div>
              <div class="step-item">
                <span class="step-badge">2</span>
                <span
                  >Acepta los términos → selecciona
                  <strong>Cédula de Ciudadanía</strong> → ingresa
                  <strong>{{ cedula }}</strong></span
                >
              </div>
              <div class="step-item">
                <span class="step-badge">3</span>
                <span
                  >Resuelve el reCAPTCHA y haz clic en
                  <strong>Consultar</strong></span
                >
              </div>
              <div class="step-item">
                <span class="step-badge">4</span>
                <span>Copia el resultado y pégalo abajo</span>
              </div>
            </div>

            <button class="btn-abrir" (click)="abrirSitioPolicia()">
              🔗 Abrir sitio de la Policía
            </button>

            <div class="separator">
              <span>Luego pega el resultado aquí</span>
            </div>

            <textarea
              [(ngModel)]="textoRespuesta"
              placeholder="Pega el texto del resultado, ej: 'La persona consultada NO REGISTRA antecedentes...'"
              rows="4"
            >
            </textarea>

            <button
              class="btn-confirmar"
              (click)="confirmarManual()"
              [disabled]="!textoRespuesta.trim()"
            >
              ✅ Confirmar resultado
            </button>
          </div>

          <!-- PASO 2: Confirmado -->
          <div class="done" *ngIf="resuelto">
            <div class="done-icon">✅</div>
            <p>Resultado capturado. Procesando...</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .captcha-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 16px;
      }
      .captcha-modal {
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        width: 100%;
        max-width: 500px;
        overflow: hidden;
      }
      .captcha-header {
        background: #1a3a5c;
        color: white;
        padding: 14px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
      }
      .close-btn {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
      }
      .captcha-body {
        padding: 20px;
      }
      .step-num {
        font-size: 14px;
        color: #555;
        margin-bottom: 16px;
      }
      .instructions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
      }
      .step-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 13px;
        color: #444;
      }
      .step-badge {
        background: #1a3a5c;
        color: white;
        border-radius: 50%;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .btn-abrir {
        width: 100%;
        background: #1565c0;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 12px;
        font-size: 15px;
        cursor: pointer;
        font-weight: 600;
      }
      .btn-abrir:hover {
        background: #1976d2;
      }
      .separator {
        text-align: center;
        color: #999;
        font-size: 12px;
        margin: 16px 0 12px;
        position: relative;
      }
      .separator::before,
      .separator::after {
        content: "";
        position: absolute;
        top: 50%;
        width: 35%;
        height: 1px;
        background: #ddd;
      }
      .separator::before {
        left: 0;
      }
      .separator::after {
        right: 0;
      }
      textarea {
        width: 100%;
        border: 1px solid #ccc;
        border-radius: 8px;
        padding: 10px;
        font-size: 13px;
        resize: vertical;
        box-sizing: border-box;
        margin-bottom: 12px;
        font-family: inherit;
      }
      textarea:focus {
        outline: none;
        border-color: #1a3a5c;
      }
      .btn-confirmar {
        width: 100%;
        background: #2e7d32;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 12px;
        font-size: 14px;
        cursor: pointer;
        font-weight: 600;
      }
      .btn-confirmar:disabled {
        background: #aaa;
        cursor: not-allowed;
      }
      .btn-confirmar:not(:disabled):hover {
        background: #388e3c;
      }
      .done {
        text-align: center;
        padding: 20px 0;
      }
      .done-icon {
        font-size: 48px;
        margin-bottom: 10px;
      }
      .done p {
        color: #2e7d32;
        font-weight: 600;
        font-size: 16px;
      }
    `,
  ],
})
export class PoliciaCaptchaComponent implements OnDestroy {
  @Input() cedula = "";
  @Input() visible = false;
  @Output() resultadoObtenido = new EventEmitter<{
    tieneAntecedentes: boolean;
    texto: string;
  }>();
  @Output() cancelado = new EventEmitter<void>();

  resuelto = false;
  textoRespuesta = "";

  ngOnDestroy() {
    this.reset();
  }

  abrirSitioPolicia() {
    window.open(
      "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml",
      "_blank",
      "width=900,height=700,scrollbars=yes",
    );
  }

  confirmarManual() {
    const texto = this.textoRespuesta.trim();
    if (!texto) return;
    this.resuelto = true;

    const upper = texto.toUpperCase();
    const noRegistra =
      upper.includes("NO REGISTRA") ||
      upper.includes("SIN ANTECEDENTES") ||
      upper.includes("NO PRESENTA");
    const registra =
      upper.includes("REGISTRA") ||
      upper.includes("ANTECEDENTES") ||
      upper.includes("CONDENA");

    setTimeout(() => {
      this.resultadoObtenido.emit({
        tieneAntecedentes: registra && !noRegistra,
        texto,
      });
      this.visible = false;
    }, 600);
  }

  cancelar() {
    this.visible = false;
    this.reset();
    this.cancelado.emit();
  }

  private reset() {
    this.resuelto = false;
    this.textoRespuesta = "";
  }
}
