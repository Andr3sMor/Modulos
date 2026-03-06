import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  ViewChild,
  ElementRef,
  NgZone,
} from "@angular/core";
import { CommonModule } from "@angular/common";

@Component({
  selector: "app-policia-captcha",
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Iframe oculto de la Policía -->
    <iframe
      #policiaFrame
      *ngIf="visible"
      [src]="urlPolicia"
      style="display:none; width:0; height:0;"
      (load)="onIframeLoad()"
    ></iframe>

    <!-- Modal visible solo cuando hay captcha -->
    <div *ngIf="visible && mostrarCaptcha" class="captcha-overlay">
      <div class="captcha-modal">
        <div class="captcha-header">
          <span>🔒 Verificación requerida</span>
          <button class="btn-cancelar" (click)="cancelar()">✕</button>
        </div>
        <p class="captcha-instruccion">
          Resuelve la verificación para consultar los antecedentes
        </p>
        <!-- Contenedor donde se moverá el widget real de reCAPTCHA del iframe -->
        <div #captchaContainer class="captcha-container"></div>
        <p *ngIf="esperandoResultado" class="captcha-espera">
          <span class="spinner-small"></span> Procesando...
        </p>
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
        background: rgba(0, 0, 0, 0.5);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .captcha-modal {
        background: white;
        border-radius: 12px;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        max-width: 400px;
        width: 90%;
      }
      .captcha-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        font-weight: 700;
        font-size: 1rem;
        color: #1f2937;
      }
      .captcha-instruccion {
        font-size: 0.85rem;
        color: #6b7280;
        margin-bottom: 20px;
      }
      .captcha-container {
        display: flex;
        justify-content: center;
        min-height: 78px;
        margin-bottom: 16px;
      }
      .btn-cancelar {
        background: none;
        border: none;
        font-size: 1.1rem;
        cursor: pointer;
        color: #6b7280;
        padding: 4px 8px;
      }
      .captcha-espera {
        text-align: center;
        color: #6b7280;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .spinner-small {
        width: 14px;
        height: 14px;
        border: 2px solid #e5e7eb;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        display: inline-block;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
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

  @ViewChild("policiaFrame") frameRef!: ElementRef<HTMLIFrameElement>;
  @ViewChild("captchaContainer") containerRef!: ElementRef<HTMLDivElement>;

  urlPolicia =
    "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";
  mostrarCaptcha = false;
  esperandoResultado = false;
  cedula = "";
  tipoDoc = "";

  private intentos = 0;
  private intervalo: any;

  constructor(private zone: NgZone) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes["visible"] && !this.visible) {
      this.limpiar();
    }
  }

  iniciar(cedula: string, tipoDoc: string) {
    this.cedula = cedula;
    this.tipoDoc = tipoDoc;
    this.intentos = 0;
    this.mostrarCaptcha = false;
    this.esperandoResultado = false;
  }

  onIframeLoad() {
    try {
      const doc =
        this.frameRef.nativeElement.contentDocument ||
        this.frameRef.nativeElement.contentWindow?.document;
      if (!doc) return;

      // Paso 1: aceptar términos automáticamente si están presentes
      const radioAcepto =
        (doc.querySelector(
          'input[type="radio"][value="S"]',
        ) as HTMLInputElement) ||
        (doc.querySelector('input[type="radio"]') as HTMLInputElement);
      if (radioAcepto) {
        radioAcepto.click();
        setTimeout(() => {
          const btnEnviar = doc.querySelector(
            'input[type="submit"], button[type="submit"]',
          ) as HTMLElement;
          if (btnEnviar) btnEnviar.click();
        }, 500);
        return;
      }

      // Paso 2: llenar cédula si el formulario está visible
      const inputCedula = doc.querySelector(
        'input[id*="cedula"], input[name*="cedula"], input[id*="documento"], input[type="text"]',
      ) as HTMLInputElement;
      if (inputCedula && this.cedula) {
        inputCedula.value = this.cedula;
        inputCedula.dispatchEvent(new Event("input", { bubbles: true }));
        inputCedula.dispatchEvent(new Event("change", { bubbles: true }));

        // Buscar y llenar tipo de documento si existe
        const selectTipo = doc.querySelector("select") as HTMLSelectElement;
        if (selectTipo) {
          Array.from(selectTipo.options).forEach((opt, idx) => {
            if (opt.text.toUpperCase().includes("CIUDADAN")) {
              selectTipo.selectedIndex = idx;
              selectTipo.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
        }

        // Esperar a que aparezca el captcha
        this.esperarCaptcha(doc);
        return;
      }

      // Paso 3: detectar resultado final
      this.detectarResultado(doc);
    } catch (e) {
      console.error("Error manipulando iframe:", e);
    }
  }

  private esperarCaptcha(doc: Document) {
    this.intentos = 0;
    this.intervalo = setInterval(() => {
      this.intentos++;

      // Buscar el widget de reCAPTCHA
      const captchaWidget = doc.querySelector(
        '.g-recaptcha, iframe[src*="recaptcha"]',
      ) as HTMLElement;
      if (captchaWidget) {
        clearInterval(this.intervalo);
        this.zone.run(() => {
          this.mostrarCaptcha = true;
          setTimeout(() => this.moverCaptcha(doc, captchaWidget), 100);
        });
        return;
      }

      // Buscar botón consultar y hacer clic para que aparezca el captcha
      if (this.intentos === 3) {
        const btnConsultar = doc.querySelector(
          'input[type="submit"], button[type="submit"], button',
        ) as HTMLElement;
        if (btnConsultar) btnConsultar.click();
      }

      if (this.intentos > 30) {
        clearInterval(this.intervalo);
        // Sin captcha — intentar leer resultado directo
        this.detectarResultado(doc);
      }
    }, 500);
  }

  private moverCaptcha(doc: Document, widget: HTMLElement) {
    try {
      // Clonar el widget de reCAPTCHA al modal visible
      const clone = widget.cloneNode(true) as HTMLElement;
      if (this.containerRef?.nativeElement) {
        this.containerRef.nativeElement.innerHTML = "";
        this.containerRef.nativeElement.appendChild(clone);
      }

      // Monitorear cuando el captcha es resuelto en el iframe original
      this.intervalo = setInterval(() => {
        try {
          const token = (doc.defaultView as any)?.grecaptcha?.getResponse?.();
          if (token) {
            clearInterval(this.intervalo);
            this.zone.run(() => {
              this.esperandoResultado = true;
            });

            // Hacer clic en el botón de consulta con el token ya resuelto
            const btn = doc.querySelector(
              'input[type="submit"], button[type="submit"]',
            ) as HTMLElement;
            if (btn) btn.click();

            // Esperar resultado
            setTimeout(() => this.leerResultadoFinal(doc), 3000);
          }
        } catch (e) {}
      }, 1000);
    } catch (e) {
      console.error("Error moviendo captcha:", e);
    }
  }

  private leerResultadoFinal(doc: Document) {
    const texto = doc.body?.innerText?.toUpperCase() || "";
    const tieneAntecedentes =
      texto.includes("REGISTRA ANTECEDENTES") ||
      texto.includes("TIENE ANTECEDENTES") ||
      texto.includes("SE ENCUENTRAN ANTECEDENTES");

    const sinAntecedentes =
      texto.includes("NO REGISTRA") ||
      texto.includes("NO SE ENCUENTRAN") ||
      texto.includes("SIN ANTECEDENTES");

    this.zone.run(() => {
      this.mostrarCaptcha = false;
      this.esperandoResultado = false;
      this.resultadoObtenido.emit({
        tieneAntecedentes,
        mensaje: tieneAntecedentes
          ? "La persona REGISTRA antecedentes judiciales."
          : sinAntecedentes
            ? "La persona NO registra antecedentes judiciales."
            : "Consulta completada. Verifique en la página oficial.",
      });
    });
  }

  private detectarResultado(doc: Document) {
    const texto = doc.body?.innerText?.toUpperCase() || "";
    if (
      texto.includes("ANTECEDENTES") ||
      texto.includes("REGISTRA") ||
      texto.includes("JUDICIAL")
    ) {
      this.leerResultadoFinal(doc);
    }
  }

  cancelar() {
    this.limpiar();
    this.cancelado.emit();
  }

  private limpiar() {
    clearInterval(this.intervalo);
    this.mostrarCaptcha = false;
    this.esperandoResultado = false;
    this.intentos = 0;
  }
}
