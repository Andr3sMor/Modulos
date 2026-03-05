import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";

export interface AntecedentesResult {
  fuente: string;
  status: string;
  cedula: string;
  tipoDocumento: string;
  tieneAntecedentes: boolean;
  mensaje: string;
  detalle?: string;
  error?: string;
}

@Injectable({ providedIn: "root" })
export class ConsultaService {
  constructor(private http: HttpClient) {}

  // Consulta a la Registraduría (vía tu Proxy /api)
  verificarCedula(cedula: string) {
    return this.http.post("/api/consulta-cedula", { cedula });
  }

  // Consulta a la Junta Central de Contadores
  verificarContador(cedula: string) {
    return this.http.post("/api/consulta-contador", { cedula });
  }

  // Consulta Antecedentes Judiciales - Policía Nacional
  consultarAntecedentes(
    cedula: string,
    tipoDocumento: string = "Cédula de Ciudadanía",
  ) {
    return this.http.post<AntecedentesResult>("/api/consulta-antecedentes", {
      cedula,
      tipoDocumento,
    });
  }
}
