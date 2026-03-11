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
  certificadoUrl?: string;
  error?: string;
}

@Injectable({ providedIn: "root" })
export class ConsultaService {
  private apiUrl = "https://modulos-backend.onrender.com";

  constructor(private http: HttpClient) {}

  verificarCedula(cedula: string) {
    return this.http.post(`${this.apiUrl}/api/consulta-cedula`, { cedula });
  }

  verificarContador(cedula: string) {
    return this.http.post(`${this.apiUrl}/api/consulta-contador`, { cedula });
  }

  consultarAntecedentes(
    cedula: string,
    tipoDocumento = "Cédula de Ciudadanía",
  ) {
    return this.http.post<AntecedentesResult>(
      `${this.apiUrl}/api/consulta-antecedentes`,
      { cedula, tipoDocumento },
    );
  }

  consultarAntecedentesConToken(
    cedula: string,
    tipoDocumento: string,
    recaptchaToken: string,
  ) {
    return this.http.post<AntecedentesResult>(
      `${this.apiUrl}/api/consulta-antecedentes`,
      { cedula, tipoDocumento, recaptchaToken },
    );
  }

  resolverCaptcha(sessionId: string, token: string) {
    return this.http.post<AntecedentesResult>(
      `${this.apiUrl}/api/resolver-captcha`,
      { sessionId, token },
    );
  }

  consultarProcuraduria(
    cedula: string,
    tipoDocumento = "CC",
    tipoCertificado = "1",
  ) {
    return this.http.post<any>(`${this.apiUrl}/api/consulta-procuraduria`, {
      cedula,
      tipoDocumento,
      tipoCertificado,
    });
  }

  consultarOffshore(nombre: string) {
    return this.http.post(`${this.apiUrl}/api/consulta-offshore`, { nombre });
  }

  // ── Gemini AI: buscar persona por nombre en internet ────────
  buscarPersonaConIA(nombre: string) {
    return this.http.post<{ analisis: string; fuentes: string | null }>(
      `${this.apiUrl}/api/buscar-persona-ia`,
      { nombre },
    );
  }
}
