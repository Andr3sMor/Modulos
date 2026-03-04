import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConsultaService } from '../../services/consulta.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css'],
})
export class SearchComponent {
  cedula: string = '';
  resultado: any = null;
  cargando = false;
  error = '';

  constructor(private consultaService: ConsultaService) {}

  consultarCedula() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.verificarCedula(this.cedula).subscribe({
      next: (res: any) => {
        this.resultado = { 
          ...res, 
          fuente: 'Registraduría Nacional',
          data: res.data || {}
        };
        this.cargando = false;
      },
      error: (err) => this.manejarError(err.error?.error || 'Error en Registraduría'),
    });
  }

  consultarContador() {
    if (!this.cedula) return;
    this.prepararConsulta();
    this.consultaService.verificarContador(this.cedula).subscribe({
      next: (res: any) => {
        this.resultado = { 
          ...res, 
          fuente: 'Junta Central de Contadores',
          data: {
            vigencia: res.esContador ? 'CONTADOR PÚBLICO' : 'No es contador o no encontrado',
            fecha: new Date().toLocaleString()
          }
        };
        this.cargando = false;
      },
      error: (err) => this.manejarError(err.error?.error || 'Error en consulta de Contador'),
    });
  }

  private prepararConsulta() {
    if (!this.cedula) return;
    this.cargando = true;
    this.error = '';
    this.resultado = null;
  }

  private manejarError(msg: string) {
    this.error = msg;
    this.cargando = false;
  }
}
