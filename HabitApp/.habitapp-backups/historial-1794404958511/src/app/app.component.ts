import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { firebaseApp } from './core/firebase';
import { db } from './core/firestore';
import { AuthService } from './core/auth.service';
import { setConfigCuenta } from './core/cuenta.util';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private auth = inject(AuthService);
  private unsubConfig?: Unsubscribe;

  constructor() {
    console.log('Firebase conectado:', firebaseApp.options.projectId);

    // Cuando hay sesion, escucha los valores que el admin define en Configuracion
    this.auth.user$.subscribe((user) => {
      this.unsubConfig?.();
      this.unsubConfig = undefined;
      if (!user) return;
      this.unsubConfig = onSnapshot(
        doc(db, 'config', 'general'),
        (snap) => {
          const d = snap.data();
          if (!d) return;
          const gasto = Number(d['gastoComun']);
          const fondo = Number(d['fondoReserva']);
          if (gasto > 0) setConfigCuenta({ gastoComun: gasto });
          if (fondo >= 0) setConfigCuenta({ fondoReserva: fondo });
        },
        () => { /* sin permiso o sin conexion: se usan los valores por defecto */ }
      );
    });
  }
}