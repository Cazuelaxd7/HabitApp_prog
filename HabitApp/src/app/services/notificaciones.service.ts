import { Injectable, inject, signal, computed } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { PagosService } from './pagos.service';
import { ReservasService } from './reservas.service';
import { ComunidadService } from './comunidad.service';

export type TipoAviso = 'pago' | 'comentario' | 'reserva' | 'admin';

export interface Aviso {
  id: string;
  tipo: TipoAviso;
  titulo: string;
  detalle: string;
  ts: number;
  leida: boolean;
}

type AvisoBase = Omit<Aviso, 'leida'>;
interface Estado { read: string[]; dismissed: string[]; }

const DIAS = ['domingo', 'lunes', 'martes', 'mi\u00E9rcoles', 'jueves', 'viernes', 's\u00E1bado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function aMillis(v: any): number {
  if (!v) return Date.now();
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  return Date.now();
}

function fechaLarga(f: string): string {
  const [y, m, d] = f.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} de ${MESES[m - 1]}`;
}

function cortar(t: string, max = 110): string {
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private auth = inject(AuthService);
  private pagos = inject(PagosService);
  private reservas = inject(ReservasService);
  private comunidad = inject(ComunidadService);

  private uid = '';
  private unsubs: Array<() => void> = [];

  private pagosN = signal<AvisoBase[]>([]);
  private reservasN = signal<AvisoBase[]>([]);
  private postsN = signal<AvisoBase[]>([]);
  private estado = signal<Estado>({ read: [], dismissed: [] });

  /** Avisos de los ultimos 7 dias o sin leer; lo mas antiguo se considera leido. */
  readonly lista = computed<Aviso[]>(() => {
    const { read, dismissed } = this.estado();
    const limite = Date.now() - 7 * 24 * 3600 * 1000;
    return [...this.pagosN(), ...this.reservasN(), ...this.postsN()]
      .filter(a => !dismissed.includes(a.id))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20)
      .map(a => ({ ...a, leida: read.includes(a.id) || a.ts < limite }));
  });

  readonly sinLeer = computed(() => this.lista().filter(a => !a.leida).length);

  constructor() {
    this.auth.user$.subscribe(user => {
      if (user) this.iniciar(user.uid);
      else this.detener();
    });
  }

  private iniciar(uid: string) {
    if (uid === this.uid) return;
    this.detener();
    this.uid = uid;
    this.cargarEstado();

    this.unsubs.push(
      this.pagos.escucharHistorial(uid, (lista) => {
        this.pagosN.set(lista.map(p => ({
          id: 'pago-' + p.id,
          tipo: 'pago' as const,
          titulo: 'Pago recibido',
          detalle: `Tu pago de ${String(p.concepto).toLowerCase()} (${p.mes}) fue registrado correctamente.`,
          ts: aMillis(p.createdAt),
        })));
      })
    );

    this.unsubs.push(
      this.reservas.escucharMisReservas(uid, (lista) => {
        this.reservasN.set(lista.map((r: any) => ({
          id: 'reserva-' + r.id,
          tipo: 'reserva' as const,
          titulo: 'Recordatorio de reserva',
          detalle: `Recuerda que tienes una reserva del ${r.espacio} el ${fechaLarga(r.fecha)}.`,
          ts: aMillis(r.createdAt),
        })));
      })
    );

    this.unsubs.push(
      this.comunidad.escucharPosts(uid, (posts) => {
        const admin = posts
          .filter(p => p.category === 'administracion')
          .slice(0, 5)
          .map(p => ({
            id: 'admin-' + p.id,
            tipo: 'admin' as const,
            titulo: 'Aviso de administraci\u00F3n',
            detalle: cortar(`${p.title}. ${p.body}`),
            ts: aMillis(p.createdAt),
          }));
        const comentarios = posts
          .filter(p => p.authorUid === uid && p.commentsCount > 0)
          .map(p => ({
            id: `comentarios-${p.id}-${p.commentsCount}`,
            tipo: 'comentario' as const,
            titulo: 'Nuevo comentario',
            detalle: cortar(`Tu publicaci\u00F3n "${p.title}" tiene ${p.commentsCount} comentario${p.commentsCount === 1 ? '' : 's'}.`),
            ts: aMillis(p.createdAt),
          }));
        this.postsN.set([...admin, ...comentarios]);
      })
    );
  }

  private detener() {
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    this.uid = '';
    this.pagosN.set([]);
    this.reservasN.set([]);
    this.postsN.set([]);
    this.estado.set({ read: [], dismissed: [] });
  }

  marcarLeida(id: string) {
    const e = this.estado();
    if (e.read.includes(id)) return;
    this.setEstado({ ...e, read: [...e.read, id] });
  }

  marcarTodoLeido() {
    const e = this.estado();
    const ids = this.lista().map(a => a.id);
    this.setEstado({ ...e, read: Array.from(new Set([...e.read, ...ids])) });
  }

  descartar(id: string) {
    const e = this.estado();
    this.setEstado({ ...e, dismissed: [...e.dismissed, id] });
  }

  private clave(): string {
    return 'hb_avisos_' + this.uid;
  }

  private cargarEstado() {
    try {
      const raw = localStorage.getItem(this.clave());
      this.estado.set(raw ? JSON.parse(raw) : { read: [], dismissed: [] });
    } catch {
      this.estado.set({ read: [], dismissed: [] });
    }
  }

  private setEstado(e: Estado) {
    this.estado.set(e);
    try { localStorage.setItem(this.clave(), JSON.stringify(e)); } catch { /* sin almacenamiento */ }
  }
}
