import { PagoDemo, PagosDemoService, errorPagoDemo } from '../services/pagos-demo.service';
import { Component, OnInit, OnDestroy, signal, computed, inject, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, ToastController } from '@ionic/angular';
import {
  collection, query, orderBy, onSnapshot, addDoc, deleteDoc, updateDoc, setDoc,
  doc, serverTimestamp, Unsubscribe,
} from 'firebase/firestore';
import { PagosService, CuentaBancaria, camposBanco, SolicitudPago } from '../services/pagos.service';
import { db } from '../core/firestore';
import { AuthService } from '../core/auth.service';
import { mesActual } from '../core/cuenta.util';

type Seccion =
  | 'dashboard' | 'residentes' | 'pagos' | 'egresos' | 'multas' | 'reservas'
  | 'comunidad' | 'avisos' | 'reportes' | 'configuracion';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

@Component({
  selector: 'app-admin',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  imports: [IonContent],
})
export class AdminPage implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private toastCtrl = inject(ToastController);

  readonly secciones: { id: Seccion; label: string; icono: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icono: '⌂' },
    { id: 'residentes', label: 'Residentes', icono: '♙' },
    { id: 'pagos', label: 'Gastos comunes', icono: '$' },
    { id: 'egresos', label: 'Egresos', icono: '↧' },
    { id: 'multas', label: 'Multas', icono: '!' },
    { id: 'reservas', label: 'Reservas', icono: '□' },
    { id: 'comunidad', label: 'Comunidad', icono: '☷' },
    { id: 'avisos', label: 'Avisos', icono: '◉' },
    { id: 'reportes', label: 'Reportes', icono: '▥' },
    { id: 'configuracion', label: 'Configuración', icono: '⚙' },
  ];

  readonly espacios = ['Quincho', 'Sala multiuso', 'Cancha'];
  readonly categoriasEgreso = ['Mantención', 'Remuneraciones', 'Servicios básicos', 'Seguridad', 'Limpieza', 'Reparaciones', 'Otros'];
  readonly mes = mesActual();
  readonly miUid = this.authService.getCurrentUser()?.uid || '';

  seccion = signal<Seccion>('dashboard');
  menuAbierto = signal(false);
  panelNotif = signal(false);
  busqueda = signal('');

  usuarios = signal<any[]>([]);
  pagos = signal<any[]>([]);
  reservas = signal<any[]>([]);
  posts = signal<any[]>([]);
  multas = signal<any[]>([]);
  egresos = signal<any[]>([]);

  // Configuracion (Firestore: config/general)
  config = signal({ gastoComun: 40000, fondoReserva: 5000 });
  cfgGasto = signal('40000');
  cfgFondo = signal('5000');
  nuevoAdminEmail = signal('');

  // Formulario de nueva multa
  mUid = signal('');
  mMotivo = signal('');
  mMonto = signal('');
  mFecha = signal(this.hoyStr());

  // Formulario de nuevo egreso
  eConcepto = signal('');
  eCategoria = signal('Mantención');
  eMonto = signal('');
  eFecha = signal(this.hoyStr());

  nombreAdmin = signal('Administrador');

  private unsubs: Unsubscribe[] = [];
  private servicioPagos = inject(PagosService);
  private servicioDemo = inject(PagosDemoService);
  pagosDemo = signal<PagoDemo[]>([]);
  errorDemo = signal('');
  resolviendoDemo = signal(false);
  totalDemo = computed(() => this.pagosDemo().filter(p => p.estado === 'aprobado').reduce((s,p) => s + p.monto, 0));
  async resolverDemo(pago: PagoDemo, aprobar: boolean) {
    if (this.resolviendoDemo()) return;
    this.resolviendoDemo.set(true);
    try {
      await this.servicioDemo.resolver(pago.id, aprobar);
      this.mostrarToast(aprobar ? 'Demostración aprobada. No se registró un ingreso real.' : 'Demostración rechazada.');
    } catch (e) { this.mostrarToast(errorPagoDemo(e), 'danger'); }
    finally { this.resolviendoDemo.set(false); }
  }
  camposBanco = camposBanco;
  datosBanco = signal<CuentaBancaria>({ titular: '', rut: '', banco: '', tipo: '', cuenta: '', correo: '' });
  transferencias = signal<SolicitudPago[]>([]);
  conciliando = signal(false);

  editarBanco(campo: typeof camposBanco[number], valor: string) {
    this.datosBanco.set({ ...this.datosBanco(), [campo]: valor });
  }

  async guardarBanco() {
    const cuenta = Object.fromEntries(camposBanco.map(c => [c, this.datosBanco()[c].trim()]));
    if (camposBanco.some(c => !cuenta[c] || cuenta[c].length > 120) ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuenta['correo'])) {
      return this.mostrarToast('Completa los datos bancarios y revisa el correo.', 'warning');
    }
    try {
      await setDoc(doc(db, 'config', 'transferencia'), cuenta);
      this.mostrarToast('Cuenta de transferencia guardada.');
    } catch {
      this.mostrarToast('No se pudieron guardar los datos bancarios.', 'danger');
    }
  }

  async resolverTransferencia(solicitud: SolicitudPago, aprobar: boolean) {
    if (this.conciliando()) return;
    if (!confirm(aprobar
      ? '¿Verificaste el abono y su referencia en la cartola bancaria?'
      : '¿Rechazar esta solicitud de transferencia?')) return;
    this.conciliando.set(true);
    try {
      await this.servicioPagos.conciliar(solicitud, aprobar);
      this.mostrarToast(aprobar ? 'Transferencia conciliada.' : 'Transferencia rechazada.');
    } catch (error) {
      this.mostrarToast(error instanceof Error ? error.message : 'No se pudo conciliar.', 'danger');
    } finally {
      this.conciliando.set(false);
    }
  }

  private primeraCargaUsuarios = true;

  // ---------- Derivados: residentes y gasto comun ----------
  valorTotal = computed(() => this.config().gastoComun + this.config().fondoReserva);
  residentes = computed(() => this.usuarios().filter(u => u.rol !== 'admin'));
  admins = computed(() => this.usuarios().filter(u => u.rol === 'admin'));
  pendientesRegistro = computed(() => this.residentes().filter(u => u.estado === 'pendiente'));

  pagosMes = computed(() => this.pagos().filter(p => p.mes === this.mes));
  pagadosUids = computed(() => new Set(this.pagosMes().map(p => p.uid)));
  pagadosResidentes = computed(() =>
    this.residentes().filter(u => this.pagadosUids().has(u.uid)).length
  );
  totalRecaudado = computed(() =>
    this.pagosMes()
      .filter(p => this.residentes().some(u => u.uid === p.uid))
      .reduce((s, p) => s + (p.monto || 0), 0)
  );
  montoEsperado = computed(() => this.residentes().length * this.valorTotal());
  porcentaje = computed(() =>
    this.montoEsperado() > 0 ? Math.round((this.totalRecaudado() / this.montoEsperado()) * 100) : 0
  );
  pendientes = computed(() => this.residentes().filter(u => !this.pagadosUids().has(u.uid)).length);
  montoPendiente = computed(() => Math.max(this.montoEsperado() - this.totalRecaudado(), 0));
  morosidad = computed(() =>
    this.residentes().length > 0
      ? Math.round((this.pendientes() / this.residentes().length) * 100)
      : 0
  );
  morosos = computed(() => this.residentes().filter(u => !this.pagadosUids().has(u.uid)));

  // ---------- Derivados: ingresos y egresos ----------
  // Ingresos = gastos comunes pagados + multas pagadas. Egresos = gastos registrados por el admin.
  serieFinanzas = computed(() => {
    const hoy = new Date();
    const claves: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const x = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      claves.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    const ing = new Map<string, number>();
    const egr = new Map<string, number>();
    const suma = (m: Map<string, number>, k: string, v: number) => { if (k) m.set(k, (m.get(k) || 0) + v); };

    this.pagos().forEach(p => suma(ing, this.claveDeLabel(p.mes), p.monto || 0));
    this.multas().filter(m => m.estado === 'pagada').forEach(m => suma(ing, (m.fecha || '').slice(0, 7), m.monto || 0));
    this.egresos().forEach(e => suma(egr, (e.fecha || '').slice(0, 7), e.monto || 0));

    const filas = claves.map(k => ({
      clave: k,
      etiqueta: MESES_CORTO[parseInt(k.slice(5, 7), 10) - 1],
      ingresos: ing.get(k) || 0,
      egresos: egr.get(k) || 0,
    }));
    const max = Math.max(1, ...filas.flatMap(f => [f.ingresos, f.egresos]));
    return filas.map(f => ({
      ...f,
      pi: f.ingresos > 0 ? Math.max(Math.round((f.ingresos / max) * 100), 3) : 0,
      pe: f.egresos > 0 ? Math.max(Math.round((f.egresos / max) * 100), 3) : 0,
    }));
  });

  finMes = computed(() => {
    const f = this.serieFinanzas()[5];
    return { ingresos: f.ingresos, egresos: f.egresos, balance: f.ingresos - f.egresos };
  });

  ingresosTotal = computed(() =>
    this.pagos().reduce((s, p) => s + (p.monto || 0), 0) +
    this.multas().filter(m => m.estado === 'pagada').reduce((s, m) => s + (m.monto || 0), 0)
  );
  egresosTotal = computed(() => this.egresos().reduce((s, e) => s + (e.monto || 0), 0));
  saldoCaja = computed(() => this.ingresosTotal() - this.egresosTotal());

  egresosOrdenados = computed(() =>
    [...this.egresos()].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  );
  egresosPorCategoria = computed(() => {
    const clave = this.hoyStr().slice(0, 7);
    const m = new Map<string, number>();
    this.egresos().filter(e => (e.fecha || '').startsWith(clave))
      .forEach(e => m.set(e.categoria || 'Otros', (m.get(e.categoria || 'Otros') || 0) + (e.monto || 0)));
    const arr = [...m.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...arr.map(a => a.total));
    return arr.map(a => ({ ...a, pct: Math.round((a.total / max) * 100) }));
  });

  hoy = this.hoyStr();
  reservasHoy = computed(() =>
    this.reservas().filter(r => r.fecha === this.hoy && r.estado === 'upcoming')
  );
  reservasProximas = computed(() =>
    this.reservas()
      .filter(r => r.fecha >= this.hoy && r.estado === 'upcoming')
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
  );
  reservasPorEspacio = computed(() =>
    this.espacios.map(e => ({
      espacio: e,
      total: this.reservas().filter(r => r.espacio === e && r.estado === 'upcoming').length,
    }))
  );
  avisos = computed(() => this.posts().filter(p => p.category === 'administracion'));
  totalComentarios = computed(() => this.posts().reduce((s, p) => s + (p.commentsCount || 0), 0));

  multasOrdenadas = computed(() =>
    [...this.multas()].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  );
  multasPendientes = computed(() => this.multas().filter(m => m.estado === 'pendiente'));
  totalMultasPendientes = computed(() =>
    this.multasPendientes().reduce((s, m) => s + (m.monto || 0), 0)
  );

  residentesFiltrados = computed(() => {
    const f = this.busqueda().toLowerCase();
    return this.residentes().filter(u =>
      (u.nombre || '').toLowerCase().includes(f) || (u.correo || '').toLowerCase().includes(f)
    );
  });

  historialPagos = computed(() =>
    [...this.pagos()].sort((a, b) => this.ts(b) - this.ts(a)).slice(0, 40)
  );

  actividad = computed(() => {
    const items = [
      ...this.pagosMes().map(p => ({
        ts: this.ts(p), icono: '$', titulo: 'Pago recibido',
        texto: `${this.nombreDe(p.uid)} pagó gastos comunes.`,
      })),
      ...this.reservas().map(r => ({
        ts: this.ts(r), icono: '□', titulo: 'Nueva reserva',
        texto: `Se reservó ${r.espacio}.`,
      })),
      ...this.posts().map(p => ({
        ts: this.ts(p), icono: '☷', titulo: 'Nueva publicación',
        texto: `${p.author} publicó en Comunidad.`,
      })),
    ];
    return items.sort((a, b) => b.ts - a.ts).slice(0, 6);
  });

  // ---------- Ciclo de vida ----------
  ngOnInit() {
    const user = this.authService.getCurrentUser();
    this.nombreAdmin.set(user?.displayName || user?.email || 'Administrador');

    const err = (e: any) => {
      console.error(e);
      this.mostrarToast('Error leyendo datos: ' + (e?.code || 'desconocido'), 'danger');
    };

    this.unsubs.push(
      this.servicioDemo.escuchar(null, lista => { this.pagosDemo.set(lista); this.errorDemo.set(''); }, e => this.errorDemo.set(errorPagoDemo(e))),
      onSnapshot(collection(db, 'usuarios'), s => {
        // Aviso cuando llega un registro nuevo con el panel abierto
        if (!this.primeraCargaUsuarios) {
          s.docChanges().forEach(ch => {
            const d: any = ch.doc.data();
            if (ch.type === 'added' && d.estado === 'pendiente') {
              this.mostrarToast(`Nuevo registro: ${d.nombre || 'residente'} espera verificación`, 'warning');
            }
          });
        }
        this.primeraCargaUsuarios = false;
        this.usuarios.set(s.docs.map(d => ({ uid: d.id, ...d.data() })));
      }, err),
      this.servicioPagos.escucharBanco(cuenta => {
        if (cuenta) this.datosBanco.set(cuenta);
      }),
      this.servicioPagos.escucharSolicitudes(null, solicitudes => {
        this.transferencias.set(solicitudes.filter(s => s.metodo === 'Transferencia' && s.estado === 'en_revision'));
      }),
      onSnapshot(collection(db, 'pagos'),
        s => this.pagos.set(s.docs.map(d => ({ id: d.id, ...d.data() }))), err),
      onSnapshot(collection(db, 'reservas'),
        s => this.reservas.set(s.docs.map(d => ({ id: d.id, ...d.data() }))), err),
      onSnapshot(collection(db, 'multas'),
        s => this.multas.set(s.docs.map(d => ({ id: d.id, ...d.data() }))), err),
      onSnapshot(collection(db, 'egresos'),
        s => this.egresos.set(s.docs.map(d => ({ id: d.id, ...d.data() }))), err),
      onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc')),
        s => this.posts.set(s.docs.map(d => ({ id: d.id, ...d.data() }))), err),
      onSnapshot(doc(db, 'config', 'general'), s => {
        const d: any = s.data();
        if (!d) return;
        const gasto = Number(d.gastoComun) > 0 ? Number(d.gastoComun) : 40000;
        const fondo = Number(d.fondoReserva) >= 0 ? Number(d.fondoReserva) : 5000;
        this.config.set({ gastoComun: gasto, fondoReserva: fondo });
        this.cfgGasto.set(String(gasto));
        this.cfgFondo.set(String(fondo));
      }, () => { /* aun no existe: se usan los valores por defecto */ }),
    );
  }

  ngOnDestroy() {
    this.unsubs.forEach(u => u());
  }

  // ---------- Navegación ----------
  ir(s: Seccion) {
    this.seccion.set(s);
    this.menuAbierto.set(false);
    this.panelNotif.set(false);
  }

  async cerrarSesion() {
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    await this.authService.logout();
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  // ---------- Acciones ----------
  async cancelarReserva(id: string) {
    if (!confirm('¿Cancelar esta reserva?')) return;
    try {
      await updateDoc(doc(db, 'reservas', id), { estado: 'cancelled' });
      this.mostrarToast('Reserva cancelada');
    } catch {
      this.mostrarToast('No se pudo cancelar la reserva', 'danger');
    }
  }

  async eliminarPost(id: string, tipo: 'publicación' | 'aviso') {
    if (!confirm(`¿Eliminar esta ${tipo}?`)) return;
    try {
      await deleteDoc(doc(db, 'posts', id));
      this.mostrarToast(tipo === 'aviso' ? 'Aviso eliminado' : 'Publicación eliminada');
    } catch {
      this.mostrarToast('No se pudo eliminar', 'danger');
    }
  }

  async activarUsuario(uid: string) {
    try {
      await updateDoc(doc(db, 'usuarios', uid), { estado: 'activo' });
      this.mostrarToast('Residente verificado');
    } catch {
      this.mostrarToast('No se pudo verificar al residente', 'danger');
    }
  }

  async publicarAviso(titulo: string, cuerpo: string, tituloEl: HTMLInputElement, cuerpoEl: HTMLTextAreaElement) {
    titulo = titulo.trim();
    cuerpo = cuerpo.trim();
    if (!titulo || !cuerpo) {
      this.mostrarToast('Completa el título y el contenido', 'warning');
      return;
    }
    try {
      await addDoc(collection(db, 'posts'), {
        author: 'Administración',
        authorUid: this.authService.getCurrentUser()?.uid || '',
        avatarColor: '#111114',
        title: titulo,
        body: cuerpo,
        tag: 'Administración',
        tagColor: 'primary',
        category: 'administracion',
        likedBy: [],
        commentsCount: 0,
        createdAt: serverTimestamp(),
      });
      tituloEl.value = '';
      cuerpoEl.value = '';
      this.mostrarToast('Aviso publicado');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast('No se pudo publicar el aviso', 'danger');
    }
  }

  async crearMulta() {
    const uid = this.mUid();
    const motivo = this.mMotivo().trim();
    const monto = Number(this.mMonto());
    const fecha = this.mFecha();

    if (!uid || !motivo || !fecha || !(monto > 0)) {
      this.mostrarToast('Completa residente, motivo, monto y fecha', 'warning');
      return;
    }
    try {
      await addDoc(collection(db, 'multas'), {
        uid, motivo, monto: Math.round(monto), fecha,
        estado: 'pendiente', createdAt: serverTimestamp(),
      });
      this.mUid.set('');
      this.mMotivo.set('');
      this.mMonto.set('');
      this.mFecha.set(this.hoyStr());
      this.mostrarToast('Multa creada');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast('No se pudo crear la multa: ' + (e?.code || 'error'), 'danger');
    }
  }

  async marcarMultaPagada(id: string) {
    if (!confirm('¿Marcar esta multa como pagada?')) return;
    try {
      await updateDoc(doc(db, 'multas', id), {
        estado: 'pagada',
        fechaPago: new Date().toLocaleDateString('es-CL'),
        comprobante: 'MU-' + Date.now().toString(36).toUpperCase(),
      });
      this.mostrarToast('Multa marcada como pagada');
    } catch {
      this.mostrarToast('No se pudo actualizar la multa', 'danger');
    }
  }

  async eliminarMulta(id: string) {
    if (!confirm('¿Eliminar esta multa?')) return;
    try {
      await deleteDoc(doc(db, 'multas', id));
      this.mostrarToast('Multa eliminada');
    } catch {
      this.mostrarToast('No se pudo eliminar (revisa las reglas de Firestore)', 'danger');
    }
  }

  // ---------- Egresos ----------
  async crearEgreso() {
    const concepto = this.eConcepto().trim();
    const monto = Math.round(Number(this.eMonto()));
    const fecha = this.eFecha();
    if (!concepto || !fecha || !(monto > 0)) {
      this.mostrarToast('Completa concepto, monto y fecha', 'warning');
      return;
    }
    try {
      await addDoc(collection(db, 'egresos'), {
        concepto,
        categoria: this.eCategoria(),
        monto,
        fecha,
        creadoPor: this.miUid,
        createdAt: serverTimestamp(),
      });
      this.eConcepto.set('');
      this.eMonto.set('');
      this.eFecha.set(this.hoyStr());
      this.mostrarToast('Egreso registrado');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast('No se pudo registrar: ' + (e?.code || 'error'), 'danger');
    }
  }

  async eliminarEgreso(id: string) {
    if (!confirm('¿Eliminar este egreso?')) return;
    try {
      await deleteDoc(doc(db, 'egresos', id));
      this.mostrarToast('Egreso eliminado');
    } catch {
      this.mostrarToast('No se pudo eliminar el egreso', 'danger');
    }
  }

  // ---------- Configuración ----------
  async guardarConfig() {
    const gasto = Math.round(Number(this.cfgGasto()));
    const fondo = Math.round(Number(this.cfgFondo()));
    if (!(gasto > 0) || !(fondo >= 0)) {
      this.mostrarToast('Ingresa montos válidos', 'warning');
      return;
    }
    try {
      await setDoc(doc(db, 'config', 'general'), {
        gastoComun: gasto, fondoReserva: fondo, updatedAt: serverTimestamp(),
      }, { merge: true });
      this.mostrarToast('Valores guardados');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast('No se pudo guardar: ' + (e?.code || 'error'), 'danger');
    }
  }

  async agregarAdmin() {
    const email = this.nuevoAdminEmail().trim().toLowerCase();
    if (!email) {
      this.mostrarToast('Escribe el correo de la persona', 'warning');
      return;
    }
    const u = this.usuarios().find(x => (x.correo || '').toLowerCase() === email);
    if (!u) {
      this.mostrarToast('Ese correo no está registrado. Pídele que cree su cuenta primero.', 'warning');
      return;
    }
    if (u.rol === 'admin') {
      this.mostrarToast('Esa persona ya es administradora', 'warning');
      return;
    }
    if (!confirm(`¿Dar permisos de administrador a ${u.nombre || u.correo}?`)) return;
    try {
      await updateDoc(doc(db, 'usuarios', u.uid), { rol: 'admin', estado: 'activo' });
      this.nuevoAdminEmail.set('');
      this.mostrarToast('Administrador agregado');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast('No se pudo agregar: ' + (e?.code || 'error'), 'danger');
    }
  }

  async hacerAdmin(uid: string) {
    const u = this.usuarios().find(x => x.uid === uid);
    if (!u || !confirm(`¿Dar permisos de administrador a ${u.nombre || u.correo}?`)) return;
    try {
      await updateDoc(doc(db, 'usuarios', uid), { rol: 'admin', estado: 'activo' });
      this.mostrarToast('Administrador agregado');
    } catch {
      this.mostrarToast('No se pudo cambiar el rol', 'danger');
    }
  }

  async quitarAdmin(uid: string) {
    if (uid === this.miUid) {
      this.mostrarToast('No puedes quitarte tus propios permisos', 'warning');
      return;
    }
    if (this.admins().length <= 1) {
      this.mostrarToast('Debe quedar al menos un administrador', 'warning');
      return;
    }
    if (!confirm('¿Quitar los permisos de administrador a esta persona?')) return;
    try {
      await updateDoc(doc(db, 'usuarios', uid), { rol: 'residente' });
      this.mostrarToast('Permisos retirados');
    } catch {
      this.mostrarToast('No se pudo quitar el permiso', 'danger');
    }
  }

  // ---------- Exportar CSV ----------
  exportarResidentes() {
    const filas: (string | number)[][] = [['Nombre', 'Correo', 'RUT', 'Torre', 'Depto', 'Teléfono', 'Estado', 'Gasto común del mes']];
    this.residentes().forEach(u => filas.push([
      u.nombre || '', u.correo || '', u.rut || '', u.torre || '', u.depto || '',
      u.telefono || '', u.estado || '', this.yaPago(u.uid) ? 'Pagado' : 'Pendiente',
    ]));
    this.descargarCsv('residentes', filas);
  }

  exportarPagos() {
    const filas: (string | number)[][] = [['Residente', 'Mes', 'Monto', 'Método']];
    this.pagos().forEach(p => filas.push([this.nombreDe(p.uid), p.mes || '', p.monto || 0, p.metodo || '']));
    this.descargarCsv('pagos', filas);
  }

  exportarMultas() {
    const filas: (string | number)[][] = [['Residente', 'Motivo', 'Monto', 'Fecha', 'Estado']];
    this.multasOrdenadas().forEach(m => filas.push([
      this.nombreDe(m.uid), m.motivo || '', m.monto || 0, this.fmtFecha(m.fecha), m.estado || '',
    ]));
    this.descargarCsv('multas', filas);
  }

  exportarEgresos() {
    const filas: (string | number)[][] = [['Fecha', 'Concepto', 'Categoría', 'Monto']];
    this.egresosOrdenados().forEach(e => filas.push([
      this.fmtFecha(e.fecha), e.concepto || '', e.categoria || '', e.monto || 0,
    ]));
    this.descargarCsv('egresos', filas);
  }

  private descargarCsv(nombre: string, filas: (string | number)[][]) {
    const csv = filas
      .map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `habitapp-${nombre}-${this.hoy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.mostrarToast('Archivo descargado');
  }

  // ---------- Utilidades (usadas desde el template) ----------
  nombreDe(uid: string): string {
    return this.usuarios().find(u => u.uid === uid)?.nombre || 'Un residente';
  }

  yaPago(uid: string): boolean {
    return this.pagadosUids().has(uid);
  }

  reservasDeEspacioHoy(espacio: string): number {
    return this.reservas().filter(r => r.espacio === espacio && r.fecha === this.hoy && r.estado === 'upcoming').length;
  }

  fmtMonto(v: number): string {
    return (v || 0).toLocaleString('es-CL');
  }

  fmtFecha(f: string): string {
    if (!f || !f.includes('-')) return f || '—';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
  }

  fmtTimestamp(t: any): string {
    return t?.seconds ? new Date(t.seconds * 1000).toLocaleDateString('es-CL') : '—';
  }

  iniciales(nombre: string): string {
    const partes = (nombre || 'U').trim().split(' ');
    return ((partes[0]?.[0] || 'U') + (partes[1]?.[0] || '')).toUpperCase();
  }

  tiempoRelativo(seg: number): string {
    if (!seg) return '';
    const min = Math.floor((Date.now() / 1000 - seg) / 60);
    if (min < 1) return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Hace ${h} h`;
    return `Hace ${Math.floor(h / 24)} d`;
  }

  tituloSeccion(): string {
    return this.secciones.find(s => s.id === this.seccion())?.label || '';
  }

  diaMes(fecha: string): { d: string; m: string } {
    const [, m, d] = (fecha || '').split('-');
    const meses = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    return { d: d || '-', m: meses[parseInt(m, 10) - 1] || '' };
  }

  /** "Octubre 2026" -> "2026-10" */
  private claveDeLabel(label: string): string {
    const [nombre, anio] = (label || '').split(' ');
    const i = MESES.indexOf(nombre);
    return i < 0 || !anio ? '' : `${anio}-${String(i + 1).padStart(2, '0')}`;
  }

  private ts(x: any): number {
    return x?.createdAt?.seconds || 0;
  }

  private hoyStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async mostrarToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const t = await this.toastCtrl.create({ message, duration: 2800, color });
    await t.present();
  }
}