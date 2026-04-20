import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

interface PersonaNatural {
  nombre_completo: string | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  primer_nombre: string | null;
  segundo_nombre: string | null;
  numero_cedula: string | null;
  fecha_nacimiento: string | null;
  lugar_nacimiento: string | null;
  fecha_expedicion_cedula: string | null;
  lugar_expedicion_cedula: string | null;
  sexo: string | null;
  grupo_sanguineo: string | null;
  es_pep: boolean | null;
  cargo_pep: string | null;
  es_representante_legal: boolean | null;
  cargo_en_empresa: string | null;
}

interface Empresa {
  razon_social: string | null;
  nombre_comercial: string | null;
  sigla: string | null;
  nit: string | null;
  tipo_sociedad: string | null;
  numero_matricula: string | null;
  estado_matricula: string | null;
  fecha_matricula: string | null;
  fecha_renovacion: string | null;
  domicilio: string | null;
  direccion: string | null;
  actividad_principal_ciiu: string | null;
  descripcion_actividad: string | null;
  responsabilidades_tributarias: { codigo: string; descripcion: string }[];
  regimen_tributario: string | null;
  gran_contribuyente: string | null;
  estado_rut: string | null;
  capital_suscrito: string | null;
  capital_pagado: string | null;
}

interface PersonaVinculada {
  nombre: string;
  documento: string | null;
  roles: string[];
  fuentes: string[];
  es_pep?: boolean;
  cargo_pep?: string | null;
}

interface Alerta {
  nivel: 'CRITICO' | 'ALTO' | 'MEDIO' | 'INFO';
  mensaje: string;
}

interface Resumen {
  persona_natural: PersonaNatural | null;
  empresa: Empresa | null;
  personas_vinculadas: PersonaVinculada[];
  alertas: Alerta[];
  documentos_analizados: string[];
  documentos_con_error: string[];
  confianza_promedio: number | null;
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
  progresoTexto = '';
  progresoNum = 0;
  progresoTotal = 0;
  error = '';
  resumen: Resumen | null = null;
  resultados: { [key: string]: ResultadoDocumento } = {};
  tabActiva = 'resumen';

  documentosConfig = [
    { key: 'camara_comercio', label: 'Cámara de Comercio', icon: '🏢', desc: 'Certificado de existencia y representación' },
    { key: 'dof', label: 'DOF', icon: '📋', desc: 'Documento de beneficiarios finales' },
    { key: 'cedula', label: 'Cédula', icon: '🪪', desc: 'Cédula de ciudadanía del representante' },
    { key: 'rut', label: 'RUT', icon: '📑', desc: 'Registro Único Tributario' },
  ];

  private apiUrl = 'https://modulos-backend.onrender.com';

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

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

  async analizar() {
    if (!this.hayAlgunArchivo) {
      this.error = 'Por favor suba al menos un documento para analizar.';
      return;
    }

    this.cargando = true;
    this.error = '';
    this.resumen = null;
    this.resultados = {};

    const entradas = Object.entries(this.archivos).filter(([, f]) => f !== null) as [string, File][];
    this.progresoTotal = entradas.length;
    this.progresoNum = 0;

    for (const [key, file] of entradas) {
      this.progresoNum++;
      this.progresoTexto = `Analizando ${this.getNombreDoc(key)} (${this.progresoNum}/${this.progresoTotal})...`;
      this.cdr.detectChanges();

      const formData = new FormData();
      formData.append('archivo', file);
      formData.append('tipo', key);

      try {
        const res = await lastValueFrom(
          this.http.post<{ ok: boolean; campo: string; datos?: any; error?: string }>(
            `${this.apiUrl}/api/analizar-documento`,
            formData
          ).pipe(timeout(55000))
        );
        this.resultados[key] = { ok: res.ok, datos: res.datos, error: res.error };
      } catch (err: any) {
        const msg = err.name === 'TimeoutError'
          ? 'El servidor tardó demasiado. Intente con una imagen en lugar de PDF.'
          : (err.error?.error || err.message || 'Error de conexión');
        this.resultados[key] = { ok: false, error: msg };
      }
      this.cdr.detectChanges();
    }

    this.progresoTexto = 'Generando resumen consolidado...';
    this.cdr.detectChanges();

    try {
      const resumen = await lastValueFrom(
        this.http.post<Resumen>(`${this.apiUrl}/api/generar-resumen`, { resultados: this.resultados })
      );
      this.resumen = resumen;
    } catch (err: any) {
      this.error = 'No se pudo generar el resumen consolidado.';
    }

    this.tabActiva = 'resumen';
    this.cargando = false;
    this.progresoTexto = '';
    this.cdr.detectChanges();
  }

  limpiar() {
    this.archivos = { camara_comercio: null, dof: null, cedula: null, rut: null };
    this.previews = { camara_comercio: null, dof: null, cedula: null, rut: null };
    this.resumen = null;
    this.resultados = {};
    this.error = '';
    this.progresoTexto = '';
  }

  getNombreDoc(key: string): string {
    return this.documentosConfig.find(d => d.key === key)?.label || key;
  }

  getDocKeys(): string[] {
    return Object.keys(this.resultados);
  }

  getDatosDoc(key: string): { campo: string; valor: any }[] {
    const datos = this.resultados[key]?.datos;
    if (!datos) return [];
    const excluir = ['inconsistencias', 'confianza'];
    return Object.entries(datos)
      .filter(([k]) => !excluir.includes(k) && datos[k] !== null && datos[k] !== undefined && datos[k] !== '')
      .map(([k, v]) => ({ campo: this.formatearCampo(k), valor: v }));
  }

  formatearCampo(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

  formatearValorDisplay(v: any): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object' && !Array.isArray(v)) {
      return Object.entries(v)
        .filter(([, val]) => val !== null && val !== undefined && val !== '')
        .map(([k, val]) => `${this.formatearCampo(k)}: ${val}`)
        .join(' · ');
    }
    return String(v);
  }

  getObservaciones(key: string): string[] {
    return this.resultados[key]?.datos?.observaciones_clave || [];
  }

  getConfianza(key: string): number {
    return parseInt(this.resultados[key]?.datos?.confianza) || 0;
  }

  getInconsistenciasDoc(key: string): string[] {
    return this.resultados[key]?.datos?.inconsistencias || [];
  }

  isArray(val: any): boolean {
    return Array.isArray(val);
  }

  getAlertasPorNivel(nivel: string): Alerta[] {
    return (this.resumen?.alertas || []).filter(a => a.nivel === nivel);
  }

  getNivelClass(nivel: string): string {
    const map: any = { CRITICO: 'nivel-critico', ALTO: 'nivel-alto', MEDIO: 'nivel-medio', INFO: 'nivel-info' };
    return map[nivel] || '';
  }

  hayAlertasCriticas(): boolean {
    return (this.resumen?.alertas || []).some(a => a.nivel === 'CRITICO' || a.nivel === 'ALTO');
  }

  getPersonasVinculadasConRol(): PersonaVinculada[] {
    return this.resumen?.personas_vinculadas || [];
  }
}
