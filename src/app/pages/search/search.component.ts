import { Component, NgZone, ChangeDetectorRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConsultaService } from "../../services/consulta.service";

@Component({
  selector: "app-search",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./search.component.html",
  styleUrls: ["./search.component.css"],
})
export class SearchComponent {
  cedula = "";
  nombre = "";
  apellido = "";
  razonSocial = "";
  matriculaMercantil = "";
  cargando = false;
  error = "";
  resultados: any[] = [];
  tabOffshoreActivo: { [key: string]: string } = {};

  supersociedadesEmpresas: any[] = [];
  supersociedadesDetalle: any | null = null;
  cargandoDetalle = false;

  analisisIA = "";
  cargandoIA = false;
  errorIA = "";

  tipoPersona: "natural" | "juridica" = "natural";
  tipoDocumento = "Cédula de Ciudadanía";

  get tiposDocumento(): string[] {
    if (this.tipoPersona === "juridica") return ["NIT"];
    return [
      "Cédula de Ciudadanía",
      "Cédula de Extranjería",
      "Pasaporte",
      "Documento País Origen",
    ];
  }

  servicios = [
    { id: "registraduria", nombre: "Registraduría", activo: true },
    { id: "contador", nombre: "Contador JCC", activo: false },
    { id: "antecedentes", nombre: "Policía", activo: false },
    { id: "procuraduria", nombre: "Procuraduría", activo: false },
    { id: "contraloria", nombre: "Contraloría", activo: false },
    { id: "offshore", nombre: "Offshore ICIJ", activo: false },
    { id: "ramaJudicial", nombre: "Rama Judicial", activo: false },
    { id: "supersociedades", nombre: "Supersociedades", activo: false },
    { id: "paco", nombre: "Contratos PACO", activo: false },
  ];

  tipoPACO: 1 | 2 = 1;

  constructor(
    private consultaService: ConsultaService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  // ── Tipo persona ────────────────────────────────────────────────────────────
  onTipoPersonaChange() {
    if (this.tipoPersona === "natural") {
      this.tipoDocumento = "Cédula de Ciudadanía";
      const activar = new Set([
        "registraduria",
        "procuraduria",
        "contraloria",
        "offshore",
        "paco",
      ]);
      this.servicios.forEach((s) => (s.activo = activar.has(s.id)));
      this.matriculaMercantil = "";
    } else {
      this.tipoDocumento = "NIT";
      const activar = new Set([
        "procuraduria",
        "contraloria",
        "offshore",
        "supersociedades",
        "paco",
      ]);
      this.servicios.forEach((s) => (s.activo = activar.has(s.id)));
    }
    this.cdr.detectChanges();
  }

  get nombreOffshore(): string {
    if (this.tipoPersona === "juridica") return this.razonSocial.trim();
    return [this.nombre.trim(), this.apellido.trim()].filter(Boolean).join(" ");
  }

  // ── Consulta principal ──────────────────────────────────────────────────────
  ejecutarConsulta() {
    const activos = this.servicios.filter((s) => s.activo);
    if (!activos.length) {
      this.error = "Selecciona al menos un servicio.";
      return;
    }
    if (!this.cedula && !this.nombre && !this.razonSocial) {
      this.error = "Ingresa al menos un dato.";
      return;
    }

    this.error = "";
    this.resultados = [];
    this.analisisIA = "";
    this.errorIA = "";
    this.supersociedadesEmpresas = [];
    this.supersociedadesDetalle = null;

    const terminoIA =
      this.tipoPersona === "natural"
        ? this.nombre.trim()
        : this.razonSocial.trim();
    if (terminoIA) {
      this.cargandoIA = true;
      this.cdr.detectChanges();
      this.consultaService.buscarPersonaConIA(terminoIA).subscribe({
        next: (res: any) =>
          this.zone.run(() => {
            this.analisisIA = res.analisis;
            this.cargandoIA = false;
            this.cdr.detectChanges();
          }),
        error: () =>
          this.zone.run(() => {
            this.errorIA = "No se pudo obtener el análisis de IA.";
            this.cargandoIA = false;
            this.cdr.detectChanges();
          }),
      });
    }

    this.cargando = true;
    Promise.allSettled(activos.map((s) => this.llamarServicio(s.id))).then(
      () => {
        this.zone.run(() => {
          this.cargando = false;
          this.cdr.detectChanges();
        });
      },
    );
  }

  // ── Servicios ───────────────────────────────────────────────────────────────
  private llamarServicio(id: string): Promise<void> {
    return new Promise((resolve) => {
      switch (id) {
        // ── Registraduría ────────────────────────────────────────────────────
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

        // ── Contador JCC ─────────────────────────────────────────────────────
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

        // ── Policía — rektcaptcha resuelve automáticamente en el backend ─────
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
                  this.resultados.push({
                    tipo: "antecedentes",
                    fuente: res.fuente || "Policía Nacional de Colombia",
                    tieneAntecedentes: res.tieneAntecedentes,
                    mensaje: res.mensaje,
                    screenshot: res.screenshot || null,
                    data: { fecha: new Date().toLocaleString() },
                  });
                  this.cdr.detectChanges();
                  resolve();
                }),
              error: (err: any) =>
                this.zone.run(() => {
                  this.agregarError("Policía Nacional", err);
                  resolve();
                }),
            });
          break;

        // ── Procuraduría ─────────────────────────────────────────────────────
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

        // ── Contraloría ──────────────────────────────────────────────────────
        case "contraloria":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService
            .consultarContraloria(
              this.cedula,
              this.tipoDocumento,
              this.tipoPersona === "juridica"
                ? this.matriculaMercantil
                : undefined,
            )
            .subscribe({
              next: (res: any) =>
                this.zone.run(() => {
                  this.resultados.push({
                    tipo: "contraloria",
                    fuente: res.fuente || "Contraloría General de la República",
                    tieneFiscal: res.tieneFiscal,
                    mensaje: res.mensaje,
                    pdfBase64: res.pdfBase64 || null,
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

        // ── Offshore ICIJ ────────────────────────────────────────────────────
        case "offshore": {
          const termino = this.nombreOffshore;
          if (!termino) {
            resolve();
            return;
          }
          this.consultaService.consultarOffshore(termino).subscribe({
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
                  terminoBuscado: termino,
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
        }

        // ── Rama Judicial ────────────────────────────────────────────────────
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

        // ── Supersociedades ──────────────────────────────────────────────────
        case "supersociedades": {
          const rs = this.razonSocial.trim();
          if (!rs) {
            resolve();
            return;
          }
          this.consultaService.consultarSupersociedades(rs).subscribe({
            next: (res: any) =>
              this.zone.run(() => {
                this.supersociedadesEmpresas = res.data || [];
                this.resultados.push({
                  tipo: "supersociedades",
                  fuente: "Superintendencia de Sociedades",
                  totalRegistros: res.totalRegistros || 0,
                  data: { fecha: new Date().toLocaleString() },
                });
                this.cdr.detectChanges();
                resolve();
              }),
            error: (err: any) =>
              this.zone.run(() => {
                this.agregarError("Supersociedades", err);
                resolve();
              }),
          });
          break;
        }

        // ── Contratos PACO ───────────────────────────────────────────────────
        case "paco":
          if (!this.cedula) {
            resolve();
            return;
          }
          this.consultaService
            .consultarPACO(
              this.cedula,
              this.tipoPersona === "juridica" ? 2 : this.tipoPACO,
            )
            .subscribe({
              next: (res: any) =>
                this.zone.run(() => {
                  this.resultados.push({
                    tipo: "paco",
                    fuente: res.fuente || "PACO – SECOP II",
                    totalContratos: res.resumen?.totalContratos ?? 0,
                    totalValor: res.resumen?.totalValor ?? 0,
                    departamentos: res.resumen?.departamentos ?? [],
                    contratoPorAno: res.resumen?.contratoPorAno ?? {},
                    entidades: res.entidades ?? [],
                    contratos: res.contratos ?? [],
                    portalUrl: res.portalUrl,
                    data: { fecha: new Date().toLocaleString() },
                  });
                  this.cdr.detectChanges();
                  resolve();
                }),
              error: (err: any) =>
                this.zone.run(() => {
                  this.agregarError("PACO", err);
                  resolve();
                }),
            });
          break;

        default:
          resolve();
      }
    });
  }

  // ── Supersociedades detalle ─────────────────────────────────────────────────
  seleccionarEmpresa(nit: number) {
    this.cargandoDetalle = true;
    this.supersociedadesDetalle = null;
    this.cdr.detectChanges();
    this.consultaService.consultarSupersociedadesNit(nit).subscribe({
      next: (res: any) =>
        this.zone.run(() => {
          this.supersociedadesDetalle = res.data;
          this.cargandoDetalle = false;
          this.cdr.detectChanges();
        }),
      error: () =>
        this.zone.run(() => {
          this.cargandoDetalle = false;
          this.cdr.detectChanges();
        }),
    });
  }

  // ── Descarga PDF ────────────────────────────────────────────────────────────
  descargarCertificado(r: any): void {
    if (!r.pdfBase64) return;
    const bytes = atob(r.pdfBase64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const map: { [k: string]: string } = {
      procuraduria: "Certificado_Procuraduria",
      contraloria: "Certificado_Contraloria",
      antecedentes: "Certificado_Policia",
      registraduria: "Certificado_Registraduria",
      ramaJudicial: "Certificado_Rama_Judicial",
      offshore: "Certificado_Offshore",
      contador: "Certificado_JCC",
    };
    const a = document.createElement("a");
    a.href = url;
    a.download = `${map[r.tipo] ?? "Certificado_" + r.tipo}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
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
    return categorias?.find((c) => c.total > 0)?.tipo || "";
  }

  filtrarScore100(resultados: any[]): any[] {
    return (resultados || []).filter((o) => o.score === 100);
  }
}
