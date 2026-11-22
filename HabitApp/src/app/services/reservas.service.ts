import { Injectable } from '@angular/core';
import {
  collection, addDoc, updateDoc, doc, onSnapshot, query, where,
  serverTimestamp, Unsubscribe
} from 'firebase/firestore';
import { db } from '../core/firestore';
import { Reserva, EspacioInfo, HORARIOS_ESTANDAR } from '../models/reserva.model';
import { UsuariosService } from './usuarios.service';

const ICONOS: Record<string, string> = { quincho: '🏡', salon: '🏢', court: '⚽' };

@Injectable({ providedIn: 'root' })
export class ReservasService {

  constructor(private usuarios: UsuariosService) {}

  /** Espacios que administra el admin (coleccion "espacios"). Solo los activos. */
  escucharEspacios(callback: (espacios: EspacioInfo[]) => void): Unsubscribe {
    return onSnapshot(
      collection(db, 'espacios'),
      (snapshot) => {
        const lista: EspacioInfo[] = snapshot.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter((e: any) => e.activo !== false && e.nombre)
          .map((e: any) => {
            const tipo = (['quincho', 'salon', 'court'].includes(e.tipo) ? e.tipo : 'salon') as EspacioInfo['tipo'];
            return {
              id: e.id,
              nombre: e.nombre,
              icono: ICONOS[tipo],
              tipo,
              capacidad: Number(e.capacidad) > 0 ? Number(e.capacidad) : 20,
              horarios: Array.isArray(e.horarios) && e.horarios.length ? e.horarios : HORARIOS_ESTANDAR,
              precio: Number(e.precio) > 0 ? Number(e.precio) : 0,
            };
          })
          .sort((a, b) => a.nombre.localeCompare(b.nombre));
        callback(lista);
      },
      () => callback([])
    );
  }

  /** Todas las reservas vigentes (para saber que horarios estan ocupados). */
  escucharReservasProximas(callback: (reservas: Reserva[]) => void): Unsubscribe {
    const q = query(collection(db, 'reservas'), where('estado', '==', 'upcoming'));
    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
  }

  escucharMisReservas(uid: string, callback: (reservas: Reserva[]) => void): Unsubscribe {
    const q = query(
      collection(db, 'reservas'),
      where('uid', '==', uid),
      where('estado', '==', 'upcoming')
    );
    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
  }

  escucharHistorial(uid: string, callback: (reservas: Reserva[]) => void): Unsubscribe {
    const q = query(
      collection(db, 'reservas'),
      where('uid', '==', uid),
      where('estado', 'in', ['completed', 'cancelled'])
    );
    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
  }

  /** Crea la reserva y devuelve su id. Con monto > 0 queda "por pagar". */
  async crearReserva(uid: string, espacio: string, fecha: string, horario: string, monto = 0): Promise<string> {
    const perfil = await this.usuarios.obtenerPerfil(uid);
    const ref = await addDoc(collection(db, 'reservas'), {
      uid,
      codigo: perfil?.codigo ?? null,
      condominioId: perfil?.condominioId ?? null,
      torre: perfil?.torre ?? null,
      depto: perfil?.depto ?? null,
      espacio, fecha, horario,
      monto,
      pagado: false,
      estado: 'upcoming',
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async cancelarReserva(id: string): Promise<void> {
    await updateDoc(doc(db, 'reservas', id), { estado: 'cancelled' });
  }
}