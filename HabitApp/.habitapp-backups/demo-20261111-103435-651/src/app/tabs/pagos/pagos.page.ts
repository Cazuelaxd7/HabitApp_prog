import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { Unsubscribe } from 'firebase/firestore';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { pendienteDelMes } from '../../core/cuenta.util';
import { PagosService } from '../../services/pagos.service';
import { Pago, PagoPendiente } from '../../models/pago.model';

@Component({
  selector: 'app-pagos',
  standalone: true,
  templateUrl: './pagos.page.html',
  styleUrls: ['./pagos.page.scss'],
  imports: [CommonModule, IonContent],
})
export class PagosPage implements OnInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);

  pendiente: PagoPendiente | null = pendienteDelMes();
  historial: Pago[] = [];

  modalAbierto = false;
  procesando = false;
  comprobanteGenerado: string | null = null;
  metodoSeleccionado: string | null = null;
  pagoEnProceso: PagoPendiente | null = null;

  // Estos los usa el html de la transferencia. Quedan vacios hasta conectar
  // las transferencias con el panel admin (el boton se deshabilita solo si banco es null)
  solicitudActual: any = null;
  transferenciaEnviada = false;
  banco: any = null;
  referencia = '';

  private uid = '';
  private unsubscribe: Unsubscribe | null = null;
  private navSub?: Subscription;

  constructor(
    private router: Router,
    private authService: AuthService,
    private pagosService: PagosService
  ) {}

  ngOnInit() {
    this.cargar();
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (e.urlAfterRedirects.includes('/tabs/pagos')) this.cargar();
      });
  }

  ngOnDestroy() {
    this.unsubscribe?.();
    this.navSub?.unsubscribe();
  }

  private cargar() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.historial = [];
    this.pendiente = pendienteDelMes();
    this.uid = this.authService.getCurrentUser()?.uid || '';
    this.cdr.markForCheck();
    if (!this.uid) return;

    this.unsubscribe = this.pagosService.escucharHistorial(this.uid, (pagos) => {
      this.historial = pagos;
      const base = pendienteDelMes();
      const yaPago = pagos.some(h => h.mes === base.mes);
      this.pendiente = yaPago ? null : base;
      this.cdr.markForCheck();
    });
  }

  goBack() {
    this.router.navigateByUrl('/tabs/home');
  }

  formatMonto(valor: number): string {
    return valor.toLocaleString('es-CL');
  }

  abrirModalPago() {
    if (!this.pendiente) return;
    this.pagoEnProceso = { ...this.pendiente };
    this.modalAbierto = true;
    this.metodoSeleccionado = 'Webpay';
    this.comprobanteGenerado = null;
    this.procesando = false;
  }

  cerrarModal() {
    if (this.procesando) return;
    this.modalAbierto = false;
    this.metodoSeleccionado = null;
    this.comprobanteGenerado = null;
    this.pagoEnProceso = null;
  }

  seleccionarMetodo(metodo: string) {
    this.metodoSeleccionado = metodo;
  }

  copiarBanco(cuenta: any) {
    const texto = typeof cuenta === 'string' ? cuenta : JSON.stringify(cuenta);
    navigator.clipboard?.writeText(texto);
  }

  // Webpay lleva a la pasarela de demostracion; transferencia aun no esta conectada
  confirmarPago() {
    if (!this.uid) return;
    if (this.metodoSeleccionado !== 'Webpay') return;
    this.modalAbierto = false;
    this.router.navigateByUrl('/webpay?tipo=gasto');
  }
}
