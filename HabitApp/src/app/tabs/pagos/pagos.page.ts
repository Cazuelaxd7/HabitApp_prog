import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { Unsubscribe } from 'firebase/firestore';
import { Subscription, filter } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { pendienteDelMes } from '../../core/cuenta.util';
import { PagoDemo, PagosDemoService, errorPagoDemo } from '../../services/pagos-demo.service';
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

  private demo = inject(PagosDemoService);

  demostraciones: PagoDemo[] = [];
  mensaje = '';

  private unsubDemo?: Unsubscribe;
  private unsubBanco?: Unsubscribe;

  pendiente: PagoPendiente | null = pendienteDelMes();
  historial: Pago[] = [];

  // Información de abonos parciales.
  montoAbonado = 0;
  pagoParcial = false;

  modalAbierto = false;
  procesando = false;
  comprobanteGenerado: string | null = null;
  metodoSeleccionado: string | null = null;
  pagoEnProceso: PagoPendiente | null = null;

  // Datos bancarios compartidos con la configuración del administrador.
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
      .subscribe(e => {
        if (e.urlAfterRedirects.includes('/tabs/pagos')) {
          this.cargar();
        }
      });
  }

  ngOnDestroy() {
    this.unsubscribe?.();
    this.navSub?.unsubscribe();
    this.unsubDemo?.();
    this.unsubBanco?.();
  }

  private cargar() {
    this.unsubscribe?.();
    this.unsubDemo?.();
    this.unsubBanco?.();

    this.demostraciones = [];
    this.unsubscribe = null;
    this.historial = [];

    this.pendiente = pendienteDelMes();
    this.montoAbonado = 0;
    this.pagoParcial = false;
    this.solicitudActual = null;

    this.uid = this.authService.getCurrentUser()?.uid || '';

    this.cdr.markForCheck();

    if (!this.uid) return;

    this.unsubBanco = this.pagosService.escucharBanco(cuenta => {
      this.banco = cuenta;
      this.cdr.markForCheck();
    });

    this.unsubDemo = this.demo.escuchar(
      this.uid,
      lista => {
        this.demostraciones = lista;

        this.solicitudActual = lista.find(
          p =>
            p.tipo === 'gasto' &&
            p.mes === pendienteDelMes().mes
        ) || null;

        this.cdr.markForCheck();
      },
      e => {
        this.mensaje = errorPagoDemo(e);
        this.cdr.markForCheck();
      }
    );

    this.unsubscribe = this.pagosService.escucharHistorial(
      this.uid,
      pagos => {
        this.historial = pagos;

        const base = pendienteDelMes();

        // Solo los pagos aprobados reducen la deuda.
        const aprobados = pagos.filter(p =>
          p.mes === base.mes &&
          (!p.estado || p.estado === 'aprobado')
        );

        this.montoAbonado = aprobados.reduce(
          (suma, p) => suma + Math.max(0, Number(p.monto) || 0),
          0
        );

        const saldoPendiente = Math.max(
          base.total - this.montoAbonado,
          0
        );

        this.pagoParcial =
          this.montoAbonado > 0 &&
          saldoPendiente > 0;

        this.pendiente = saldoPendiente === 0
          ? null
          : base;

        this.cdr.markForCheck();
      }
    );
  }

  goBack() {
    this.router.navigateByUrl('/tabs/home');
  }

  formatMonto(valor: number): string {
    return valor.toLocaleString('es-CL');
  }

  abrirModalPago() {
    if (
      !this.pendiente ||
      this.pagoParcial ||
      this.solicitudActual?.estado === 'en_revision'
    ) {
      return;
    }

    this.pagoEnProceso = { ...this.pendiente };
    this.modalAbierto = true;
    this.metodoSeleccionado = 'Webpay';
    this.comprobanteGenerado = null;
    this.transferenciaEnviada = false;
    this.referencia = '';
    this.mensaje = '';
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

  async copiarBanco(cuenta: Record<string, string>) {
    const texto =
      `Titular: ${cuenta['titular']}\n` +
      `RUT: ${cuenta['rut']}\n` +
      `Banco: ${cuenta['banco']}\n` +
      `Tipo: ${cuenta['tipo']}\n` +
      `Cuenta: ${cuenta['cuenta']}\n` +
      `Correo: ${cuenta['correo']}`;

    try {
      if (!navigator.clipboard) {
        throw new Error('Portapapeles no disponible');
      }

      await navigator.clipboard.writeText(texto);

      this.mensaje = 'Datos bancarios copiados.';
    } catch {
      this.mensaje =
        'No se pudo copiar. Selecciona y copia los datos manualmente.';
    }

    this.cdr.markForCheck();
  }

  async confirmarPago() {
    if (
      !this.uid ||
      this.procesando ||
      !this.pagoEnProceso ||
      this.pagoParcial
    ) {
      return;
    }

    if (this.metodoSeleccionado === 'Webpay') {
      this.modalAbierto = false;
      await this.router.navigateByUrl('/webpay?tipo=gasto');
      return;
    }

    if (this.metodoSeleccionado !== 'Transferencia') {
      return;
    }

    this.procesando = true;
    this.mensaje = '';

    try {
      const concepto = await this.demo.concepto('gasto');

      if (
        concepto.monto !== this.pagoEnProceso.total ||
        concepto.mes !== this.pagoEnProceso.mes
      ) {
        throw new Error(
          'El cobro cambió. Cierra y vuelve a abrir el pago.'
        );
      }

      const resultado = await this.demo.registrar(
        concepto,
        'Transferencia demo',
        'en_revision',
        this.referencia
      );

      this.transferenciaEnviada = true;

      this.mensaje = resultado.estado === 'en_revision'
        ? 'Solicitud enviada al administrador.'
        : resultado.estado === 'rechazado'
          ? 'La solicitud anterior fue rechazada. Puedes volver a intentarlo.'
          : 'Este período ya tiene un pago aprobado.';
    } catch (e) {
      this.mensaje = errorPagoDemo(e);
    } finally {
      this.procesando = false;
      this.cdr.markForCheck();
    }
  }
}