import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  NgZone,
  ChangeDetectorRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";

@Component({
  selector: "app-policia-captcha",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="visible" class="captcha-overlay">
      <div class="captcha-modal">
        <div class="captcha-header">
          <span>🔒 Antecedentes Policiales</span>
          <button class="btn-cancelar" (click)="cancelar()">✕</button>
        </div>

        <!-- Instrucciones -->
        <div *ngIf="!resultadoManual" class="instrucciones">
          <div class="paso">
            <span class="paso-num">1</span>
            <span>Acepta los términos y condiciones</span>
          </div>
          <div class="paso">
            <span class="paso-num">2</span>
            <span
              >Ingresa la cédula: <strong>{{ cedula }}</strong></span
            >
          </div>
          <div class="paso">
            <span class="paso-num">3</span>
            <span>Resuelve el captcha y haz clic en Consultar</span>
          </div>
          <div class="paso">
            <span class="paso-num">4</span>
            <span>Selecciona el resultado obtenido abajo</span>
          </div>
        </div>

        <!-- Iframe de la Policía -->
        <div *ngIf="!resultadoManual" class="iframe-wrapper">
          <iframe [src]="urlSegura" class="policia-iframe"></iframe>
        </div>

        <!-- Botones de resultado manual -->
        <div *ngIf="!resultadoManual" class="botones-resultado">
          <p class="resultado-label">¿Qué resultado obtuviste?</p>
          <div class="botones-row">
            <button
              class="btn-sin-antecedentes"
              (click)="reportarResultado(false)"
            >
              ✅ Sin antecedentes
            </button>
            <button
              class="btn-con-antecedentes"
              (click)="reportarResultado(true)"
            >
              ⚠️ Con antecedentes
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .captcha-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        box-sizing: border-box;
      }
      .captcha-modal {
        background: white;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        width: 100%;
        max-width: 700px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .captcha-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 700;
        font-size: 1rem;
        color: #1f2937;
      }
      .instrucciones {
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #f0f9ff;
        border-radius: 8px;
        padding: 12px;
      }
      .paso {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.85rem;
        color: #374151;
      }
      .paso-num {
        background: #2563eb;
        color: white;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        font-weight: 700;
        flex-shrink: 0;
      }
      .iframe-wrapper {
        flex: 1;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #e5e7eb;
        min-height: 420px;
      }
      .policia-iframe {
        width: 100%;
        height: 100%;
        min-height: 420px;
        border: none;
      }
      .botones-resultado {
        border-top: 1px solid #e5e7eb;
        padding-top: 14px;
      }
      .resultado-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #374151;
        margin-bottom: 10px;
        text-align: center;
      }
      .botones-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .btn-sin-antecedentes {
        padding: 12px;
        border: none;
        border-radius: 8px;
        background: #dcfce7;
        color: #166534;
        font-weight: 700;
        font-size: 0.88rem;
        cursor: pointer;
        transition: background 0.2s;
      }
      .btn-sin-antecedentes:hover {
        background: #bbf7d0;
      }
      .btn-con-antecedentes {
        padding: 12px;
        border: none;
        border-radius: 8px;
        background: #fee2e2;
        color: #991b1b;
        font-weight: 700;
        font-size: 0.88rem;
        cursor: pointer;
        transition: background 0.2s;
      }
      .btn-con-antecedentes:hover {
        background: #fecaca;
      }
      .btn-cancelar {
        background: none;
        border: none;
        font-size: 1.1rem;
        cursor: pointer;
        color: #6b7280;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .btn-cancelar:hover {
        background: #f3f4f6;
      }
    `,
  ],
})
export class PoliciaCaptchaComponent implements OnChanges {
  @Input() visible = false;
  @Output() resultadoObtenido = new EventEmitter<{
    tieneAntecedentes: boolean;
    mensaje: string;
  }>();
  @Output() cancelado = new EventEmitter<void>();

  urlSegura: SafeResourceUrl;
  cedula = "";
  tipoDoc = "";
  resultadoManual = false;

  constructor(
    private zone: NgZone,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
  ) {
    this.urlSegura = this.sanitizer.bypassSecurityTrustResourceUrl(
      "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml",
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes["visible"] && !this.visible) {
      this.resultadoManual = false;
    }
  }

  iniciar(cedula: string, tipoDoc: string) {
    this.cedula = cedula;
    this.tipoDoc = tipoDoc;
    this.resultadoManual = false;
  }

  reportarResultado(tieneAntecedentes: boolean) {
    this.zone.run(() => {
      this.resultadoObtenido.emit({
        tieneAntecedentes,
        mensaje: tieneAntecedentes
          ? "La persona REGISTRA antecedentes judiciales."
          : "La persona NO registra antecedentes judiciales.",
      });
    });
  }

  cancelar() {
    this.resultadoManual = false;
    this.cancelado.emit();
  }
}
