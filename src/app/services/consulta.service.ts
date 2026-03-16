import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";

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
    return this.http.post<any>(`${this.apiUrl}/api/consulta-antecedentes`, {
      cedula,
      tipoDocumento,
    });
  }

  suscribirCaptchaStatus(
    sessionId: string,
  ): Observable<{ tipo: string; datos: any }> {
    return new Observable((observer) => {
      const url = `${this.apiUrl}/api/captcha-status/${sessionId}`;
      const source = new EventSource(url, { withCredentials: true });

      source.addEventListener("resultado", (e: any) => {
        observer.next({ tipo: "resultado", datos: JSON.parse(e.data) });
        source.close();
        observer.complete();
      });

      source.addEventListener("error", (e: any) => {
        try {
          observer.next({
            tipo: "error",
            datos: JSON.parse((e as any).data || "{}"),
          });
        } catch (_) {
          observer.next({
            tipo: "error",
            datos: { error: "Error desconocido en SSE" },
          });
        }
        source.close();
        observer.complete();
      });

      source.onerror = () => {
        console.warn("[SSE] Evento onerror recibido (puede ser keepalive)");
      };

      return () => source.close();
    });
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

  consultarContraloria(
    cedula: string,
    tipoDocumento = "CC",
    matriculaMercantil?: string,
  ) {
    return this.http.post<ContraloriaResult>(
      `${this.apiUrl}/api/consulta-contraloria`,
      {
        cedula,
        tipo_documento: tipoDocumento,
        ...(matriculaMercantil ? { matriculaMercantil } : {}),
      },
    );
  }

  consultarSupersociedades(razonSocial: string, pagina = 1) {
    return this.http.post<any>(`${this.apiUrl}/api/consulta-supersociedades`, {
      razonSocial,
      pagina,
    });
  }

  consultarSupersociedadesNit(nit: number | string) {
    return this.http.post<any>(
      `${this.apiUrl}/api/consulta-supersociedades-nit`,
      { nit },
    );
  }

  consultarPACO(
    identificacion: string,
    tipo: 1 | 2 = 1,
    opciones?: {
      start_year?: number;
      end_year?: number;
      limit?: number;
      sort?: "value" | "date";
      order?: "desc" | "asc";
    },
  ) {
    return this.http.post<any>(`${this.apiUrl}/api/consulta-paco`, {
      identificacion,
      tipo,
      ...opciones,
    });
  }

  consultarInfobae(nombre: string) {
    return this.http.post<any>(`${this.apiUrl}/api/consulta-infobae`, {
      nombre,
    });
  }
}
