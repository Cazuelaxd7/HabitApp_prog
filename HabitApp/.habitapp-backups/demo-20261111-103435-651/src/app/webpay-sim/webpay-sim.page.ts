import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { addDoc, collection, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../core/firestore';
import { AuthService } from '../core/auth.service';
import { UsuariosService } from '../services/usuarios.service';
import { pendienteDelMes } from '../core/cuenta.util';

type Estado = 'cargando' | 'form' | 'procesando' | 'ok' | 'rechazado' | 'error';

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
  private usuarios = inject(UsuariosService);

  estado: Estado = 'cargando';
  tipo: 'gasto' | 'multa' = 'gasto';
  multaId = '';
  concepto = '';
  mes = '';
  monto = 0;

  tarjeta = '';
  vence = '';
  cvv = '';
  nombre = '';
  error = '';

  // Datos del voucher
  comprobante = '';
  autorizacion = '';
  ultimos4 = '';
  fechaHora = '';
  orden = '';

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    this.tipo = q.get('tipo') === 'multa' ? 'multa' : 'gasto';
    this.multaId = q.get('multaId') || '';

    try {
      if (this.tipo === 'gasto') {
        const p = pendienteDelMes();
        this.concepto = 'Gastos comunes';
        this.mes = p.mes;
        this.monto = p.total;
      } else {
        const snap = await getDoc(doc(db, 'multas', this.multaId));
        const m: any = snap.data();
        if (!snap.exists() || m.estado !== 'pendiente') throw new Error('Multa no valida');
        this.concepto = 'Multa: ' + m.motivo;
        this.monto = m.monto;
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

  cancelar() {
    this.router.navigateByUrl(this.tipo === 'multa' ? '/tabs/multas' : '/tabs/pagos', { replaceUrl: true });
  }

  volver() {
    this.cancelar();
  }

  reintentar() {
    this.error = '';
    this.cvv = '';
    this.estado = 'form';
    this.cdr.markForCheck();
  }

  imprimir() {
    window.print();
  }

  async pagar() {
    this.error = '';
    const num = this.tarjeta.replace(/\D/g, '');
    if (num.length !== 16) { this.error = 'Ingresa los 16 d\u00EDgitos de la tarjeta.'; return; }
    if (!/^\d{2}\/\d{2}$/.test(this.vence)) { this.error = 'Ingresa la fecha como MM/AA.'; return; }
    if (this.cvv.length !== 3) { this.error = 'El CVV tiene 3 d\u00EDgitos.'; return; }

    this.estado = 'procesando';
    this.cdr.markForCheck();
    await new Promise(r => setTimeout(r, 2200));

    // Tarjeta de prueba que empieza con 5186: simula un rechazo
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
        // Mismo formato que usa PagosService para que el panel admin lo lea igual
        const perfil = await this.usuarios.obtenerPerfil(uid);
        await addDoc(collection(db, 'pagos'), {
          uid,
          codigo: perfil?.codigo ?? null,
          condominioId: perfil?.condominioId ?? null,
          torre: perfil?.torre ?? null,
          depto: perfil?.depto ?? null,
          correo: perfil?.correo ?? null,
          concepto: this.concepto,
          mes: this.mes,
          monto: this.monto,
          fecha: new Date().toLocaleDateString('es-CL'),
          metodo: 'Webpay',
          comprobante: this.comprobante,
          autorizacion: this.autorizacion,
          tarjeta: this.ultimos4,
          emailEnviado: false,
          createdAt: serverTimestamp(),
        });
      } else {
        // Solo toco los 3 campos que permiten las reglas de Firestore
        await updateDoc(doc(db, 'multas', this.multaId), {
          estado: 'pagada',
          fechaPago: new Date().toLocaleDateString('es-CL'),
          comprobante: this.comprobante,
        });
      }
      this.estado = 'ok';
    } catch (e) {
      console.error(e);
      this.estado = 'error';
    }
    this.cdr.markForCheck();
  }
}
