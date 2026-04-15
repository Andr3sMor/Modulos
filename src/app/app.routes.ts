import { Routes } from '@angular/router';
import { SearchComponent } from './pages/search/search.component';
import { VerificacionComponent } from './pages/verificacion/verificacion.component';

export const routes: Routes = [
  { path: '', redirectTo: 'consultas', pathMatch: 'full' },
  { path: 'consultas', component: SearchComponent },
  { path: 'verificacion', component: VerificacionComponent },
];
