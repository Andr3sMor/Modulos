import { Component } from '@angular/core';
import { SearchComponent } from './pages/search/search.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SearchComponent],
  template: `<app-search></app-search>`,
})
export class AppComponent {}
