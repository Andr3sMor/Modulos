import { Component, EventEmitter, Input, OnDestroy, Output, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-policia-captcha',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="overlay" *ngIf="visible">
      <div class="modal">
        <div class="header">
          <span>🚔 Antecedentes Policiales</span>
          <button class="close" (click)="cancelar()" [disabled]="consultando">✕</button>
        </div>
        <div class="body">

          <!-- Consultando -->
          <div class="estado" *ngIf="consultando && !error">
            <div class="spinner"></div>
            <p class="estado-texto">{{ mensajeEstado }}</p>
            <p class="estado-sub">Esto puede tardar unos segundos...</p>
          </div>

          <!-- Error -->
          <div class="estado" *ngIf="error">
            <div class="error-icono">❌</div>
            <p class="estado-texto">{{ error }}</p>
            <button class="btn-reintentar" (click)="reintentar()">Reintentar</button>
          </div>

        </div>
      </div>
    </div>
  `,
  styles: [`
    .overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 16px;
    }
    .modal {
      background: white; border-radius: 12px; overflow: hidden;
      box-shadow: 0 8px 40px rgba(0,0,0,0.35);
      width: 100%; max-width: 380px;
    }
    .header {
      background: #1a3a5c; color: white; padding: 14px 20px;
      display: flex; justify-content: space-between; align-items: center;
      font-weight: 600; font-size: 15px;
    }
    .close {
      background: none; border: none; color: white;
      font-size: 18px; cursor: pointer; opacity: 0.8;
    }
    .close:disabled { opacity: 0.3; cursor: not-allowed; }
    .body { padding: 36px 24px; }
    .estado {
      display: flex; flex-direction: column;
      align-items: center; gap: 12px; text-align: center;
    }
    .spinner {
      width: 48px; height: 48px;
      border: 4px solid #e5e7eb;
      border-top-color: #1a3a5c;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .estado-texto { font-size: 15px; color: #333; font-weight: 500; margin: 0; }
    .estado-sub   { font-size: 13px; color: #888; margin: 0; }
    .error-icono  { font-size: 40px; }
    .btn-reintentar {
      background: #1a3a5c; color: white; border: none;
      border-radius: 8px; padding: 10px 28px;
      font-size: 14px; cursor: pointer; margin-top: 4px;
    }
    .btn-reintentar:hover { background: #2a5a8c; }
  `]
})
export class PoliciaCaptchaComponent implements OnDestroy {
  @Input() visible = false;
  @Output() resultadoObtenido = new EventEmitter<{ tieneAntecedentes: boolean; mensaje: string }>();
  @Output() cancelado = new EventEmitter<void>();

  consultando = false;
  mensajeEstado = '';
  error = '';

  private cedula = '';
  private tipoDocumento = '';

  constructor(private http: HttpClient, private zone: NgZone) {}

  ngOnDestroy() { this.reset(); }

  iniciar(cedula: string, tipoDocumento: string) {
    this.cedula        = cedula;
    this.tipoDocumento = tipoDocumento;
    this.visible       = true;
    this.ejecutarConsulta();
  }

  private ejecutarConsulta() {
    this.consultando    = true;
    this.error          = '';
    this.mensajeEstado  = 'Consultando base de datos de la Policía...';

    this.http.post<any>('/api/consulta-antecedentes', {
      cedula: this.cedula,
      tipoDocumento: this.tipoDocumento,
    }).subscribe({
      next: (res) => {
        this.zone.run(() => {
          this.consultando = false;
          this.visible     = false;
          this.resultadoObtenido.emit({
            tieneAntecedentes: res.tieneAntecedentes,
            mensaje: res.mensaje,
          });
        });
      },
      error: (err) => {
        this.zone.run(() => {
          this.consultando = false;
          this.error = err.error?.detalle || err.error?.error || 'Error al consultar la Policía Nacional.';
        });
      }
    });
  }

  reintentar() {
    this.ejecutarConsulta();
  }

  cancelar() {
    this.reset();
    this.visible = false;
    this.cancelado.emit();
  }

  private reset() {
    this.consultando   = false;
    this.error         = '';
    this.mensajeEstado = '';
  }
}