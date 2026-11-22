import { Component, inject } from '@angular/core';
import { IonTabs, IonTabBar, IonTabButton, IonLabel } from '@ionic/angular';
import { NotificacionesService } from '../services/notificaciones.service';

@Component({
  selector: 'app-tabs',
  standalone: true,
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  imports: [IonTabs, IonTabBar, IonTabButton, IonLabel],
})
export class TabsPage {
  private notif = inject(NotificacionesService);
  avisosPendientes = this.notif.sinLeer;
}
