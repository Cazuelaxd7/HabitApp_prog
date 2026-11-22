import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from '../core/firestore';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-pendiente',
  standalone: true,
  templateUrl: './pendiente.page.html',
  styleUrls: ['./pendiente.page.scss'],
  imports: [IonContent],
})
export class PendientePage implements OnInit, OnDestroy {
  private router = inject(Router);
  private auth = inject(AuthService);
  private unsub?: Unsubscribe;

  nombre = this.auth.getCurrentUser()?.displayName || this.auth.getCurrentUser()?.email || '';

  ngOnInit() {
    const uid = this.auth.getCurrentUser()?.uid;
    if (!uid) {
      this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    // Si el admin activa la cuenta, entra solo
    this.unsub = onSnapshot(doc(db, 'usuarios', uid), (snap) => {
      const d = snap.data();
      if (!d) return;
      if (d['rol'] === 'admin') this.router.navigateByUrl('/admin', { replaceUrl: true });
      else if ((d['estado'] ?? 'activo') === 'activo') this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    });
  }

  ngOnDestroy() {
    this.unsub?.();
  }

  async salir() {
    this.unsub?.();
    await this.auth.logout();
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}