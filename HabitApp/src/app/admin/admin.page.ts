import { unirPagos, unirMultas, tiempo } from '../core/finanzas-vista';
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
import html2pdf from 'html2pdf.js';

type Seccion =
  | 'dashboard' | 'residentes' | 'pagos' | 'egresos' | 'multas' | 'reservas'
  | 'comunidad' | 'avisos' | 'reportes' | 'configuracion';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MESES_CORTO = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

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

  readonly espaciosIniciales = [
    { nombre: 'Quincho 1', tipo: 'quincho', capacidad: 20 },
    { nombre: 'Quincho 2', tipo: 'quincho', capacidad: 20 },
    { nombre: 'Salón Multiuso 1', tipo: 'salon', capacidad: 30 },
    { nombre: 'Salón Multiuso 2', tipo: 'salon', capacidad: 40 },
    { nombre: 'Cancha', tipo: 'court', capacidad: 12 },
  ];

  readonly categoriasEgreso = [
    'Mantención',
    'Remuneraciones',
    'Servicios básicos',
    'Seguridad',
    'Limpieza',
    'Reparaciones',
    'Otros',
  ];

  readonly mes = mesActual();
  readonly miUid = this.authService.getCurrentUser()?.uid || '';

  // ---------- Período financiero seleccionado ----------

  periodoSeleccionado = signal(this.hoyStr().slice(0, 7));

  seccion = signal<Seccion>('dashboard');
  menuAbierto = signal(false);
  panelNotif = signal(false);
  busqueda = signal('');

  usuarios = signal<any[]>([]);
  pagosBase = signal<any[]>([]);
  pagos = computed(() => unirPagos(this.pagosBase(), this.pagosDemo()));

  reservas = signal<any[]>([]);
  posts = signal<any[]>([]);
  multasBase = signal<any[]>([]);
  multas = computed(() => unirMultas(this.multasBase(), this.pagosDemo()));

  egresos = signal<any[]>([]);
  espaciosDoc = signal<any[]>([]);

  // ---------- Espacios comunes ----------

  espacios = computed(() => this.espaciosDoc().map(e => e.nombre as string));

  filtroEsp = signal('');
  nEspNombre = signal('');
  nEspPrecio = signal('0');
  nEspDesc = signal('');

  // ---------- Configuración ----------

  config = signal({ gastoComun: 220000, fondoReserva: 5000 });
  cfgGasto = signal('220000');
  cfgFondo = signal('5000');
  nuevoAdminEmail = signal('');

  // ---------- Formulario de nueva multa ----------

  mUid = signal('');
  mMotivo = signal('');
  mMonto = signal('');
  mFecha = signal(this.hoyStr());

  // ---------- Formulario de nuevo egreso ----------

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

  totalDemo = computed(() =>
    this.pagosDemo()
      .filter(p => p.estado === 'aprobado')
      .reduce((s, p) => s + p.monto, 0)
  );

  async resolverDemo(pago: PagoDemo, aprobar: boolean) {
    if (this.resolviendoDemo()) return;

    this.resolviendoDemo.set(true);

    try {
      await this.servicioDemo.resolver(pago.id, aprobar);
      this.mostrarToast(
        aprobar ? 'Pago aprobado. Cuenta actualizada.' : 'Pago rechazado.'
      );
    } catch (e) {
      this.mostrarToast(errorPagoDemo(e), 'danger');
    } finally {
      this.resolviendoDemo.set(false);
    }
  }

  camposBanco = camposBanco;

  datosBanco = signal<CuentaBancaria>({
    titular: '',
    rut: '',
    banco: '',
    tipo: '',
    cuenta: '',
    correo: '',
  });

  transferencias = signal<SolicitudPago[]>([]);
  conciliando = signal(false);

  editarBanco(campo: typeof camposBanco[number], valor: string) {
    this.datosBanco.set({
      ...this.datosBanco(),
      [campo]: valor,
    });
  }

  async guardarBanco() {
    const cuenta = Object.fromEntries(
      camposBanco.map(c => [c, this.datosBanco()[c].trim()])
    ) as CuentaBancaria;

    if (
      camposBanco.some(c => !cuenta[c] || cuenta[c].length > 120) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuenta['correo'])
    ) {
      return this.mostrarToast(
        'Completa los datos bancarios y revisa el correo.',
        'warning'
      );
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
      : '¿Rechazar esta solicitud de transferencia?')) {
      return;
    }

    this.conciliando.set(true);

    try {
      await this.servicioPagos.conciliar(solicitud, aprobar);

      this.mostrarToast(
        aprobar ? 'Transferencia conciliada.' : 'Transferencia rechazada.'
      );
    } catch (error) {
      this.mostrarToast(
        error instanceof Error ? error.message : 'No se pudo conciliar.',
        'danger'
      );
    } finally {
      this.conciliando.set(false);
    }
  }

  private primeraCargaUsuarios = true;

  // ---------- Período: controles y formato ----------

  cambiarPeriodo(valor: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) return;

    this.periodoSeleccionado.set(valor);
  }

  etiquetaPeriodo(): string {
    const [anio, mes] = this.periodoSeleccionado().split('-').map(Number);

    if (!anio || !mes || mes < 1 || mes > 12) {
      return this.mes;
    }

    return `${MESES[mes - 1]} ${anio}`;
  }

  // ---------- Derivados: residentes y gastos comunes ----------

  valorTotal = computed(() =>
    this.config().gastoComun + this.config().fondoReserva
  );

  residentes = computed(() =>
    this.usuarios().filter(u => u.rol !== 'admin')
  );

  admins = computed(() =>
    this.usuarios().filter(u => u.rol === 'admin')
  );

  pendientesRegistro = computed(() =>
    this.residentes().filter(u => u.estado === 'pendiente')
  );

  pagosMes = computed(() =>
    this.pagos().filter(p =>
      p.mes === this.etiquetaPeriodo() &&
      this.esPagoAprobado(p) &&
      this.residentes().some(u => u.uid === p.uid)
    )
  );

  private montoAprobadoResidente(uid: string): number {
    return this.pagosMes()
      .filter(p => p.uid === uid)
      .reduce((s, p) => s + Math.max(0, Number(p.monto) || 0), 0);
  }

  pagadosUids = computed(() => {
    const resultado = new Set<string>();
    const total = this.valorTotal();

    if (total <= 0) return resultado;

    this.residentes().forEach(u => {
      if (this.montoAprobadoResidente(u.uid) >= total) {
        resultado.add(u.uid);
      }
    });

    return resultado;
  });

  pagadosResidentes = computed(() =>
    this.residentes().filter(u => this.pagadosUids().has(u.uid)).length
  );

  totalRecaudado = computed(() =>
    this.pagosMes().reduce(
      (s, p) => s + Math.max(0, Number(p.monto) || 0),
      0
    )
  );

  montoEsperado = computed(() =>
    this.residentes().length * this.valorTotal()
  );

  porcentaje = computed(() =>
    this.montoEsperado() > 0
      ? Math.round((this.totalRecaudado() / this.montoEsperado()) * 100)
      : 0
  );

  pendientes = computed(() =>
    this.residentes().filter(u => !this.pagadosUids().has(u.uid)).length
  );

  pagosParciales = computed(() =>
    this.residentes().filter(u => {
      const pagado = this.montoAprobadoResidente(u.uid);
      return pagado > 0 && pagado < this.valorTotal();
    }).length
  );

  montoPendiente = computed(() =>
    Math.max(this.montoEsperado() - this.totalRecaudado(), 0)
  );

  morosidad = computed(() =>
    this.residentes().length > 0
      ? Math.round((this.pendientes() / this.residentes().length) * 100)
      : 0
  );

  morosos = computed(() =>
    this.residentes().filter(u => !this.pagadosUids().has(u.uid))
  );

  montoPendienteResidente(uid: string): number {
    return Math.max(
      this.valorTotal() - this.montoAprobadoResidente(uid),
      0
    );
  }

  // ---------- Derivados: recaudación, ingresos y egresos ----------

  multasPagadas = computed(() =>
    this.multas().filter(m => m.estado === 'pagada')
  );

  reservasPagadas = computed(() =>
    this.reservas().filter(r =>
      r.pagado === true && (r.monto || 0) > 0
    )
  );

  reservasPorCobrar = computed(() =>
    this.reservas().filter(r =>
      r.estado === 'upcoming' &&
      (r.monto || 0) > 0 &&
      r.pagado !== true
    )
  );

  totalReservasPorCobrar = computed(() =>
    this.reservasPorCobrar().reduce(
      (s, r) => s + (r.monto || 0),
      0
    )
  );

  reservasPorCobrarPeriodo = computed(() =>
    this.reservas().filter(r =>
      String(r.fecha || '').slice(0, 7) === this.periodoSeleccionado() &&
      r.estado !== 'cancelled' &&
      (r.monto || 0) > 0 &&
      r.pagado !== true
    )
  );

  totalReservasPorCobrarPeriodo = computed(() =>
    this.reservasPorCobrarPeriodo().reduce(
      (s, r) => s + (r.monto || 0),
      0
    )
  );

  multasPendientesPeriodo = computed(() =>
    this.multas().filter(m =>
      m.estado === 'pendiente' &&
      this.claveFecha(m.fecha) === this.periodoSeleccionado()
    )
  );

  totalMultasPendientesPeriodo = computed(() =>
    this.multasPendientesPeriodo().reduce(
      (s, m) => s + (m.monto || 0),
      0
    )
  );

  porCobrarTotal = computed(() =>
    this.montoPendiente() +
    this.totalMultasPendientesPeriodo() +
    this.totalReservasPorCobrarPeriodo()
  );

  agendaReservas = computed(() => {
    const f = this.filtroEsp();

    return this.reservasProximas().filter(r =>
      !f || r.espacio === f
    );
  });

  // ---------- Recaudación del período ----------

  recaudacionMes = computed(() => {
    const clave = this.periodoSeleccionado();

    const pagosRecibidos = this.pagos().filter(p =>
      this.esPagoAprobado(p) &&
      this.claveIngreso(p, 'pago') === clave
    );

    const desglosePagos = this.desglosarPagos(pagosRecibidos);

    const multas = this.multasPagadas()
      .filter(m => this.claveIngreso(m, 'multa') === clave)
      .reduce((s, m) => s + (m.monto || 0), 0);

    const reservas = this.reservasPagadas()
      .filter(r => this.claveIngreso(r, 'reserva') === clave)
      .reduce((s, r) => s + (r.monto || 0), 0);

    const total =
      desglosePagos.gastos +
      desglosePagos.fondoReserva +
      multas +
      reservas;

    return {
      gastos: desglosePagos.gastos,
      fondoReserva: desglosePagos.fondoReserva,
      multas,
      reservas,
      totalPagos: desglosePagos.gastos + desglosePagos.fondoReserva,
      total,
    };
  });

  // ---------- Histórico de seis meses ----------

  serieFinanzas = computed(() => {
    const [anio, mes] = this.periodoSeleccionado().split('-').map(Number);
    const base = new Date(anio, mes - 1, 1);

    const claves: string[] = [];

    for (let i = 5; i >= 0; i--) {
      const fecha = new Date(
        base.getFullYear(),
        base.getMonth() - i,
        1
      );

      claves.push(
        `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
      );
    }

    const ingresos = new Map<string, number>();
    const egresosMap = new Map<string, number>();

    const sumar = (
      mapa: Map<string, number>,
      clave: string,
      monto: number
    ) => {
      if (!clave) return;

      mapa.set(
        clave,
        (mapa.get(clave) || 0) + Math.max(0, Number(monto) || 0)
      );
    };

    this.pagos()
      .filter(p => this.esPagoAprobado(p))
      .forEach(p => {
        sumar(
          ingresos,
          this.claveIngreso(p, 'pago'),
          p.monto || 0
        );
      });

    this.multasPagadas().forEach(m => {
      sumar(
        ingresos,
        this.claveIngreso(m, 'multa'),
        m.monto || 0
      );
    });

    this.reservasPagadas().forEach(r => {
      sumar(
        ingresos,
        this.claveIngreso(r, 'reserva'),
        r.monto || 0
      );
    });

    this.egresos().forEach(e => {
      sumar(
        egresosMap,
        this.claveFecha(e.fecha),
        e.monto || 0
      );
    });

    const filas = claves.map(clave => {
      const mesNumero = parseInt(clave.slice(5, 7), 10);
      const anioNumero = clave.slice(0, 4);

      return {
        clave,
        etiqueta: `${MESES_CORTO[mesNumero - 1]} ${anioNumero}`,
        ingresos: ingresos.get(clave) || 0,
        egresos: egresosMap.get(clave) || 0,
      };
    });

    const max = Math.max(
      1,
      ...filas.flatMap(f => [f.ingresos, f.egresos])
    );

    return filas.map(f => ({
      ...f,
      pi: f.ingresos > 0
        ? Math.max(Math.round((f.ingresos / max) * 100), 3)
        : 0,
      pe: f.egresos > 0
        ? Math.max(Math.round((f.egresos / max) * 100), 3)
        : 0,
    }));
  });

  finMes = computed(() => {
    const clave = this.periodoSeleccionado();
    const f = this.serieFinanzas().find(x => x.clave === clave);

    const ingresos = f?.ingresos || 0;
    const egresos = f?.egresos || 0;

    return {
      ingresos,
      egresos,
      balance: ingresos - egresos,
    };
  });

  // Totales acumulados del historial completo.

  saldoCaja = computed(() =>
    this.ingresosTotal() - this.egresosTotal()
  );

  ingresosTotal = computed(() =>
    this.pagos()
      .filter(p => this.esPagoAprobado(p))
      .reduce((s, p) => s + (p.monto || 0), 0) +
    this.multasPagadas()
      .reduce((s, m) => s + (m.monto || 0), 0) +
    this.reservasPagadas()
      .reduce((s, r) => s + (r.monto || 0), 0)
  );

  egresosTotal = computed(() =>
    this.egresos().reduce(
      (s, e) => s + (e.monto || 0),
      0
    )
  );

  egresosOrdenados = computed(() =>
    [...this.egresos()].sort((a, b) =>
      (b.fecha || '').localeCompare(a.fecha || '')
    )
  );

  egresosPeriodo = computed(() =>
    this.egresosOrdenados().filter(e =>
      this.claveFecha(e.fecha) === this.periodoSeleccionado()
    )
  );

  egresosPorCategoria = computed(() => {
    const clave = this.periodoSeleccionado();
    const mapa = new Map<string, number>();

    this.egresos()
      .filter(e => this.claveFecha(e.fecha) === clave)
      .forEach(e => {
        const categoria = e.categoria || 'Otros';

        mapa.set(
          categoria,
          (mapa.get(categoria) || 0) + (e.monto || 0)
        );
      });

    const arr = [...mapa.entries()]
      .map(([categoria, total]) => ({ categoria, total }))
      .sort((a, b) => b.total - a.total);

    const max = Math.max(1, ...arr.map(a => a.total));

    return arr.map(a => ({
      ...a,
      pct: Math.round((a.total / max) * 100),
    }));
  });

  hoy = this.hoyStr();

  reservasHoy = computed(() =>
    this.reservas().filter(r =>
      r.fecha === this.hoy && r.estado === 'upcoming'
    )
  );

  reservasProximas = computed(() =>
    this.reservas()
      .filter(r =>
        r.fecha >= this.hoy &&
        r.estado === 'upcoming'
      )
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
  );

  reservasPorEspacio = computed(() =>
    this.espacios().map(e => ({
      espacio: e,
      total: this.reservas().filter(r =>
        r.espacio === e && r.estado === 'upcoming'
      ).length,
    }))
  );

  avisos = computed(() =>
    this.posts().filter(p => p.category === 'administracion')
  );

  totalComentarios = computed(() =>
    this.posts().reduce((s, p) => s + (p.commentsCount || 0), 0)
  );

  multasOrdenadas = computed(() =>
    [...this.multas()].sort((a, b) =>
      (b.fecha || '').localeCompare(a.fecha || '')
    )
  );

  multasPendientes = computed(() =>
    this.multas().filter(m => m.estado === 'pendiente')
  );

  totalMultasPendientes = computed(() =>
    this.multasPendientes().reduce(
      (s, m) => s + (m.monto || 0),
      0
    )
  );

  residentesFiltrados = computed(() => {
    const f = this.busqueda().toLowerCase();

    return this.residentes().filter(u =>
      (u.nombre || '').toLowerCase().includes(f) ||
      (u.correo || '').toLowerCase().includes(f)
    );
  });

  historialPagos = computed(() =>
    unirPagos(
      this.pagosBase(),
      this.pagosDemo(),
      true
    ).slice(0, 40)
  );

  actividad = computed(() => {
    const items = [
      ...this.pagosMes().map(p => ({
        ts: this.ts(p),
        icono: '$',
        titulo: 'Pago recibido',
        texto: `${this.nombreDe(p.uid)} pagó gastos comunes.`,
      })),

      ...this.reservas().map(r => ({
        ts: this.ts(r),
        icono: '□',
        titulo: 'Nueva reserva',
        texto: `Se reservó ${r.espacio}.`,
      })),

      ...this.posts().map(p => ({
        ts: this.ts(p),
        icono: '☷',
        titulo: 'Nueva publicación',
        texto: `${p.author} publicó en Comunidad.`,
      })),
    ];

    return items
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6);
  });

  // ---------- Ciclo de vida ----------

  ngOnInit() {
    const user = this.authService.getCurrentUser();

    this.nombreAdmin.set(
      user?.displayName || user?.email || 'Administrador'
    );

    const err = (e: any) => {
      console.error(e);
      this.mostrarToast(
        'Error leyendo datos: ' + (e?.code || 'desconocido'),
        'danger'
      );
    };

    this.unsubs.push(
      this.servicioDemo.escuchar(
        null,
        lista => {
          this.pagosDemo.set(lista);
          this.errorDemo.set('');
        },
        e => this.errorDemo.set(errorPagoDemo(e))
      ),

      onSnapshot(
        collection(db, 'usuarios'),
        s => {
          if (!this.primeraCargaUsuarios) {
            s.docChanges().forEach(ch => {
              const d: any = ch.doc.data();

              if (ch.type === 'added' && d.estado === 'pendiente') {
                this.mostrarToast(
                  `Nuevo registro: ${d.nombre || 'residente'} espera verificación`,
                  'warning'
                );
              }
            });
          }

          this.primeraCargaUsuarios = false;

          this.usuarios.set(
            s.docs.map(d => ({
              uid: d.id,
              ...d.data(),
            }))
          );
        },
        err
      ),

      this.servicioPagos.escucharBanco(cuenta => {
        if (cuenta) this.datosBanco.set(cuenta);
      }),

      this.servicioPagos.escucharSolicitudes(null, solicitudes => {
        this.transferencias.set(
          solicitudes.filter(s =>
            s.metodo === 'Transferencia' &&
            s.estado === 'en_revision'
          )
        );
      }),

      onSnapshot(
        collection(db, 'pagos'),
        s => this.pagosBase.set(
          s.docs.map(d => ({
            id: d.id,
            ...d.data(),
          }))
        ),
        err
      ),

      onSnapshot(
        collection(db, 'reservas'),
        s => this.reservas.set(
          s.docs.map(d => ({
            id: d.id,
            ...d.data(),
          }))
        ),
        err
      ),

      onSnapshot(
        collection(db, 'multas'),
        s => this.multasBase.set(
          s.docs.map(d => ({
            id: d.id,
            ...d.data(),
          }))
        ),
        err
      ),

      onSnapshot(
        collection(db, 'espacios'),
        s => this.espaciosDoc.set(
          s.docs
            .map(d => ({
              id: d.id,
              ...d.data(),
            }))
            .sort((a: any, b: any) =>
              (a.nombre || '').localeCompare(b.nombre || '')
            )
        ),
        err
      ),

      onSnapshot(
        collection(db, 'egresos'),
        s => this.egresos.set(
          s.docs.map(d => ({
            id: d.id,
            ...d.data(),
          }))
        ),
        err
      ),

      onSnapshot(
        query(collection(db, 'posts'), orderBy('createdAt', 'desc')),
        s => this.posts.set(
          s.docs.map(d => ({
            id: d.id,
            ...d.data(),
          }))
        ),
        err
      ),

      onSnapshot(
        doc(db, 'config', 'general'),
        s => {
          const d: any = s.data();

          if (!d) return;

          const gasto = Number(d.gastoComun) > 0
            ? Number(d.gastoComun)
            : 220000;

          const fondo = Number(d.fondoReserva) >= 0
            ? Number(d.fondoReserva)
            : 5000;

          this.config.set({
            gastoComun: gasto,
            fondoReserva: fondo,
          });

          this.cfgGasto.set(String(gasto));
          this.cfgFondo.set(String(fondo));
        },
        () => {
          // Si el documento aún no existe, se conservan los valores locales.
        }
      )
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

    this.router.navigateByUrl('/login', {
      replaceUrl: true,
    });
  }

  // ---------- Acciones existentes ----------

  async cancelarReserva(id: string) {
    if (!confirm('¿Cancelar esta reserva?')) return;

    try {
      await updateDoc(doc(db, 'reservas', id), {
        estado: 'cancelled',
      });

      this.mostrarToast('Reserva cancelada');
    } catch {
      this.mostrarToast(
        'No se pudo cancelar la reserva',
        'danger'
      );
    }
  }

  async eliminarPost(id: string, tipo: 'publicación' | 'aviso') {
    if (!confirm(`¿Eliminar esta ${tipo}?`)) return;

    try {
      await deleteDoc(doc(db, 'posts', id));

      this.mostrarToast(
        tipo === 'aviso' ? 'Aviso eliminado' : 'Publicación eliminada'
      );
    } catch {
      this.mostrarToast('No se pudo eliminar', 'danger');
    }
  }

  async activarUsuario(uid: string) {
    try {
      await updateDoc(doc(db, 'usuarios', uid), {
        estado: 'activo',
      });

      this.mostrarToast('Residente verificado');
    } catch {
      this.mostrarToast(
        'No se pudo verificar al residente',
        'danger'
      );
    }
  }

  async publicarAviso(
    titulo: string,
    cuerpo: string,
    tituloEl: HTMLInputElement,
    cuerpoEl: HTMLTextAreaElement
  ) {
    titulo = titulo.trim();
    cuerpo = cuerpo.trim();

    if (!titulo || !cuerpo) {
      this.mostrarToast(
        'Completa el título y el contenido',
        'warning'
      );
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
      this.mostrarToast(
        'No se pudo publicar el aviso',
        'danger'
      );
    }
  }

  async crearMulta() {
    const uid = this.mUid();
    const motivo = this.mMotivo().trim();
    const monto = Number(this.mMonto());
    const fecha = this.mFecha();

    if (!uid || !motivo || !fecha || !(monto > 0)) {
      this.mostrarToast(
        'Completa residente, motivo, monto y fecha',
        'warning'
      );
      return;
    }

    try {
      await addDoc(collection(db, 'multas'), {
        uid,
        motivo,
        monto: Math.round(monto),
        fecha,
        estado: 'pendiente',
        createdAt: serverTimestamp(),
      });

      this.mUid.set('');
      this.mMotivo.set('');
      this.mMonto.set('');
      this.mFecha.set(this.hoyStr());

      this.mostrarToast('Multa creada');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast(
        'No se pudo crear la multa: ' + (e?.code || 'error'),
        'danger'
      );
    }
  }

  async marcarMultaPagada(id: string) {
    if (!confirm('¿Marcar esta multa como pagada?')) return;

    try {
      await updateDoc(doc(db, 'multas', id), {
        estado: 'pagada',
        fechaPago: new Date().toLocaleDateString('es-CL'),
        comprobante: 'MU-' + Date.now().toString(36).toUpperCase(),
        pagadoEn: this.hoyStr(),
      });

      this.mostrarToast('Multa marcada como pagada');
    } catch {
      this.mostrarToast(
        'No se pudo actualizar la multa',
        'danger'
      );
    }
  }

  async eliminarMulta(id: string) {
    if (!confirm('¿Eliminar esta multa?')) return;

    try {
      await deleteDoc(doc(db, 'multas', id));
      this.mostrarToast('Multa eliminada');
    } catch {
      this.mostrarToast(
        'No se pudo eliminar (revisa las reglas de Firestore)',
        'danger'
      );
    }
  }

  // ---------- Espacios comunes ----------

  async crearEspacio() {
    const nombre = this.nEspNombre().trim();
    const precio = Math.round(Number(this.nEspPrecio() || 0));

    if (!nombre) {
      this.mostrarToast('Escribe el nombre del espacio', 'warning');
      return;
    }

    if (!(precio >= 0)) {
      this.mostrarToast('El precio no es válido', 'warning');
      return;
    }

    if (
      this.espacios().some(n =>
        n.toLowerCase() === nombre.toLowerCase()
      )
    ) {
      this.mostrarToast(
        'Ya existe un espacio con ese nombre',
        'warning'
      );
      return;
    }

    try {
      await addDoc(collection(db, 'espacios'), {
        nombre,
        tipo: 'salon',
        capacidad: 20,
        descripcion: this.nEspDesc().trim(),
        precio,
        activo: true,
        createdAt: serverTimestamp(),
      });

      this.nEspNombre.set('');
      this.nEspPrecio.set('0');
      this.nEspDesc.set('');

      this.mostrarToast('Espacio agregado');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast(
        'No se pudo agregar: ' + (e?.code || 'error'),
        'danger'
      );
    }
  }

  async cambiarPrecio(id: string, valor: string) {
    const precio = Math.round(Number(valor));

    if (!(precio >= 0)) {
      this.mostrarToast('El precio no es válido', 'warning');
      return;
    }

    try {
      await updateDoc(doc(db, 'espacios', id), {
        precio,
      });

      this.mostrarToast('Precio actualizado');
    } catch {
      this.mostrarToast(
        'No se pudo actualizar el precio',
        'danger'
      );
    }
  }

  async alternarEspacio(e: any) {
    try {
      await updateDoc(doc(db, 'espacios', e.id), {
        activo: e.activo === false,
      });

      this.mostrarToast(
        e.activo === false
          ? 'Espacio activado'
          : 'Espacio desactivado'
      );
    } catch {
      this.mostrarToast(
        'No se pudo cambiar el estado',
        'danger'
      );
    }
  }

  async eliminarEspacio(e: any) {
    const prox = this.proximasDeEspacio(e.nombre);

    if (prox > 0) {
      this.mostrarToast(
        `"${e.nombre}" tiene ${prox} reserva(s) próxima(s). Cancélalas antes de eliminarlo.`,
        'warning'
      );
      return;
    }

    if (!confirm(`¿Eliminar el espacio "${e.nombre}"?`)) return;

    try {
      await deleteDoc(doc(db, 'espacios', e.id));
      this.mostrarToast('Espacio eliminado');
    } catch {
      this.mostrarToast(
        'No se pudo eliminar el espacio',
        'danger'
      );
    }
  }

  async cargarEspaciosIniciales() {
    try {
      for (const e of this.espaciosIniciales) {
        await addDoc(collection(db, 'espacios'), {
          nombre: e.nombre,
          tipo: e.tipo,
          capacidad: e.capacidad,
          descripcion: '',
          precio: 0,
          activo: true,
          createdAt: serverTimestamp(),
        });
      }

      this.mostrarToast('Espacios iniciales cargados');
    } catch {
      this.mostrarToast(
        'No se pudieron cargar los espacios',
        'danger'
      );
    }
  }

  proximasDeEspacio(nombre: string): number {
    return this.reservasProximas()
      .filter(r => r.espacio === nombre)
      .length;
  }

  ingresoDeEspacio(nombre: string): number {
    return this.reservasPagadas()
      .filter(r => r.espacio === nombre)
      .reduce((s, r) => s + (r.monto || 0), 0);
  }

  estadoPagoReserva(r: any): 'pagada' | 'pendiente' | 'gratis' {
    if (!((r.monto || 0) > 0)) return 'gratis';

    return r.pagado === true
      ? 'pagada'
      : 'pendiente';
  }

  // ---------- Egresos ----------

  async crearEgreso() {
    const concepto = this.eConcepto().trim();
    const monto = Math.round(Number(this.eMonto()));
    const fecha = this.eFecha();

    if (!concepto || !fecha || !(monto > 0)) {
      this.mostrarToast(
        'Completa concepto, monto y fecha',
        'warning'
      );
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
      this.mostrarToast(
        'No se pudo registrar: ' + (e?.code || 'error'),
        'danger'
      );
    }
  }

  async eliminarEgreso(id: string) {
    if (!confirm('¿Eliminar este egreso?')) return;

    try {
      await deleteDoc(doc(db, 'egresos', id));
      this.mostrarToast('Egreso eliminado');
    } catch {
      this.mostrarToast(
        'No se pudo eliminar el egreso',
        'danger'
      );
    }
  }

  // ---------- Configuración ----------

  async guardarConfig() {
    const gasto = Math.round(Number(this.cfgGasto()));
    const fondo = Math.round(Number(this.cfgFondo()));

    if (!(gasto > 0) || !(fondo >= 0)) {
      this.mostrarToast(
        'Ingresa montos válidos',
        'warning'
      );
      return;
    }

    try {
      await setDoc(
        doc(db, 'config', 'general'),
        {
          gastoComun: gasto,
          fondoReserva: fondo,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      this.mostrarToast('Valores guardados');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast(
        'No se pudo guardar: ' + (e?.code || 'error'),
        'danger'
      );
    }
  }

  async agregarAdmin() {
    const email = this.nuevoAdminEmail().trim().toLowerCase();

    if (!email) {
      this.mostrarToast(
        'Escribe el correo de la persona',
        'warning'
      );
      return;
    }

    const u = this.usuarios().find(
      x => (x.correo || '').toLowerCase() === email
    );

    if (!u) {
      this.mostrarToast(
        'Ese correo no está registrado. Pídele que cree su cuenta primero.',
        'warning'
      );
      return;
    }

    if (u.rol === 'admin') {
      this.mostrarToast(
        'Esa persona ya es administradora',
        'warning'
      );
      return;
    }

    if (!confirm(
      `¿Dar permisos de administrador a ${u.nombre || u.correo}?`
    )) {
      return;
    }

    try {
      await updateDoc(doc(db, 'usuarios', u.uid), {
        rol: 'admin',
        estado: 'activo',
      });

      this.nuevoAdminEmail.set('');
      this.mostrarToast('Administrador agregado');
    } catch (e: any) {
      console.error(e);
      this.mostrarToast(
        'No se pudo agregar: ' + (e?.code || 'error'),
        'danger'
      );
    }
  }

  async hacerAdmin(uid: string) {
    const u = this.usuarios().find(x => x.uid === uid);

    if (
      !u ||
      !confirm(`¿Dar permisos de administrador a ${u.nombre || u.correo}?`)
    ) {
      return;
    }

    try {
      await updateDoc(doc(db, 'usuarios', uid), {
        rol: 'admin',
        estado: 'activo',
      });

      this.mostrarToast('Administrador agregado');
    } catch {
      this.mostrarToast(
        'No se pudo cambiar el rol',
        'danger'
      );
    }
  }

  async quitarAdmin(uid: string) {
    if (uid === this.miUid) {
      this.mostrarToast(
        'No puedes quitarte tus propios permisos',
        'warning'
      );
      return;
    }

    if (this.admins().length <= 1) {
      this.mostrarToast(
        'Debe quedar al menos un administrador',
        'warning'
      );
      return;
    }

    if (!confirm(
      '¿Quitar los permisos de administrador a esta persona?'
    )) {
      return;
    }

    try {
      await updateDoc(doc(db, 'usuarios', uid), {
        rol: 'residente',
      });

      this.mostrarToast('Permisos retirados');
    } catch {
      this.mostrarToast(
        'No se pudo quitar el permiso',
        'danger'
      );
    }
  }

  // ---------- Exportar CSV ----------

  exportarResidentes() {
    const filas: (string | number)[][] = [
      [
        'Nombre',
        'Correo',
        'RUT',
        'Torre',
        'Depto',
        'Teléfono',
        'Estado',
        'Gasto común del mes',
      ],
    ];

    this.residentes().forEach(u => filas.push([
      u.nombre || '',
      u.correo || '',
      u.rut || '',
      u.torre || '',
      u.depto || '',
      u.telefono || '',
      u.estado || '',
      this.yaPago(u.uid) ? 'Pagado' : 'Pendiente',
    ]));

    this.descargarCsv('residentes', filas);
  }

  exportarPagos() {
    const filas: (string | number)[][] = [
      ['Residente', 'Mes', 'Monto', 'Método'],
    ];

    this.pagos().forEach(p => filas.push([
      this.nombreDe(p.uid),
      p.mes || '',
      p.monto || 0,
      p.metodo || '',
    ]));

    this.descargarCsv('pagos', filas);
  }

  exportarMultas() {
    const filas: (string | number)[][] = [
      ['Residente', 'Motivo', 'Monto', 'Fecha', 'Estado'],
    ];

    this.multasOrdenadas().forEach(m => filas.push([
      this.nombreDe(m.uid),
      m.motivo || '',
      m.monto || 0,
      this.fmtFecha(m.fecha),
      m.estado || '',
    ]));

    this.descargarCsv('multas', filas);
  }

  exportarEgresos() {
    const filas: (string | number)[][] = [
      ['Fecha', 'Concepto', 'Categoría', 'Monto'],
    ];

    this.egresosOrdenados().forEach(e => filas.push([
      this.fmtFecha(e.fecha),
      e.concepto || '',
      e.categoria || '',
      e.monto || 0,
    ]));

    this.descargarCsv('egresos', filas);
  }

  private descargarCsv(
    nombre: string,
    filas: (string | number)[][]
  ) {
    const csv = [
      ['Modo academico: incluye operaciones sin cobro real'],
      ...filas,
    ]
      .map(f =>
        f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')
      )
      .join('\r\n');

    const blob = new Blob(
      ['\uFEFF' + csv],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `habitapp-academico-${nombre}-${this.hoy}.csv`;
    a.click();

    URL.revokeObjectURL(url);

    this.mostrarToast('Archivo descargado');
  }

  // ---------- Generar informe financiero PDF ----------

async generarReporteFinanciero() {
  const periodo = this.etiquetaPeriodo();
  const recaudacion = this.recaudacionMes();
  const finanzas = this.finMes();

  const ingresos = [
    ['Gastos comunes', recaudacion.gastos],
    ['Fondo de reserva', recaudacion.fondoReserva],
    ['Multas cobradas', recaudacion.multas],
    ['Reservas cobradas', recaudacion.reservas],
    ['Total de ingresos', recaudacion.total],
  ];

  const egresos = this.egresosPeriodo();
  const categorias = this.egresosPorCategoria();

  const escapar = (valor: unknown): string =>
    String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const formato = (valor: number): string =>
    '$' + this.fmtMonto(valor);

  const filasIngresos = ingresos.map(([nombre, monto]) => `
    <tr>
      <td>${escapar(nombre)}</td>
      <td class="numero">${formato(Number(monto) || 0)}</td>
    </tr>
  `).join('');

  const filasEgresos = egresos.length
    ? egresos.map(e => `
        <tr>
          <td>${escapar(this.fmtFecha(e.fecha))}</td>
          <td>${escapar(e.concepto)}</td>
          <td>${escapar(e.categoria || 'Otros')}</td>
          <td class="numero">${formato(Number(e.monto) || 0)}</td>
        </tr>
      `).join('')
    : `
        <tr>
          <td colspan="4" class="vacio">
            No hay egresos registrados en este período.
          </td>
        </tr>
      `;

  const filasCategorias = categorias.length
    ? categorias.map(c => `
        <tr>
          <td>${escapar(c.categoria)}</td>
          <td class="numero">${formato(c.total)}</td>
        </tr>
      `).join('')
    : `
        <tr>
          <td colspan="2" class="vacio">
            No hay categorías con egresos en este período.
          </td>
        </tr>
      `;

  const fechaGeneracion = new Date().toLocaleString('es-CL');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Informe financiero HabitApp - ${escapar(periodo)}</title>
    </head>

    <body>
      <header class="cabecera">
        <div>
          <div class="marca">HabitApp · Administración</div>
          <h1>Informe financiero</h1>
          <p>Período consultado: <strong>${escapar(periodo)}</strong></p>
        </div>

        <div class="fecha">
          <p>Fecha de generación</p>
          <strong>${escapar(fechaGeneracion)}</strong>
        </div>
      </header>

      <section class="resumen">
        <div class="tarjeta">
          <span>Ingresos recibidos en el período</span>
          <strong>${formato(finanzas.ingresos)}</strong>
        </div>

        <div class="tarjeta">
          <span>Egresos registrados en el período</span>
          <strong>${formato(finanzas.egresos)}</strong>
        </div>

        <div class="tarjeta">
          <span>Balance del período</span>
          <strong>${formato(finanzas.balance)}</strong>
        </div>
      </section>

      <h2>1. Detalle de ingresos</h2>

      <table>
        <thead>
          <tr>
            <th>Concepto</th>
            <th class="numero">Monto recibido</th>
          </tr>
        </thead>
        <tbody>
          ${filasIngresos}
        </tbody>
      </table>

      <h2>2. Estado de cobranza de gastos comunes</h2>

      <table>
        <tbody>
          <tr>
            <td>Residentes registrados</td>
            <td class="numero">${this.residentes().length}</td>
          </tr>
          <tr>
            <td>Cuotas completas</td>
            <td class="numero">${this.pagadosResidentes()}</td>
          </tr>
          <tr>
            <td>Cuotas con pagos parciales</td>
            <td class="numero">${this.pagosParciales()}</td>
          </tr>
          <tr>
            <td>Cuotas pendientes o incompletas</td>
            <td class="numero">${this.pendientes()}</td>
          </tr>
          <tr>
            <td>Total esperado por cuotas del período</td>
            <td class="numero">${formato(this.montoEsperado())}</td>
          </tr>
          <tr>
            <td>Total aplicado a cuotas del período</td>
            <td class="numero">${formato(this.totalRecaudado())}</td>
          </tr>
          <tr>
            <td>Saldo pendiente de cuotas</td>
            <td class="numero">${formato(this.montoPendiente())}</td>
          </tr>
          <tr>
            <td>Porcentaje de morosidad</td>
            <td class="numero">${this.morosidad()}%</td>
          </tr>
        </tbody>
      </table>

      <h2>3. Egresos del período</h2>

      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Concepto</th>
            <th>Categoría</th>
            <th class="numero">Monto</th>
          </tr>
        </thead>
        <tbody>
          ${filasEgresos}
        </tbody>
      </table>

      <h2>4. Egresos por categoría</h2>

      <table>
        <thead>
          <tr>
            <th>Categoría</th>
            <th class="numero">Total</th>
          </tr>
        </thead>
        <tbody>
          ${filasCategorias}
        </tbody>
      </table>

      <h2>5. Saldos generales</h2>

      <table>
        <tbody>
          <tr>
            <td>Saldo acumulado de todo el historial</td>
            <td class="numero">${formato(this.saldoCaja())}</td>
          </tr>
        </tbody>
      </table>

      <p class="nota">
        Informe generado desde HabitApp. Los ingresos se agrupan según el
        período de recepción disponible en los registros. La cobranza de
        gastos comunes se presenta según el mes al que corresponde cada cuota.
        El saldo acumulado considera el historial completo disponible.
      </p>
    </body>
    </html>
  `;

  const nombrePeriodo = periodo
    .replace(/\s+/g, '-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let contenedor: HTMLDivElement | null = null;
  let estilosPdf: HTMLStyleElement | null = null;

  try {
    const documento = new DOMParser().parseFromString(html, 'text/html');

    contenedor = document.createElement('div');
    contenedor.className = 'habitapp-pdf-export';
    contenedor.innerHTML = documento.body.innerHTML;

    // Se mantiene dentro del documento para que html2canvas pueda capturarlo.
    // La opacidad se restaura en la copia que se utiliza para generar el PDF.
    contenedor.style.position = 'fixed';
    contenedor.style.left = '0';
    contenedor.style.top = '0';
    contenedor.style.width = '190mm';
    contenedor.style.backgroundColor = '#ffffff';
    contenedor.style.opacity = '0';
    contenedor.style.pointerEvents = 'none';
    contenedor.style.zIndex = '-1';

    estilosPdf = document.createElement('style');

    estilosPdf.textContent = `
      .habitapp-pdf-export,
      .habitapp-pdf-export * {
        box-sizing: border-box;
      }

      .habitapp-pdf-export {
        width: 190mm;
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #202938;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 1.45;
      }

      .habitapp-pdf-export h1 {
        font-size: 24px;
        line-height: 1.2;
        margin: 0 0 6px;
        color: #202938;
      }

      .habitapp-pdf-export h2 {
        font-size: 15px;
        line-height: 1.3;
        margin: 28px 0 10px;
        border-bottom: 1px solid #d8dee8;
        padding-bottom: 7px;
        color: #202938;
        break-after: avoid;
        page-break-after: avoid;
      }

      .habitapp-pdf-export p {
        color: #586476;
        margin: 4px 0;
      }

      .habitapp-pdf-export .cabecera {
        display: table;
        width: 100%;
        table-layout: fixed;
        border-bottom: 2px solid #2563eb;
        padding-bottom: 18px;
        margin-bottom: 20px;
      }

      .habitapp-pdf-export .cabecera > div {
        display: table-cell;
        vertical-align: top;
      }

      .habitapp-pdf-export .cabecera .fecha {
        width: 190px;
        text-align: right;
        color: #586476;
        font-size: 11px;
      }

      .habitapp-pdf-export .marca {
        font-size: 13px;
        font-weight: bold;
        color: #2563eb;
        margin-bottom: 8px;
      }

      .habitapp-pdf-export .resumen {
        display: table;
        width: 100%;
        table-layout: fixed;
        border-spacing: 8px 0;
        margin: 18px 0;
      }

      .habitapp-pdf-export .tarjeta {
        display: table-cell;
        width: 33.333%;
        vertical-align: top;
        border: 1px solid #dce2eb;
        border-radius: 8px;
        padding: 12px;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .habitapp-pdf-export .tarjeta span {
        display: block;
        color: #586476;
        margin-bottom: 7px;
        min-height: 34px;
      }

      .habitapp-pdf-export .tarjeta strong {
        display: block;
        font-size: 17px;
        color: #202938;
      }

      .habitapp-pdf-export table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        margin-top: 8px;
        font-size: 11px;
      }

      .habitapp-pdf-export thead {
        display: table-header-group;
      }

      .habitapp-pdf-export th,
      .habitapp-pdf-export td {
        padding: 9px 8px;
        text-align: left;
        vertical-align: middle;
        border-bottom: 1px solid #e3e7ee;
        overflow-wrap: break-word;
      }

      .habitapp-pdf-export th {
        background: #f1f4f9;
        font-weight: bold;
        color: #202938;
      }

      .habitapp-pdf-export tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .habitapp-pdf-export .numero {
        text-align: right;
        white-space: nowrap;
      }

      .habitapp-pdf-export .vacio {
        color: #667085;
        text-align: center;
        padding: 16px;
      }

      .habitapp-pdf-export .nota {
        margin-top: 22px;
        padding-top: 10px;
        border-top: 1px solid #d8dee8;
        font-size: 10px;
        line-height: 1.5;
        color: #667085;
      }
    `;

    document.head.appendChild(estilosPdf);
    document.body.appendChild(contenedor);

    // Espera a que el navegador termine de calcular el contenido.
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    const opciones = {
      margin: [10, 10, 10, 10] as [number, number, number, number],

      filename: `HabitApp-Reporte-Financiero-${nombrePeriodo}.pdf`,

      image: {
        type: 'jpeg' as const,
        quality: 0.98,
      },

      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: 0,

        // Hace visible la copia utilizada por html2canvas.
        onclone: (documentoClonado: Document) => {
          documentoClonado
            .querySelectorAll<HTMLElement>('.habitapp-pdf-export')
            .forEach(elemento => {
              elemento.style.position = 'static';
              elemento.style.left = 'auto';
              elemento.style.top = 'auto';
              elemento.style.opacity = '1';
              elemento.style.visibility = 'visible';
              elemento.style.zIndex = 'auto';
              elemento.style.width = '190mm';
              elemento.style.backgroundColor = '#ffffff';
            });
        },
      },

      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait' as const,
      },

      pagebreak: {
        mode: ['css', 'legacy'],
        avoid: ['tr', '.tarjeta'],
      },
    };

    await html2pdf()
      .set(opciones)
      .from(contenedor)
      .save();

    this.mostrarToast(
      'Reporte financiero PDF descargado correctamente.'
    );

  } catch (error) {
    console.error('Error al generar el reporte PDF:', error);

    this.mostrarToast(
      'No se pudo generar el PDF. Intenta nuevamente.',
      'danger'
    );

  } finally {
    contenedor?.remove();
    estilosPdf?.remove();
  }
}

  // ---------- Utilidades existentes ----------

  nombreDe(uid: string): string {
    return this.usuarios().find(u => u.uid === uid)?.nombre || 'Un residente';
  }

  yaPago(uid: string): boolean {
    return this.pagadosUids().has(uid);
  }

  reservasDeEspacioHoy(espacio: string): number {
    return this.reservas().filter(r =>
      r.espacio === espacio &&
      r.fecha === this.hoy &&
      r.estado === 'upcoming'
    ).length;
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
    return t?.seconds
      ? new Date(t.seconds * 1000).toLocaleDateString('es-CL')
      : '—';
  }

  iniciales(nombre: string): string {
    const partes = (nombre || 'U').trim().split(' ');

    return (
      (partes[0]?.[0] || 'U') +
      (partes[1]?.[0] || '')
    ).toUpperCase();
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
    return this.secciones.find(s =>
      s.id === this.seccion()
    )?.label || '';
  }

  diaMes(fecha: string): { d: string; m: string } {
    const [, m, d] = (fecha || '').split('-');

    const meses = [
      'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
      'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
    ];

    return {
      d: d || '-',
      m: meses[parseInt(m, 10) - 1] || '',
    };
  }

  // ---------- Cálculos internos de pagos ----------

  private esPagoAprobado(p: any): boolean {
    // Los pagos históricos sin estado conservan compatibilidad.
    return !p?.estado || p.estado === 'aprobado';
  }

  private desglosarPagos(pagos: any[]) {
    let gastos = 0;
    let fondoReserva = 0;

    const limiteGastos = Math.max(0, this.config().gastoComun);
    const limiteFondo = Math.max(0, this.config().fondoReserva);

    pagos.forEach(p => {
      const monto = Math.max(0, Number(p.monto) || 0);

      const parteGastos = Math.min(monto, limiteGastos);
      const restante = Math.max(monto - parteGastos, 0);
      const parteFondo = Math.min(restante, limiteFondo);

      gastos += parteGastos;
      fondoReserva += parteFondo;
    });

    return {
      gastos,
      fondoReserva,
    };
  }

  // ---------- Fechas de ingresos y egresos ----------

  private claveFecha(valor: any): string {
    if (!valor) return '';

    const texto = String(valor).trim();

    const iso = texto.match(/^(\d{4})-(\d{2})/);

    if (iso) {
      return `${iso[1]}-${iso[2]}`;
    }

    const local = texto.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

    if (local) {
      const dia = Number(local[1]);
      const mes = Number(local[2]);
      const anio = Number(local[3]);

      if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
        return `${anio}-${String(mes).padStart(2, '0')}`;
      }
    }

    return '';
  }

  private claveIngreso(
    x: any,
    tipo: 'pago' | 'multa' | 'reserva'
  ): string {
    const fechaExplicita =
      this.claveFecha(x?.pagadoEn) ||
      this.claveFecha(x?.fechaIngreso) ||
      this.claveFecha(x?.fechaPago);

    if (fechaExplicita) return fechaExplicita;

    const marcaTiempo = tiempo(
      x?.pagadoAt ||
      x?.resueltoAt ||
      x?.createdAt
    );

    if (marcaTiempo) {
      return this.claveTimestamp(marcaTiempo);
    }

    const fechaRegistro = this.claveFecha(x?.fecha);

    if (fechaRegistro) return fechaRegistro;

    if (tipo === 'pago') {
      return this.claveDeLabel(x?.mes);
    }

    return '';
  }

  private claveTimestamp(milisegundos: number): string {
    if (!milisegundos) return '';

    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date(milisegundos));

    const anio = partes.find(p => p.type === 'year')?.value;
    const mes = partes.find(p => p.type === 'month')?.value;

    return anio && mes ? `${anio}-${mes}` : '';
  }

  private claveDeLabel(label: string): string {
    const [nombre, anio] = (label || '').split(' ');
    const i = MESES.indexOf(nombre);

    return i < 0 || !anio
      ? ''
      : `${anio}-${String(i + 1).padStart(2, '0')}`;
  }

  private ts(x: any): number {
    return tiempo(x?.createdAt);
  }

  private hoyStr(): string {
    const d = new Date();

    return (
      `${d.getFullYear()}-` +
      `${String(d.getMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getDate()).padStart(2, '0')}`
    );
  }

  private async mostrarToast(
    message: string,
    color: 'success' | 'danger' | 'warning' = 'success'
  ) {
    const t = await this.toastCtrl.create({
      message,
      duration: 2800,
      color,
    });

    await t.present();
  }
}