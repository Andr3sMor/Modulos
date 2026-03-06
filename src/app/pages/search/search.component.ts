import { Component, ViewChild, NgZone, ChangeDetectorRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConsultaService } from "../../services/consulta.service";
import { PoliciaCaptchaComponent } from "./policia-captcha.component";

@Component({
  selector: "app-search",
  standalone: true,
  imports: [CommonModule, FormsModule, PoliciaCaptchaComponent],
  templateUrl: "./search.component.html",
  styleUrls: ["./search.component.css"],
})
export class SearchComponent {
  cedula = "";
  nombre = "";
  resultado: any = null;
  cargando = false;
  error = "";

  tipoDocumento = "Cédula de Ciudadanía";
  tiposDocumento = [
    "Cédula de Ciudadanía",
    "Cédula de Extranjería",
    "Pasaporte",
    "Documento País Origen",
  ];

  mostrarCaptchaPolicia = false;

  @ViewChild(PoliciaCaptchaComponent) captchaComp!: PoliciaCaptchaComponent;

  constructor(
    private consultaService: ConsultaService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  consultarCedula() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.verificarCedula(this.cedula).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.resultado = {
            ...res,
            fuente: "Registraduría Nacional",
            data: res.data || {},
          };
          this.cargando = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) =>
        this.zone.run(() =>
          this.manejarError(err.error?.error || "Error en Registraduría"),
        ),
    });
  }

  consultarContador() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.verificarContador(this.cedula).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.resultado = {
            ...res,
            fuente: "Junta Central de Contadores",
            data: {
              vigencia: res.esContador
                ? "CONTADOR PÚBLICO"
                : "No es contador o no encontrado",
              fecha: new Date().toLocaleString(),
            },
          };
          this.cargando = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) =>
        this.zone.run(() =>
          this.manejarError(
            err.error?.error || "Error en consulta de Contador",
          ),
        ),
    });
  }

  consultarAntecedentes() {
    if (!this.cedula) return;
    this.error = "";
    this.resultado = null;
    this.mostrarCaptchaPolicia = true;
    setTimeout(() => {
      this.captchaComp.iniciar(this.cedula, this.tipoDocumento);
    }, 100);
  }

  onResultadoPolicia(evento: { tieneAntecedentes: boolean; mensaje: string }) {
    this.mostrarCaptchaPolicia = false;
    this.resultado = {
      fuente: "Policía Nacional de Colombia",
      tieneAntecedentes: evento.tieneAntecedentes,
      data: {
        vigencia: evento.mensaje,
        fecha: new Date().toLocaleString(),
        cedula: this.cedula,
      },
    };
  }

  onCaptchaCancelado() {
    this.mostrarCaptchaPolicia = false;
  }

  consultarProcuraduria() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.consultarProcuraduria(this.cedula).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.resultado = {
            fuente: "Procuraduría General de la Nación",
            tieneAntecedentes: res.tieneAntecedentes,
            data: {
              vigencia: res.mensaje,
              detalle: res.detalle || "",
              fecha: new Date().toLocaleString(),
              cedula: res.cedula,
            },
          };
          this.cargando = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) =>
        this.zone.run(() =>
          this.manejarError(
            err.error?.error || "Error al consultar Procuraduría",
          ),
        ),
    });
  }

  consultarOffshore() {
    if (!this.nombre) return;
    this.prepararConsulta();
    this.consultaService.consultarOffshore(this.nombre).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.resultado = {
            fuente: "ICIJ Offshore Leaks",
            tieneRegistros: res.tieneRegistros,
            totalResultados: res.totalResultados,
            resultadosOffshore: res.resultados || [],
            data: {
              vigencia: res.tieneRegistros
                ? `Se encontraron ${res.totalResultados} registro(s)`
                : "No se encontraron registros en bases de datos offshore",
              fecha: new Date().toLocaleString(),
            },
          };
          this.cargando = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) =>
        this.zone.run(() =>
          this.manejarError(
            err.error?.error || "Error al consultar Offshore Leaks",
          ),
        ),
    });
  }

  prepararConsulta() {
    this.cargando = true;
    this.error = "";
    this.resultado = null;
  }

  private manejarError(msg: string) {
    this.error = msg;
    this.cargando = false;
  }
}
