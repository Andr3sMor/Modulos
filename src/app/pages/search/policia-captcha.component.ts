import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  ElementRef,
  NgZone,
  AfterViewInit,
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
          <span>🔒 Verificación Policía Nacional</span>
          <button class="btn-cancelar" (click)="cancelar()">✕</button>
        </div>

        <!-- Estado: cargando -->
        <div *ngIf="estado === 'cargando'" class="estado-info">
          <span class="spinner-small"></span> Cargando página de la Policía...
        </div>

        <!-- Estado: procesando automáticamente -->
        <div *ngIf="estado === 'procesando'" class="estado-info">
          <span class="spinner-small"></span> Llenando formulario
          automáticamente...
        </div>

        <!-- Estado: captcha visible — mostrar iframe recortado -->
        <div *ngIf="estado === 'captcha'">
          <p class="captcha-instruccion">
            Resuelve la verificación para continuar:
          </p>
          <div class="iframe-wrapper">
            <iframe
              id="policia-iframe"
              [src]="urlSegura"
              class="policia-iframe"
              (load)="onIframeLoad()"
            ></iframe>
          </div>
        </div>

        <!-- Estado: esperando resultado -->
        <div *ngIf="estado === 'resultado'" class="estado-info">
          <span class="spinner-small"></span> Obteniendo resultado...
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
        background: rgba(0, 0, 0, 0.6);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .captcha-modal {
        background: white;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        max-width: 420px;
        width: 90%;
      }
      .captcha-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        font-weight: 700;
        font-size: 1rem;
        color: #1f2937;
      }
      .captcha-instruccion {
        font-size: 0.85rem;
        color: #6b7280;
        margin-bottom: 12px;
        text-align: center;
      }
      .estado-info {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 20px;
        color: #6b7280;
        font-size: 0.88rem;
      }
      .iframe-wrapper {
        width: 100%;
        height: 120px;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        position: relative;
      }
      .policia-iframe {
        width: 1200px;
        height: 900px;
        transform: scale(0.32) translateX(-860px) translateY(-1200px);
        transform-origin: top left;
        border: none;
        pointer-events: auto;
      }
      .btn-cancelar {
        background: none;
        border: none;
        font-size: 1.1rem;
        cursor: pointer;
        color: #6b7280;
        padding: 4px 8px;
        border-radius: 4px;
        transition: background 0.2s;
      }
      .btn-cancelar:hover {
        background: #f3f4f6;
      }
      .spinner-small {
        width: 16px;
        height: 16px;
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

  urlSegura: SafeResourceUrl;
  estado: "cargando" | "procesando" | "captcha" | "resultado" = "cargando";
  cedula = "";
  tipoDoc = "";
  private cargaCount = 0;
  private intervalo: any;

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
    if (changes["visible"]) {
      if (this.visible) {
        this.estado = "cargando";
        this.cargaCount = 0;
      } else {
        this.limpiar();
      }
    }
  }

  iniciar(cedula: string, tipoDoc: string) {
    this.cedula = cedula;
    this.tipoDoc = tipoDoc;
    this.cargaCount = 0;
    this.estado = "cargando";
  }

  onIframeLoad() {
    this.cargaCount++;
    console.log(`iframe load #${this.cargaCount}`);

    // Pequeño delay para que el DOM del iframe esté listo
    setTimeout(() => this.procesarIframe(), 800);
  }

  private getDoc(): Document | null {
    try {
      const iframe = document.getElementById(
        "policia-iframe",
      ) as HTMLIFrameElement;
      return iframe?.contentDocument || iframe?.contentWindow?.document || null;
    } catch (e) {
      return null;
    }
  }

  private procesarIframe() {
    const doc = this.getDoc();
    if (!doc) {
      console.log("No se pudo acceder al documento del iframe");
      return;
    }

    const texto = doc.body?.innerText || "";
    console.log("Texto iframe (200):", texto.substring(0, 200));

    // Paso 1: aceptar términos
    const radioAcepto = doc.querySelector(
      'input[type="radio"]',
    ) as HTMLInputElement;
    if (radioAcepto && this.cargaCount === 1) {
      console.log("✅ Aceptando términos...");
      this.zone.run(() => {
        this.estado = "procesando";
        this.cdr.detectChanges();
      });
      radioAcepto.click();
      setTimeout(() => {
        const btn = doc.querySelector(
          'input[type="submit"], button[type="submit"]',
        ) as HTMLElement;
        if (btn) btn.click();
      }, 600);
      return;
    }

    // Paso 2: llenar cédula
    const inputDoc = doc.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    if (inputDoc && this.cargaCount === 2) {
      console.log("✅ Llenando cédula:", this.cedula);
      this.zone.run(() => {
        this.estado = "procesando";
        this.cdr.detectChanges();
      });

      inputDoc.focus();
      inputDoc.value = this.cedula;
      inputDoc.dispatchEvent(new Event("input", { bubbles: true }));
      inputDoc.dispatchEvent(new Event("change", { bubbles: true }));

      // Seleccionar tipo doc
      const sel = doc.querySelector("select") as HTMLSelectElement;
      if (sel) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.toUpperCase().includes("CIUDADAN")) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      // Hacer clic en consultar para que aparezca el captcha
      setTimeout(() => {
        const btnConsultar = Array.from(
          doc.querySelectorAll('button, input[type="submit"]'),
        ).find(
          (el) =>
            el.textContent?.toUpperCase().includes("CONSULT") ||
            (el as HTMLInputElement).value?.toUpperCase().includes("CONSULT"),
        ) as HTMLElement;
        if (btnConsultar) {
          console.log("✅ Clic en Consultar");
          btnConsultar.click();
        }
        // Mostrar iframe con captcha después de un momento
        setTimeout(() => {
          this.zone.run(() => {
            this.estado = "captcha";
            this.cdr.detectChanges();
          });
          this.esperarResolucionCaptcha(doc);
        }, 1500);
      }, 800);
      return;
    }

    // Paso 3: resultado final (carga 3+)
    if (this.cargaCount >= 3) {
      console.log("✅ Leyendo resultado...");
      this.zone.run(() => {
        this.estado = "resultado";
        this.cdr.detectChanges();
      });
      setTimeout(() => this.leerResultado(doc), 1000);
    }
  }

  private esperarResolucionCaptcha(doc: Document) {
    // Monitorear cuando el captcha se resuelve y la página recarga
    let checks = 0;
    this.intervalo = setInterval(() => {
      checks++;
      try {
        const win = doc.defaultView as any;
        const token = win?.grecaptcha?.getResponse?.();
        if (token && token.length > 0) {
          console.log("✅ Captcha resuelto, enviando formulario...");
          clearInterval(this.intervalo);
          this.zone.run(() => {
            this.estado = "resultado";
            this.cdr.detectChanges();
          });
          const btn = doc.querySelector(
            'input[type="submit"], button[type="submit"]',
          ) as HTMLElement;
          if (btn) btn.click();
        }
      } catch (e) {}

      if (checks > 120) clearInterval(this.intervalo); // 2 min timeout
    }, 1000);
  }

  private leerResultado(doc: Document) {
    const texto = doc.body?.innerText?.toUpperCase() || "";
    console.log("Resultado texto:", texto.substring(0, 400));

    const tieneAntecedentes =
      texto.includes("REGISTRA ANTECEDENTES") ||
      texto.includes("TIENE ANTECEDENTES");

    const sinAntecedentes =
      texto.includes("NO REGISTRA") ||
      texto.includes("NO SE ENCUENTRAN") ||
      texto.includes("SIN ANTECEDENTES");

    this.zone.run(() => {
      this.visible = false;
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

  cancelar() {
    this.limpiar();
    this.cancelado.emit();
  }

  private limpiar() {
    clearInterval(this.intervalo);
    this.estado = "cargando";
    this.cargaCount = 0;
  }
}
