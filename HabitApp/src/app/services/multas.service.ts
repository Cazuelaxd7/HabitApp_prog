import { escucharVista } from '../core/finanzas-vista';
import { Injectable } from '@angular/core';
import { collection, doc, onSnapshot, query, where, updateDoc, Unsubscribe } from 'firebase/firestore';
import { db } from '../core/firestore';
import { Multa } from '../models/multa.model';

@Injectable({ providedIn: 'root' })
export class MultasService {

  // Escucha en tiempo real las multas del usuario.
  // Uso where('uid', '==', uid) para traer solo las suyas.
  escucharMisMultas(uid: string, callback: (multas: Multa[]) => void): Unsubscribe {
    return escucharVista('multas', uid, lista => callback(lista.sort((a,b) => (b.fecha || '').localeCompare(a.fecha || ''))));
  }

  // Marca la multa como pagada (el pago es simulado, igual que en gastos comunes).
  // Devuelve el comprobante para mostrarselo al usuario.
  async pagarMulta(id: string): Promise<string> {
    const comprobante = 'MU-' + Date.now().toString(36).toUpperCase();
    await updateDoc(doc(db, 'multas', id), {
      estado: 'pagada',
      fechaPago: new Date().toLocaleDateString('es-CL'),
      comprobante,
    });
    return comprobante;
  }
}
