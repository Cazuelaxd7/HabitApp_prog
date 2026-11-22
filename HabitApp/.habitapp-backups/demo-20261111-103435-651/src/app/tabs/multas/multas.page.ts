import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { IonContent, AlertController } from '@ionic/angular';
import { Unsubscribe } from 'firebase/firestore';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { MultasService } from '../../services/multas.service';
import { Multa } from '../../models/multa.model';

@Component({
  selector: 'app-multas',
  standalone: true,
  templateUrl: './multas.page.html',
  styleUrls: ['./multas.page.scss'],
  imports: [IonContent],
})
export class MultasPage implements OnInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);

  multas: Multa[] = [];
  private unsub: Unsubscribe | null = null;
  private navSub?: Subscription;

  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private authService: AuthService,
    private multasService: MultasService
  ) {}

  ngOnInit() {
    this.cargar();
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (e.urlAfterRedirects.includes('/tabs/multas')) this.cargar();
      });
  }

  ngOnDestroy() {
    this.unsub?.();
    this.navSub?.unsubscribe();
  }

  private cargar() {
    this.unsub?.();
    this.unsub = null;
    this.multas = [];
    this.cdr.markForCheck();

    const uid = this.authService.getCurrentUser()?.uid;
    if (!uid) return;

    this.unsub = this.multasService.escucharMisMultas(uid, (lista) => {
      this.multas = lista;
      this.cdr.markForCheck();
    });
  }

  get pendientes(): Multa[] {
    return this.multas.filter(m => m.estado === 'pendiente');
  }

  get pagadas(): Multa[] {
    return this.multas.filter(m => m.estado === 'pagada');
  }

  get totalPendiente(): number {
    return this.pendientes.reduce((suma, m) => suma + (m.monto || 0), 0);
  }

  get textoPendientes(): string {
    const n = this.pendientes.length;
    if (n === 0) return 'Sin multas pendientes';
    return n === 1 ? '1 multa pendiente' : `${n} multas pendientes`;
  }

  formatMonto(valor: number): string {
    return (valor || 0).toLocaleString('es-CL');
  }

  formatFecha(fecha: string): string {
    if (!fecha) return '-';
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y}`;
  }

  goBack() {
    this.router.navigateByUrl('/tabs/home');
  }

  /** Confirma y lleva a la pasarela Webpay de demostracion. */
  async pagar(multa: Multa) {
    const alert = await this.alertCtrl.create({
      header: 'Pagar multa',
      message: `\u00BFPagar $${this.formatMonto(multa.monto)} por "${multa.motivo}" con Webpay?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Pagar',
          handler: () => {
            this.router.navigateByUrl('/webpay?tipo=multa&multaId=' + multa.id);
          },
        },
      ],
    });
    await alert.present();
  }
}