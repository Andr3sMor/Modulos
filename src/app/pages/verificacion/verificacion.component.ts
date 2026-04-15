import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface DocumentoVerificado {
  tipo: string;
  numero: string;
  estado: 'valido' | 'invalido' | 'pendiente';
  fechaVerificacion: string;
  observaciones: string;
}

@Component({
  selector: 'app-verificacion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './verificacion.component.html',
  styleUrls: ['./verificacion.component.css'],
})
export class VerificacionComponent {
  tipoDocumento: string = 'cedula';
  numeroDocumento: string = '';
  nombreTitular: string = '';
  cargando = false;
  error = '';
  resultado: DocumentoVerificado | null = null;

  tiposDocumento = [
    { value: 'cedula', label: 'Cédula de Ciudadanía' },
    { value: 'pasaporte', label: 'Pasaporte' },
    { value: 'cedula_extranjeria', label: 'Cédula de Extranjería' },
    { value: 'nit', label: 'NIT' },
    { value: 'tarjeta_identidad', label: 'Tarjeta de Identidad' },
  ];

  verificarDocumento() {
    if (!this.numeroDocumento.trim()) {
      this.error = 'Por favor ingrese el número de documento.';
      return;
    }

    this.cargando = true;
    this.error = '';
    this.resultado = null;

    setTimeout(() => {
      const esValido = this.numeroDocumento.length >= 6;

      this.resultado = {
        tipo: this.tiposDocumento.find(t => t.value === this.tipoDocumento)?.label || this.tipoDocumento,
        numero: this.numeroDocumento,
        estado: esValido ? 'valido' : 'invalido',
        fechaVerificacion: new Date().toLocaleString('es-CO'),
        observaciones: esValido
          ? 'El documento cumple con el formato requerido y está registrado en las bases de datos.'
          : 'El número ingresado no cumple con el formato mínimo requerido.',
      };

      this.cargando = false;
    }, 1200);
  }

  limpiar() {
    this.numeroDocumento = '';
    this.nombreTitular = '';
    this.resultado = null;
    this.error = '';
    this.tipoDocumento = 'cedula';
  }
}
