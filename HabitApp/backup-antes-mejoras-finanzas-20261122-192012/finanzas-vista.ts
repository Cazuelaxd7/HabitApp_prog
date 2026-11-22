import { collection, onSnapshot, query, where, Unsubscribe } from 'firebase/firestore';
import { db } from './firestore';

export function tiempo(v: any): number {
  return typeof v === 'number' ? v : v?.toMillis?.() ?? (v?.seconds || 0) * 1000;
}

export function unirPagos(base: any[], operaciones: any[], todos = false): any[] {
  const salida = base.map(p => ({ ...p, estado: 'aprobado' }));
  const claves = new Set(base.map(p => p.uid + '|' + p.mes));
  for (const d of operaciones) {
    if (d.tipo !== 'gasto' || (!todos && d.estado !== 'aprobado')) continue;
    const clave = d.uid + '|' + d.mes;
    if (claves.has(clave)) continue;
    claves.add(clave);
    const ts = d.resueltoAt || d.createdAt;
    salida.push({ ...d, concepto: 'Gastos comunes', createdAt: ts,
      metodo: d.metodo === 'Simulador' ? 'Pago en línea' : 'Transferencia',
      fecha: tiempo(ts) ? new Date(tiempo(ts)).toLocaleDateString('es-CL') : '', simulado: true });
  }
  return salida.sort((a,b) => tiempo(b.createdAt) - tiempo(a.createdAt));
}

export function unirMultas(base: any[], operaciones: any[]): any[] {
  return base.map(m => {
    if (m.estado === 'pagada') return m;
    const d = operaciones.find(p => p.tipo === 'multa' && p.objetivo === m.id && p.uid === m.uid && p.estado === 'aprobado');
    if (!d) return m;
    const ts = tiempo(d.resueltoAt || d.createdAt);
    const fecha = ts ? new Date(ts) : null;
    const fechaIngreso = fecha ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' }).format(fecha) : '';
    return { ...m, estado: 'pagada', comprobante: d.comprobante, simulado: true,
      fechaPago: fecha?.toLocaleDateString('es-CL') || '', fechaIngreso };
  });
}

export function escucharVista(tipo: 'pagos' | 'multas', uid: string, next: (lista: any[]) => void,
  error: (e: unknown) => void = console.error): Unsubscribe {
  let base: any[] = [], operaciones: any[] = [], listaBase = false, listaDemo = false;
  const emitir = () => {
    if (listaBase && listaDemo) next(tipo === 'pagos' ? unirPagos(base,operaciones) : unirMultas(base,operaciones));
  };
  const a = onSnapshot(query(collection(db,tipo),where('uid','==',uid)), s => {
    base = s.docs.map(d => ({...d.data(),id:d.id})); listaBase = true; emitir();
  }, error);
  const b = onSnapshot(query(collection(db,'pagosDemo'),where('uid','==',uid)), s => {
    operaciones = s.docs.map(d => ({...d.data(),id:d.id})); listaDemo = true; emitir();
  }, error);
  return () => { a(); b(); };
}
