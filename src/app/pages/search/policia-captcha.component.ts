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
    <!-- Iframe siempre presente en el DOM cuando visible=true -->
    <ng-container *ngIf="visible">
      <!-- Iframe oculto para los pasos 1 y 2 -->
      <iframe
        *ngIf="estado !== 'captcha'"
        id="policia-iframe"
        [src]="urlSegura"
        style="display:none; width:0; height:0; position:absolute;"
        (load)="onIframeLoad()"
      ></iframe>

      <!-- Modal overlay -->
      <div class="captcha-overlay">
        <div class="captcha-modal">
          <div class="captcha-header">
            <span>🔒 Verificación Policía Nacional</span>
            <button class="btn-cancelar" (click)="cancelar()">✕</button>
          </div>

          <div *ngIf="estado === 'cargando'" class="estado-info">
            <span class="spinner-small"></span> Cargando página de la Policía...
          </div>

          <div *ngIf="estado === 'procesando'" class="estado-info">
            <span class="spinner-small"></span> {{ mensajeEstado }}
          </div>

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
            <p class="captcha-hint">
              💡 Completa el captcha directamente en la ventana de arriba
            </p>
          </div>

          <div *ngIf="estado === 'resultado'" class="estado-info">
            <span class="spinner-small"></span> Obteniendo resultado...
          </div>
        </div>
      </div>
    </ng-container>
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
        max-width: 440px;
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
      .captcha-hint {
        font-size: 0.78rem;
        color: #9ca3af;
        text-align: center;
        margin-top: 10px;
      }
      .estado-info {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 24px;
        color: #6b7280;
        font-size: 0.88rem;
      }
      .iframe-wrapper {
        width: 100%;
        height: 500px;
        overflow: auto;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
      }
      .policia-iframe {
        width: 100%;
        height: 100%;
        border: none;
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
  mensajeEstado = "Procesando...";
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
      console.log("Sin acceso al iframe");
      return;
    }

    const texto = doc.body?.innerText || "";
    console.log(`[carga ${this.cargaCount}] Texto:`, texto.substring(0, 150));

    // Carga 1: aceptar términos
    if (this.cargaCount === 1) {
      const radio = doc.querySelector(
        'input[type="radio"]',
      ) as HTMLInputElement;
      if (radio) {
        console.log("✅ Aceptando términos");
        this.setEstado("procesando", "Aceptando términos...");
        radio.click();
        setTimeout(() => {
          const btn = doc.querySelector(
            'input[type="submit"], button[type="submit"]',
          ) as HTMLElement;
          btn?.click();
        }, 600);
      }
      return;
    }

    // Carga 2: llenar formulario
    if (this.cargaCount === 2) {
      const input = doc.querySelector('input[type="text"]') as HTMLInputElement;
      if (input) {
        console.log("✅ Llenando cédula");
        this.setEstado("procesando", "Llenando formulario...");

        input.focus();
        input.value = this.cedula;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        // Tipo documento
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

        // Clic en Consultar para revelar el captcha
        setTimeout(() => {
          const btnConsultar = Array.from(
            doc.querySelectorAll('button, input[type="submit"]'),
          ).find(
            (el) =>
              el.textContent?.toUpperCase().includes("CONSULT") ||
              (el as HTMLInputElement).value?.toUpperCase().includes("CONSULT"),
          ) as HTMLElement;
          console.log(
            "Botón consultar:",
            btnConsultar?.textContent ||
              (btnConsultar as HTMLInputElement)?.value,
          );
          btnConsultar?.click();

          // Mostrar el iframe completo para que el usuario resuelva el captcha
          setTimeout(() => {
            this.setEstado("captcha");
            this.esperarCaptcha();
          }, 1500);
        }, 800);
      }
      return;
    }

    // Carga 3+: leer resultado
    if (this.cargaCount >= 3) {
      clearInterval(this.intervalo);
      this.setEstado("resultado");
      setTimeout(() => this.leerResultado(doc), 1000);
    }
  }

  private esperarCaptcha() {
    // Cuando el captcha se resuelve, la página hace submit automáticamente
    // Solo necesitamos esperar la siguiente carga del iframe (cargaCount === 3)
    // El intervalo monitorea si grecaptcha ya tiene token por si el submit no es automático
    let checks = 0;
    this.intervalo = setInterval(() => {
      checks++;
      try {
        const doc = this.getDoc();
        const win = doc?.defaultView as any;
        const token = win?.grecaptcha?.getResponse?.();
        if (token && token.length > 0) {
          console.log("✅ Token captcha detectado, enviando...");
          clearInterval(this.intervalo);
          this.setEstado("resultado");
          const btn = doc?.querySelector(
            'input[type="submit"], button[type="submit"]',
          ) as HTMLElement;
          btn?.click();
        }
      } catch (e) {}
      if (checks > 180) clearInterval(this.intervalo);
    }, 1000);
  }

  private leerResultado(doc: Document) {
    const texto = doc.body?.innerText?.toUpperCase() || "";
    console.log("Resultado:", texto.substring(0, 400));

    const tieneAntecedentes =
      texto.includes("REGISTRA ANTECEDENTES") ||
      texto.includes("TIENE ANTECEDENTES");
    const sinAntecedentes =
      texto.includes("NO REGISTRA") ||
      texto.includes("NO SE ENCUENTRAN") ||
      texto.includes("SIN ANTECEDENTES");

    this.zone.run(() => {
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

  private setEstado(
    estado: "cargando" | "procesando" | "captcha" | "resultado",
    msg = "",
  ) {
    this.zone.run(() => {
      this.estado = estado;
      if (msg) this.mensajeEstado = msg;
      this.cdr.detectChanges();
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
