import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { NotificacionesService, Aviso, TipoAviso } from '../../services/notificaciones.service';

@Component({
  selector: 'app-notificaciones',
  standalone: true,
  templateUrl: './notificaciones.page.html',
  styleUrls: ['./notificaciones.page.scss'],
  imports: [IonContent],
})
export class NotificacionesPage {
  svc = inject(NotificacionesService);
  private router = inject(Router);

  icono(tipo: TipoAviso): string {
    switch (tipo) {
      case 'pago': return '\u2713';
      case 'comentario': return '\u25CF';
      case 'reserva': return '\u25C8';
      default: return '!';
    }
  }

  tiempo(ts: number): string {
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'Ayer' : `Hace ${d} d\u00EDas`;
  }

  abrir(a: Aviso) {
    this.svc.marcarLeida(a.id);
    const ruta = a.tipo === 'pago' ? '/tabs/pagos'
      : a.tipo === 'reserva' ? '/tabs/reservas'
      : '/tabs/comunidad';
    this.router.navigateByUrl(ruta);
  }

  descartar(ev: Event, a: Aviso) {
    ev.stopPropagation();
    this.svc.descartar(a.id);
  }
}
