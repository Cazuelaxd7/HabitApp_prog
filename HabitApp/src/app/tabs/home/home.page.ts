import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { IonContent, AlertController } from '@ionic/angular';
import { Unsubscribe } from 'firebase/firestore';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { pendienteDelMes } from '../../core/cuenta.util';
import { ReservasService } from '../../services/reservas.service';
import { PagosService } from '../../services/pagos.service';
import { MultasService } from '../../services/multas.service';
import { ComunidadService } from '../../services/comunidad.service';
import { ESPACIOS } from '../../models/reserva.model';

interface Actividad {
  tipo: 'reserva' | 'pago';
  titulo: string;
  detalle: string;
  ts: number;
}

// Arreglos para escribir la fecha en texto (ej: "Domingo 27 de septiembre")
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Mi\u00E9rcoles', 'Jueves', 'Viernes', 'S\u00E1bado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [IonContent],
})
export class HomePage implements OnInit, OnDestroy {
  // Sin zone.js necesito markForCheck cada vez que llegan datos de Firebase
  private cdr = inject(ChangeDetectorRef);

  userName = '';

  // Tarjeta de gastos comunes
  montoPendiente = '';
  detalleCuenta = '';

  // Tarjeta de multas
  montoMultas = '0';
  detalleMultas = 'Sin multas registradas';

  // Proxima reserva
  proxima: any = null;
  iconoProxima = '\uD83C\uDFE1';
  fechaProxima = '';

  // Ultimo aviso de administracion
  avisoTitulo = 'Sin avisos por ahora';
  avisoTexto = 'La administraci\u00F3n a\u00FAn no ha publicado avisos.';

  actividad: Actividad[] = [];

  private reservasAct: Actividad[] = [];
  private pagosAct: Actividad[] = [];
  private unsubs: Unsubscribe[] = [];
  private navSub?: Subscription;

  constructor(
    private alertCtrl: AlertController,
    private router: Router,
    private authService: AuthService,
    private reservasService: ReservasService,
    private pagosService: PagosService,
    private multasService: MultasService,
    private comunidadService: ComunidadService
  ) {}

  ngOnInit() {
    this.cargar();
    // Recargo los datos cada vez que vuelvo al inicio (Ionic no destruye la pagina)
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (e.urlAfterRedirects.includes('/tabs/home')) this.cargar();
      });
  }

  ngOnDestroy() {
    this.limpiar();
    this.navSub?.unsubscribe();
  }

  private limpiar() {
    this.unsubs.forEach(u => u());
    this.unsubs = [];
  }

  // Devuelve la fecha de hoy como AAAA-MM-DD (el mismo formato que guarda reservas)
  private hoyStr(): string {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dia}`;
  }

  private formatFechaLarga(fechaStr: string): string {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const fecha = new Date(y, m - 1, d);
    return `${DIAS[fecha.getDay()]} ${d} de ${MESES[m - 1]}`;
  }

  private cargar() {
    this.limpiar();

    // Valores por defecto mientras llegan los datos
    this.proxima = null;
    this.fechaProxima = '';
    this.reservasAct = [];
    this.pagosAct = [];
    this.actividad = [];
    this.montoMultas = '0';
    this.detalleMultas = 'Sin multas registradas';
    this.avisoTitulo = 'Sin avisos por ahora';
    this.avisoTexto = 'La administraci\u00F3n a\u00FAn no ha publicado avisos.';

    const base = pendienteDelMes();
    this.montoPendiente = base.total.toLocaleString('es-CL');
    this.detalleCuenta = `Vence el ${base.vencimiento}`;

    const user = this.authService.getCurrentUser();
    if (!user) { this.cdr.markForCheck(); return; }
    this.userName = user.displayName || user.email || 'Usuario';
    this.cdr.markForCheck();
    const uid = user.uid;

    // 1) Reservas: la "proxima" es la mas cercana desde hoy (no la ultima que cree)
    this.unsubs.push(
      this.reservasService.escucharMisReservas(uid, (reservas: any[]) => {
        const hoy = this.hoyStr();
        const futuras = reservas
          .filter(r => r.fecha >= hoy)
          .sort((a, b) => (a.fecha + a.horario).localeCompare(b.fecha + b.horario));
        this.proxima = futuras[0] ?? null;
        this.fechaProxima = this.proxima ? this.formatFechaLarga(this.proxima.fecha) : '';
        const espProx = ESPACIOS.find(e => e.nombre === this.proxima?.espacio);
        this.iconoProxima = espProx ? espProx.icono : '\uD83C\uDFE1';

        // Para la lista de actividad uso la fecha en que se creo cada reserva
        this.reservasAct = reservas
          .map((r: any) => ({
            tipo: 'reserva' as const,
            titulo: 'Reserva creada',
            detalle: `${r.espacio} \u00B7 ${r.fecha} \u00B7 ${r.horario}`,
            ts: r.createdAt?.toMillis?.() ?? Date.now(),
          }))
          .sort((a, b) => b.ts - a.ts);
        this.reconstruir();
      })
    );

    // 2) Pagos: si ya pague el mes, muestro $0 y "Estas al dia"
    this.unsubs.push(
      this.pagosService.escucharHistorial(uid, (pagos) => {
        const yaPago = pagos.some((p: any) => p.mes === base.mes);
        this.montoPendiente = yaPago ? '0' : base.total.toLocaleString('es-CL');
        this.detalleCuenta = yaPago ? 'Est\u00E1s al d\u00EDa' : `Vence el ${base.vencimiento}`;

        this.pagosAct = pagos.map((p: any) => ({
          tipo: 'pago' as const,
          titulo: 'Pago recibido',
          detalle: `${p.concepto} \u00B7 ${p.mes}`,
          ts: p.createdAt || 0,
        }));
        this.reconstruir();
      })
    );

    // 3) Multas: sumo solo las pendientes
    this.unsubs.push(
      this.multasService.escucharMisMultas(uid, (multas) => {
        const pendientes = multas.filter(m => m.estado === 'pendiente');
        const total = pendientes.reduce((suma, m) => suma + (m.monto || 0), 0);
        this.montoMultas = total.toLocaleString('es-CL');
        const n = pendientes.length;
        this.detalleMultas = n === 0
          ? 'Sin multas registradas'
          : `${n} multa${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'}`;
        this.cdr.markForCheck();
      })
    );

    // 4) Avisos: tomo la publicacion mas nueva de la categoria administracion
    this.unsubs.push(
      this.comunidadService.escucharPosts(uid, (posts) => {
        const aviso = posts.find(p => p.category === 'administracion');
        if (aviso) {
          this.avisoTitulo = aviso.title;
          this.avisoTexto = aviso.body.length > 110 ? aviso.body.slice(0, 107) + '...' : aviso.body;
        } else {
          this.avisoTitulo = 'Sin avisos por ahora';
          this.avisoTexto = 'La administraci\u00F3n a\u00FAn no ha publicado avisos.';
        }
        this.cdr.markForCheck();
      })
    );
  }

  // Junta reservas y pagos en una sola lista y deja las 4 mas nuevas
  private reconstruir() {
    this.actividad = [...this.reservasAct, ...this.pagosAct]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 4);
    this.cdr.markForCheck();
  }

  get primerNombre(): string {
    return this.userName.split(' ')[0].split('@')[0];
  }

  get iniciales(): string {
    const partes = this.userName.replace(/@.*/, '').trim().split(' ');
    const primera = partes[0]?.[0] || 'U';
    const segunda = partes[1]?.[0] || '';
    return (primera + segunda).toUpperCase();
  }

  get saludo(): string {
    const hora = new Date().getHours();
    if (hora < 12) return 'BUENOS D\u00CDAS';
    if (hora < 19) return 'BUENAS TARDES';
    return 'BUENAS NOCHES';
  }

  goToPagos() { this.router.navigateByUrl('/tabs/pagos'); }
  goToMultas() { this.router.navigateByUrl('/tabs/multas'); }
  goToComunidad() { this.router.navigateByUrl('/tabs/comunidad'); }
  goToNotificaciones() { this.router.navigateByUrl('/tabs/notificaciones'); }
  showReservas() { this.router.navigateByUrl('/tabs/reservas'); }

  async logout() {
    const alert = await this.alertCtrl.create({
      header: 'Cerrar sesi\u00F3n',
      message: '\u00BFSeguro que quieres salir?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salir',
          handler: async () => {
            // Primero voy al login y despues cierro sesion, para que no salten errores de permisos
            await this.router.navigateByUrl('/login');
            await new Promise(r => setTimeout(r, 400));
            await this.authService.logout();
          },
        },
      ],
    });
    await alert.present();
  }

  // Ya no se usa (ahora la tarjeta lleva a la pantalla de multas), lo dejo por si acaso
  async showMultas() {
    this.goToMultas();
  }
}

