import { escucharVista, tiempo } from '../core/finanzas-vista';
import { getAuth } from 'firebase/auth';
import { Injectable } from '@angular/core';
import {
  collection, doc, onSnapshot, query, where, Unsubscribe
} from 'firebase/firestore';
import { db } from '../core/firestore';
import { Pago } from '../models/pago.model';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp } from '../core/firebase';

export const camposBanco = ['titular', 'rut', 'banco', 'tipo', 'cuenta', 'correo'] as const;
export type CuentaBancaria = Record<typeof camposBanco[number], string>;
export interface SolicitudPago {
  id: string;
  uid: string;
  mes: string;
  monto: number;
  estado: string;
  metodo: string;
  referencia: string;
  buyOrder: string;
  cuentaDestino?: CuentaBancaria;
}

@Injectable({ providedIn: 'root' })
export class PagosService {



  /** Pagos ahora viven en la coleccion raiz "pagos" (filtrados por uid). */
  escucharHistorial(uid: string, callback: (pagos: Pago[]) => void): Unsubscribe {
    return escucharVista('pagos', uid, lista => callback(lista.map(p => ({ ...p, createdAt: tiempo(p.createdAt) }))));
  }

  escucharBanco(callback: (cuenta: CuentaBancaria | null) => void) {
    return onSnapshot(doc(db, 'config', 'transferencia'), s => {
      const datos = s.data();
      callback(datos && camposBanco.every(c => typeof datos[c] === 'string' && datos[c])
        ? datos as CuentaBancaria : null);
    }, () => callback(null));
  }

  escucharSolicitudes(uid: string | null, callback: (solicitudes: SolicitudPago[]) => void) {
    const ref = collection(db, 'solicitudesPago');
    return onSnapshot(uid ? query(ref, where('uid', '==', uid)) : ref, s => {
      callback(s.docs.map(d => ({ ...d.data(), id: d.id } as SolicitudPago)));
    }, () => callback([]));
  }

  async iniciar(metodo: string, mes: string, monto: number, referencia: string) {
    const llamar = httpsCallable<
      { metodo: string; mes: string; monto: number; referencia: string },
      { estado?: string; url?: string; token?: string }
    >(getFunctions(firebaseApp), 'iniciarPagoHabitApp');
    return (await llamar({ metodo, mes, monto, referencia })).data;
  }

  conciliar(solicitud: SolicitudPago, aprobar: boolean) {
    return httpsCallable(getFunctions(firebaseApp), 'conciliarTransferenciaHabitApp')({
      id: solicitud.id, buyOrder: solicitud.buyOrder, aprobar,
    });
  }
}
