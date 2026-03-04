import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ConsultaService {
  constructor(private http: HttpClient) {}

  // Consulta a la Registraduría (vía tu Proxy /api)
  verificarCedula(cedula: string) {
    return this.http.post('/api/consulta-cedula', { cedula });
  }

  // Consulta a la Junta Central de Contadores
  verificarContador(cedula: string) {
    return this.http.post('/api/consulta-contador', { cedula });
  }
}
