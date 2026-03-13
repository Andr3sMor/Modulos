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

export interface ContraloriaResult {
  fuente: string;
  status: string;
  data: {
    cedula: string;
    pdfBase64?: string;
    html?: string;
    fecha: string;
  };
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
    nombre = "",
  ) {
    return this.http.post<any>(`${this.apiUrl}/api/consulta-procuraduria`, {
      cedula,
      tipoDocumento,
      tipoCertificado,
      nombre,
    });
  }

  consultarOffshore(nombre: string) {
    return this.http.post(`${this.apiUrl}/api/consulta-offshore`, { nombre });
  }

  buscarPersonaConIA(nombre: string) {
    return this.http.post<{ analisis: string; fuentes: string | null }>(
      `${this.apiUrl}/api/buscar-persona-ia`,
      { nombre },
    );
  }

  consultarRamaJudicial(payload: {
    cedula?: string;
    nombres?: string;
    apellidos?: string;
  }) {
    return this.http.post<any>(
      `${this.apiUrl}/api/consulta-rama-judicial`,
      payload,
    );
  }

  consultarContraloria(cedula: string, tipoDocumento = "CC") {
    return this.http.post<ContraloriaResult>(
      `${this.apiUrl}/api/consulta-contraloria`,
      { cedula, tipo_documento: tipoDocumento },
    );
  }
}
