import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { addDoc, collection, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../core/firestore';
import { AuthService } from '../core/auth.service';
import { pendienteDelMes } from '../core/cuenta.util';

type Estado = 'cargando' | 'form' | 'procesando' | 'ok' | 'rechazado' | 'error';
type Tipo = 'gasto' | 'multa' | 'reserva';

@Component({
  selector: 'app-webpay-sim',
  standalone: true,
  templateUrl: './webpay-sim.page.html',
  styleUrls: ['./webpay-sim.page.scss'],
  imports: [CommonModule, FormsModule, IonContent],
})
export class WebpaySimPage implements OnInit {
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  estado: Estado = 'cargando';
  tipo: Tipo = 'gasto';
  docId = '';
  concepto = '';
  mes = '';
  monto = 0;

  tarjeta = '';
  vence = '';
  cvv = '';
  nombre = '';
  error = '';

  // Voucher
  comprobante = '';
  autorizacion = '';
  ultimos4 = '';
  fechaHora = '';
  orden = '';

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    const t = q.get('tipo');
    this.tipo = t === 'multa' ? 'multa' : t === 'reserva' ? 'reserva' : 'gasto';
    this.docId = q.get('multaId') || q.get('reservaId') || '';
    const uid = this.auth.getCurrentUser()?.uid;

    try {
      if (this.tipo === 'gasto') {
        const p = pendienteDelMes();
        this.concepto = 'Gastos comunes';
        this.mes = p.mes;
        this.monto = p.total;
      } else if (this.tipo === 'multa') {
        const snap = await getDoc(doc(db, 'multas', this.docId));
        const m: any = snap.data();
        if (!snap.exists() || m.estado !== 'pendiente') throw new Error('Multa no válida');
        this.concepto = 'Multa: ' + m.motivo;
        this.monto = m.monto;
      } else {
        const snap = await getDoc(doc(db, 'reservas', this.docId));
        const r: any = snap.data();
        if (!snap.exists() || r.uid !== uid || !(r.monto > 0) || r.pagado === true) {
          throw new Error('Reserva no válida');
        }
        this.concepto = `Reserva: ${r.espacio} · ${r.fecha}`;
        this.monto = r.monto;
      }
      this.estado = 'form';
    } catch {
      this.estado = 'error';
    }
    this.cdr.markForCheck();
  }

  fmt(v: number) { return (v || 0).toLocaleString('es-CL'); }

  onTarjeta() {
    const d = this.tarjeta.replace(/\D/g, '').slice(0, 16);
    this.tarjeta = d.replace(/(.{4})/g, '$1 ').trim();
  }

  onVence() {
    const d = this.vence.replace(/\D/g, '').slice(0, 4);
    this.vence = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  }

  usarTarjetaPrueba() {
    this.tarjeta = '4051 8856 0044 6623';
    this.vence = '12/30';
    this.cvv = '123';
    this.nombre = this.auth.getCurrentUser()?.displayName || 'Residente HabitApp';
  }

  private destino(): string {
    if (this.tipo === 'multa') return '/tabs/multas';
    if (this.tipo === 'reserva') return '/tabs/reservas';
    return '/tabs/pagos';
  }

  /** Fecha local AAAA-MM-DD (para contar el ingreso en el mes correcto). */
  private hoyIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  cancelar() {
    this.router.navigateByUrl(this.destino(), { replaceUrl: true });
  }

  async pagar() {
    this.error = '';
    const num = this.tarjeta.replace(/\D/g, '');
    if (num.length !== 16) { this.error = 'Ingresa los 16 dígitos de la tarjeta.'; return; }
    if (!/^\d{2}\/\d{2}$/.test(this.vence)) { this.error = 'Ingresa la fecha como MM/AA.'; return; }
    if (this.cvv.length !== 3) { this.error = 'El CVV tiene 3 dígitos.'; return; }

    this.estado = 'procesando';
    this.cdr.markForCheck();
    await new Promise(r => setTimeout(r, 2200));

    // Tarjeta de prueba Mastercard: simula un rechazo
    if (num.startsWith('5186')) {
      this.estado = 'rechazado';
      this.cdr.markForCheck();
      return;
    }

    const uid = this.auth.getCurrentUser()?.uid;
    if (!uid) { this.estado = 'error'; this.cdr.markForCheck(); return; }

    const id = Date.now().toString(36).toUpperCase();
    this.comprobante = 'HB-' + id.slice(-8).padStart(8, '0');
    this.orden = 'OC' + id;
    this.autorizacion = String(Math.floor(100000 + Math.random() * 900000));
    this.ultimos4 = num.slice(-4);
    this.fechaHora = new Date().toLocaleString('es-CL');

    try {
      if (this.tipo === 'gasto') {
        await addDoc(collection(db, 'pagos'), {
          uid,
          concepto: this.concepto,
          mes: this.mes,
          monto: this.monto,
          metodo: 'Webpay',
          comprobante: this.comprobante,
          autorizacion: this.autorizacion,
          tarjeta: this.ultimos4,
          fecha: new Date().toLocaleDateString('es-CL'),
          pagadoEn: this.hoyIso(),
          createdAt: serverTimestamp(),
        });
      } else if (this.tipo === 'multa') {
        await updateDoc(doc(db, 'multas', this.docId), {
          estado: 'pagada',
          fechaPago: new Date().toLocaleDateString('es-CL'),
          comprobante: this.comprobante,
          pagadoEn: this.hoyIso(),
        });
      } else {
        await updateDoc(doc(db, 'reservas', this.docId), {
          pagado: true,
          metodoPago: 'Webpay',
          comprobante: this.comprobante,
          autorizacion: this.autorizacion,
          pagadoEn: this.hoyIso(),
        });
      }
      this.estado = 'ok';
    } catch (e) {
      console.error(e);
      this.estado = 'error';
    }
    this.cdr.markForCheck();
  }

  imprimir() { window.print(); }

  volver() {
    this.router.navigateByUrl(this.destino(), { replaceUrl: true });
  }

  reintentar() {
    this.estado = 'form';
    this.cdr.markForCheck();
  }
}