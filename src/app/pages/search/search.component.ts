import { Component } from "@angular/core";
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
  cedula: string = "";
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

  // Policía
  mostrarCaptchaPolicia = false;
  cedulaParaCaptcha = "";

  constructor(private consultaService: ConsultaService) {}

  // ── Registraduría ──────────────────────────────────────────────────
  consultarCedula() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.verificarCedula(this.cedula).subscribe({
      next: (res: any) => {
        this.resultado = {
          ...res,
          fuente: "Registraduría Nacional",
          data: res.data || {},
        };
        this.cargando = false;
      },
      error: (err) =>
        this.manejarError(err.error?.error || "Error en Registraduría"),
    });
  }

  // ── Junta Central de Contadores ────────────────────────────────────
  consultarContador() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.verificarContador(this.cedula).subscribe({
      next: (res: any) => {
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
      },
      error: (err) =>
        this.manejarError(err.error?.error || "Error en consulta de Contador"),
    });
  }

  // ── Policía Nacional ───────────────────────────────────────────────
  consultarAntecedentes() {
    if (!this.cedula) return;
    this.cedulaParaCaptcha = this.cedula;
    this.mostrarCaptchaPolicia = true;
  }

  onResultadoPolicia(evento: { tieneAntecedentes: boolean; texto: string }) {
    this.mostrarCaptchaPolicia = false;
    this.resultado = {
      fuente: "Policía Nacional de Colombia",
      tieneAntecedentes: evento.tieneAntecedentes,
      data: {
        vigencia: evento.tieneAntecedentes
          ? "La persona REGISTRA antecedentes judiciales."
          : "La persona NO registra antecedentes judiciales.",
        detalle: evento.texto,
        fecha: new Date().toLocaleString(),
        cedula: this.cedula,
      },
    };
  }

  onCaptchaCancelado() {
    this.mostrarCaptchaPolicia = false;
  }

  // ── Procuraduría ───────────────────────────────────────────────────
  consultarProcuraduria() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.consultarProcuraduria(this.cedula).subscribe({
      next: (res: any) => {
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
      },
      error: (err) =>
        this.manejarError(
          err.error?.error || "Error al consultar Procuraduría",
        ),
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────
  prepararConsulta() {
    if (!this.cedula) return;
    this.cargando = true;
    this.error = "";
    this.resultado = null;
  }

  private manejarError(msg: string) {
    this.error = msg;
    this.cargando = false;
  }
}
