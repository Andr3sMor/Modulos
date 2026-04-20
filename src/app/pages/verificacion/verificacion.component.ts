import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface ResumenDocumentos {
  nombre: string | null;
  razon_social: string | null;
  representantes_legales: string[];
  beneficiarios_finales: string[];
  codigo_rut: string | null;
  descripcion_actividad: string | null;
  nit: string | null;
  inconsistencias_cruzadas: string[];
  documentos_analizados: string[];
}

interface ResultadoDocumento {
  ok: boolean;
  datos?: any;
  error?: string;
}

@Component({
  selector: 'app-verificacion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './verificacion.component.html',
  styleUrls: ['./verificacion.component.css'],
})
export class VerificacionComponent {
  archivos: { [key: string]: File | null } = {
    camara_comercio: null,
    dof: null,
    cedula: null,
    rut: null,
  };

  previews: { [key: string]: string | null } = {
    camara_comercio: null,
    dof: null,
    cedula: null,
    rut: null,
  };

  cargando = false;
  error = '';
  resumen: ResumenDocumentos | null = null;
  resultados: { [key: string]: ResultadoDocumento } | null = null;
  tabActiva = 'resumen';

  documentosConfig = [
    { key: 'camara_comercio', label: 'Cámara de Comercio', icon: '🏢', desc: 'Certificado de existencia y representación' },
    { key: 'dof', label: 'DOF', icon: '📋', desc: 'Documento de origen / Beneficiarios finales' },
    { key: 'cedula', label: 'Cédula', icon: '🪪', desc: 'Cédula de ciudadanía del representante' },
    { key: 'rut', label: 'RUT', icon: '📑', desc: 'Registro Único Tributario' },
  ];

  private apiUrl = 'https://modulos-backend.onrender.com';

  constructor(private http: HttpClient) {}

  onFileChange(event: Event, key: string) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.archivos[key] = file;
    if (file) {
      if (file.type === 'application/pdf') {
        this.previews[key] = 'PDF';
      } else {
        const reader = new FileReader();
        reader.onload = (e) => { this.previews[key] = e.target?.result as string; };
        reader.readAsDataURL(file);
      }
    } else {
      this.previews[key] = null;
    }
  }

  isPdf(key: string): boolean {
    return this.archivos[key]?.type === 'application/pdf';
  }

  getFileName(key: string): string {
    return this.archivos[key]?.name || '';
  }

  eliminarArchivo(key: string) {
    this.archivos[key] = null;
    this.previews[key] = null;
  }

  get hayAlgunArchivo(): boolean {
    return Object.values(this.archivos).some(f => f !== null);
  }

  get conteoArchivos(): number {
    return Object.values(this.archivos).filter(f => f !== null).length;
  }

  analizar() {
    if (!this.hayAlgunArchivo) {
      this.error = 'Por favor suba al menos un documento para analizar.';
      return;
    }

    this.cargando = true;
    this.error = '';
    this.resumen = null;
    this.resultados = null;

    const formData = new FormData();
    for (const [key, file] of Object.entries(this.archivos)) {
      if (file) formData.append(key, file);
    }

    this.http.post<any>(`${this.apiUrl}/api/analizar-documentos`, formData).subscribe({
      next: (res) => {
        this.resumen = res.resumen;
        this.resultados = res.resultados;
        this.tabActiva = 'resumen';
        this.cargando = false;
      },
      error: (err) => {
        this.error = err.error?.error || 'Error al analizar los documentos. Intente de nuevo.';
        this.cargando = false;
      }
    });
  }

  limpiar() {
    this.archivos = { camara_comercio: null, dof: null, cedula: null, rut: null };
    this.previews = { camara_comercio: null, dof: null, cedula: null, rut: null };
    this.resumen = null;
    this.resultados = null;
    this.error = '';
  }

  getNombreDoc(key: string): string {
    return this.documentosConfig.find(d => d.key === key)?.label || key;
  }

  getDocKeys(): string[] {
    return this.resultados ? Object.keys(this.resultados) : [];
  }

  getDatosDoc(key: string): { campo: string; valor: any }[] {
    const datos = this.resultados?.[key]?.datos;
    if (!datos) return [];
    const excluir = ['inconsistencias', 'confianza'];
    return Object.entries(datos)
      .filter(([k]) => !excluir.includes(k) && datos[k] !== null && datos[k] !== undefined)
      .map(([k, v]) => ({ campo: this.formatearCampo(k), valor: v }));
  }

  formatearCampo(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  getConfianza(key: string): number {
    return parseInt(this.resultados?.[key]?.datos?.confianza) || 0;
  }

  getInconsistenciasDoc(key: string): string[] {
    return this.resultados?.[key]?.datos?.inconsistencias || [];
  }

  hayInconsistencias(): boolean {
    const cruzadas = (this.resumen?.inconsistencias_cruzadas?.length || 0) > 0;
    const enDocs = this.getDocKeys().some(k => this.getInconsistenciasDoc(k).length > 0);
    return cruzadas || enDocs;
  }

  isArray(val: any): boolean {
    return Array.isArray(val);
  }

  formatearValorItem(v: any): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && !Array.isArray(v)) {
      return Object.values(v)
        .filter(x => x !== null && x !== undefined && x !== '')
        .join(' — ');
    }
    return String(v);
  }
}
