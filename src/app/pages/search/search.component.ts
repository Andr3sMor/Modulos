import { Component, NgZone, ChangeDetectorRef } from "@angular/core";
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
  tipoDocumento: string = "Cédula de Ciudadanía";
  resultado: any = null;
  cargando = false;
  error = "";
  mostrarCaptchaPolicia = false;
  cedulaParaCaptcha = "";

  tiposDocumento = [
    "Cédula de Ciudadanía",
    "Cédula de Extranjería",
    "Pasaporte",
    "Registro Civil",
    "Tarjeta de Identidad",
    "Permiso Especial de Permanencia",
  ];

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
        console.log("✅ Respuesta recibida:", res);
        console.log("cargando antes:", this.cargando);
        this.zone.run(() => {
          this.resultado = {
            fuente: res.fuente,
            data: {
              vigencia: res.data?.vigencia,
              codigo: res.data?.codigo,
              fecha: res.data?.fecha || new Date().toLocaleString(),
            },
          };
          this.cargando = false;
          this.cdr.detectChanges();
          console.log("cargando después:", this.cargando);
          console.log("resultado:", this.resultado);
        });
      },
      error: (err) => {
        console.log("❌ Error:", err);
        this.zone.run(() => {
          this.manejarError(err.error?.error || "Error en Registraduría");
          this.cdr.detectChanges();
        });
      },
    });
  }

  consultarContador() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.verificarContador(this.cedula).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.resultado = {
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
        this.zone.run(() => {
          this.manejarError(
            err.error?.error || "Error en consulta de Contador",
          );
          this.cdr.detectChanges();
        }),
    });
  }

  consultarAntecedentes() {
    if (!this.cedula) return;
    this.cedulaParaCaptcha = this.cedula;
    this.mostrarCaptchaPolicia = true;
  }

  onTokenCaptcha(token: string) {
    this.mostrarCaptchaPolicia = false;
    this.prepararConsulta();
    this.consultaService
      .consultarAntecedentesConToken(this.cedula, this.tipoDocumento, token)
      .subscribe({
        next: (res) => {
          this.resultado = {
            /* igual que antes */
          };
          this.cargando = false;
        },
        error: (err) =>
          this.manejarError(err.error?.error || "Error al consultar"),
      });
  }

  onCaptchaCancelado() {
    this.mostrarCaptchaPolicia = false;
  }

  private prepararConsulta() {
    this.cargando = true;
    this.error = "";
    this.resultado = null;
  }

  private manejarError(msg: string) {
    this.error = msg;
    this.cargando = false;
  }
}
