import { Component, NgZone, ChangeDetectorRef } from "@angular/core";
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
  apellido = "";
  cargando = false;
  error = "";
  resultados: any[] = [];
  tabOffshoreActivo: { [key: string]: string } = {};

  captchaData: { sessionId: string } | null = null;

  analisisIA = "";
  cargandoIA = false;
  errorIA = "";

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
    { id: "procuraduria", nombre: "Procuraduría", activo: false },
    { id: "contraloria", nombre: "Contraloría", activo: false },
    { id: "offshore", nombre: "Offshore ICIJ", activo: false },
    { id: "ramaJudicial", nombre: "Rama Judicial", activo: false },
  ];

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
      this.error = "Ingresa al menos un dato.";
      return;
    }

    this.error = "";
    this.resultados = [];
    this.analisisIA = "";
    this.errorIA = "";

    if (this.nombre.trim()) {
      this.cargandoIA = true;
      this.cdr.detectChanges();

      this.consultaService.buscarPersonaConIA(this.nombre).subscribe({
        next: (res: any) => {
          this.zone.run(() => {
            this.analisisIA = res.analisis;
            this.cargandoIA = false;
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.zone.run(() => {
            this.errorIA = "No se pudo obtener el análisis de IA.";
            this.cargandoIA = false;
            this.cdr.detectChanges();
          });
        },
      });
    }

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
            next: (res: any) =>
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
              }),
            error: (err: any) =>
              this.zone.run(() => {
                this.agregarError("Registraduría", err);
                resolve();
              }),
          });
          break;

        case "contador":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService.verificarContador(this.cedula).subscribe({
            next: (res: any) =>
              this.zone.run(() => {
                this.resultados.push({
                  tipo: "contador",
                  fuente: "Junta Central de Contadores",
                  esContador: res.esContador,
                  data: { fecha: new Date().toLocaleString() },
                });
                this.cdr.detectChanges();
                resolve();
              }),
            error: (err: any) =>
              this.zone.run(() => {
                this.agregarError("Contador JCC", err);
                resolve();
              }),
          });
          break;

        case "antecedentes":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService
            .consultarAntecedentes(this.cedula, this.tipoDocumento)
            .subscribe({
              next: (res: any) =>
                this.zone.run(() => {
                  if (res.requiereCaptcha) {
                    this.captchaData = { sessionId: res.sessionId };
                    this.cdr.detectChanges();
                    (this as any)._pendingCaptchaResolve = resolve;
                  } else {
                    this.resultados.push({
                      tipo: "antecedentes",
                      fuente: res.fuente || "Policía Nacional de Colombia",
                      tieneAntecedentes: res.tieneAntecedentes,
                      mensaje: res.mensaje,
                      data: { fecha: new Date().toLocaleString() },
                    });
                    this.cdr.detectChanges();
                    resolve();
                  }
                }),
              error: (err: any) =>
                this.zone.run(() => {
                  this.agregarError("Policía Nacional", err);
                  resolve();
                }),
            });
          break;

        case "procuraduria":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService
            .consultarProcuraduria(
              this.cedula,
              this.tipoDocumento,
              "1",
              this.nombre,
            )
            .subscribe({
              next: (res: any) =>
                this.zone.run(() => {
                  this.resultados.push({
                    tipo: "procuraduria",
                    fuente: "Procuraduría General de la Nación",
                    tieneSanciones: res.tieneSanciones,
                    sinSanciones: res.sinSanciones,
                    mensaje: res.mensaje,
                    pdfBase64: res.pdfBase64 || null,
                    data: { fecha: new Date().toLocaleString() },
                  });
                  this.cdr.detectChanges();
                  resolve();
                }),
              error: (err: any) =>
                this.zone.run(() => {
                  this.agregarError("Procuraduría", err);
                  resolve();
                }),
            });
          break;

        case "contraloria":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService
            .consultarContraloria(this.cedula, this.tipoDocumento)
            .subscribe({
              next: (res: any) =>
                this.zone.run(() => {
                  this.resultados.push({
                    tipo: "contraloria",
                    fuente: res.fuente || "Contraloría General de la República",
                    tieneFiscal: res.data?.tieneFiscal ?? null,
                    mensaje: res.data?.mensaje || "",
                    pdfBase64: res.data?.pdfBase64 || null,
                    data: { fecha: new Date().toLocaleString() },
                  });
                  this.cdr.detectChanges();
                  resolve();
                }),
              error: (err: any) =>
                this.zone.run(() => {
                  this.agregarError("Contraloría", err);
                  resolve();
                }),
            });
          break;

        case "offshore":
          if (!this.nombre) {
            resolve();
            return;
          }
          this.consultaService.consultarOffshore(this.nombre).subscribe({
            next: (res: any) =>
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
              }),
            error: (err: any) =>
              this.zone.run(() => {
                this.agregarError("Offshore ICIJ", err);
                resolve();
              }),
          });
          break;

        case "ramaJudicial":
          if (!this.cedula && !this.apellido) {
            resolve();
            return;
          }
          this.consultaService
            .consultarRamaJudicial({
              cedula: this.cedula || undefined,
              nombres: this.nombre || undefined,
              apellidos: this.apellido || undefined,
            })
            .subscribe({
              next: (res: any) =>
                this.zone.run(() => {
                  this.resultados.push({
                    tipo: "ramaJudicial",
                    fuente: res.fuente || "Rama Judicial de Colombia",
                    totalAlertas: res.totalAlertas,
                    totalCiudades: res.totalCiudades,
                    ciudades: res.ciudades || [],
                    data: { fecha: new Date().toLocaleString() },
                  });
                  this.cdr.detectChanges();
                  resolve();
                }),
              error: (err: any) =>
                this.zone.run(() => {
                  this.agregarError("Rama Judicial", err);
                  resolve();
                }),
            });
          break;

        default:
          resolve();
      }
    });
  }

  descargarCertificado(r: any): void {
    if (!r.pdfBase64) return;
    const bytes = atob(r.pdfBase64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  onCaptchaResuelto(resultado: any) {
    this.captchaData = null;
    this.zone.run(() => {
      this.resultados.push({
        tipo: "antecedentes",
        fuente: resultado.fuente || "Policía Nacional de Colombia",
        tieneAntecedentes: resultado.tieneAntecedentes,
        mensaje: resultado.mensaje,
        data: { fecha: new Date().toLocaleString() },
      });
      this.cdr.detectChanges();
      const res = (this as any)._pendingCaptchaResolve;
      if (res) {
        res();
        (this as any)._pendingCaptchaResolve = null;
      }
    });
  }

  onCaptchaCancelado() {
    this.captchaData = null;
    this.cargando = false;
    const res = (this as any)._pendingCaptchaResolve;
    if (res) {
      res();
      (this as any)._pendingCaptchaResolve = null;
    }
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
    return (resultados || []).filter((o) => o.score === 100);
  }
}
