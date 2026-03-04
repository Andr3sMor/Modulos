import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CedulaService {
  // Ahora usamos la ruta del proxy
  private apiUrl = '/api/consulta-cedula';

  constructor(private http: HttpClient) {}

  consultar(cedula: string): Observable<any> {
    return this.http.post<any>(this.apiUrl, { cedula });
  }
}
