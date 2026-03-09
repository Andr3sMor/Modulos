import { Component, ViewChild, NgZone, ChangeDetectorRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConsultaService } from "../../services/consulta.service";
import { CaptchaResolverComponent } from "./captcha-resolver.component";

@Component({
  selector: "app-search",
  standalone: true,
  imports: [CommonModule, FormsModule, CaptchaResolverComponent],
  templateUrl: "./search.component.html",
  styleUrls: ["./search.component.css"],
})
export class SearchComponent {
  cedula = "";
  nombre = "";
  cargando = false;
  error = "";
  resultados: any[] = [];
  mostrarCaptchaPolicia = false;
  tabOffshoreActivo: { [key: string]: string } = {};

  tipoDocumento = "Cédula de Ciudadanía";
  tiposDocumento = [
    "Cédula de Ciudadanía",
    "Cédula de Extranjería",
    "Pasaporte",
    "Documento País Origen",
  ];

  servicios = [
    { id: "registraduria", nombre: "Registraduría", activo: true },
    { id: "contador", nombre: "Contador JCC", activo: false },
    { id: "antecedentes", nombre: "Policía", activo: false },
    { id: "procuraduria", nombre: "Procuraduría", activo: false }, // ✅ NUEVO
    { id: "offshore", nombre: "Offshore ICIJ", activo: false },
  ];

  @ViewChild(CaptchaResolverComponent) captchaComp!: CaptchaResolverComponent;

  constructor(
    private consultaService: ConsultaService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  ejecutarConsulta() {
    const activos = this.servicios.filter((s) => s.activo);
    if (!activos.length) {
      this.error = "Selecciona al menos un servicio.";
      return;
    }
    if (!this.cedula && !this.nombre) {
      this.error = "Ingresa al menos un dato de búsqueda.";
      return;
    }

    this.error = "";
    this.resultados = [];
    this.cargando = true;

    const tareas = activos.map((s) => this.llamarServicio(s.id));
    Promise.allSettled(tareas).then(() => {
      this.zone.run(() => {
        this.cargando = false;
        this.cdr.detectChanges();
      });
    });
  }

  private llamarServicio(id: string): Promise<void> {
    return new Promise((resolve) => {
      switch (id) {
        case "registraduria":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService.verificarCedula(this.cedula).subscribe({
            next: (res: any) => {
              this.zone.run(() => {
                this.resultados.push({
                  tipo: "registraduria",
                  fuente: "Registraduría Nacional",
                  data: {
                    vigencia: res.data?.vigencia || res.vigencia,
                    codigo: res.data?.codigo,
                    fecha: new Date().toLocaleString(),
                  },
                });
                this.cdr.detectChanges();
                resolve();
              });
            },
            error: (err: any) => {
              this.zone.run(() => {
                this.agregarError("Registraduría", err);
                resolve();
              });
            },
          });
          break;

        case "contador":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService.verificarContador(this.cedula).subscribe({
            next: (res: any) => {
              this.zone.run(() => {
                this.resultados.push({
                  tipo: "contador",
                  fuente: "Junta Central de Contadores",
                  esContador: res.esContador,
                  data: { fecha: new Date().toLocaleString() },
                });
                this.cdr.detectChanges();
                resolve();
              });
            },
            error: (err: any) => {
              this.zone.run(() => {
                this.agregarError("Contador JCC", err);
                resolve();
              });
            },
          });
          break;

        case "antecedentes":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.error = "";
          this.mostrarCaptchaPolicia = true;
          setTimeout(() => {}, 100);
          resolve();
          break;

        // ✅ NUEVO: Procuraduría
        case "procuraduria":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService
            .consultarProcuraduria(this.cedula, this.tipoDocumento)
            .subscribe({
              next: (res: any) => {
                this.zone.run(() => {
                  this.resultados.push({
                    tipo: "procuraduria",
                    fuente: "Procuraduría General de la Nación",
                    tieneSanciones: res.tieneSanciones,
                    sinSanciones: res.sinSanciones,
                    mensaje: res.mensaje,
                    certificadoUrl: res.certificadoUrl,
                    data: { fecha: new Date().toLocaleString() },
                  });
                  this.cdr.detectChanges();
                  resolve();
                });
              },
              error: (err: any) => {
                this.zone.run(() => {
                  this.agregarError("Procuraduría", err);
                  resolve();
                });
              },
            });
          break;

        case "offshore":
          if (!this.nombre) {
            resolve();
            return;
          }
          this.consultaService.consultarOffshore(this.nombre).subscribe({
            next: (res: any) => {
              this.zone.run(() => {
                const categorias = res.categorias || [];
                const total100 = categorias.reduce(
                  (acc: number, cat: any) =>
                    acc +
                    cat.resultados.filter((o: any) => o.score === 100).length,
                  0,
                );
                this.resultados.push({
                  tipo: "offshore",
                  fuente: "ICIJ Offshore Leaks",
                  tieneRegistros: total100 > 0,
                  totalResultados: total100,
                  categorias,
                  data: { fecha: new Date().toLocaleString() },
                });
                this.cdr.detectChanges();
                resolve();
              });
            },
            error: (err: any) => {
              this.zone.run(() => {
                this.agregarError("Offshore ICIJ", err);
                resolve();
              });
            },
          });
          break;

        default:
          resolve();
      }
    });
  }

  private agregarError(fuente: string, err: any) {
    this.resultados.push({
      tipo: "error",
      fuente,
      data: {
        vigencia: err.error?.error || "Error al consultar",
        fecha: new Date().toLocaleString(),
      },
    });
    this.cdr.detectChanges();
  }

  onResultadoPolicia(evento: { tieneAntecedentes: boolean; mensaje: string }) {
    this.mostrarCaptchaPolicia = false;
    this.zone.run(() => {
      this.resultados.push({
        tipo: "antecedentes",
        fuente: "Policía Nacional de Colombia",
        tieneAntecedentes: evento.tieneAntecedentes,
        mensaje: evento.mensaje,
        data: { fecha: new Date().toLocaleString() },
      });
      this.cdr.detectChanges();
    });
  }

  onCaptchaCancelado() {
    this.mostrarCaptchaPolicia = false;
    this.cargando = false;
  }

  seleccionarTab(resultadoIndex: number, tab: string) {
    this.tabOffshoreActivo[resultadoIndex] = tab;
  }

  getTabActivo(resultadoIndex: number, categorias: any[]): string {
    if (this.tabOffshoreActivo[resultadoIndex])
      return this.tabOffshoreActivo[resultadoIndex];
    const primera = categorias?.find((c) => c.total > 0);
    return primera?.tipo || "";
  }

  filtrarScore100(resultados: any[]): any[] {
    if (!resultados) return [];
    return resultados.filter((o) => o.score === 100);
  }
}
