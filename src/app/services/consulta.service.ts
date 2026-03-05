import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";

@Injectable({ providedIn: "root" })
export class ConsultaService {
  private apiUrl = "https://modulos-backend.onrender.com"; // ← aquí va la URL de Render después

  constructor(private http: HttpClient) {}

  verificarCedula(cedula: string) {
    return this.http.post(`${this.apiUrl}/api/consulta-cedula`, { cedula });
  }

  verificarContador(cedula: string) {
    return this.http.post(`${this.apiUrl}/api/consulta-contador`, { cedula });
  }

  consultarAntecedentes(
    cedula: string,
    tipoDocumento: string = "Cédula de Ciudadanía",
  ) {
    return this.http.post(`${this.apiUrl}/api/consulta-antecedentes`, {
      cedula,
      tipoDocumento,
    });
  }
}
