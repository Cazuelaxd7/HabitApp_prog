import { Injectable } from '@angular/core';
import { collection, doc, onSnapshot, query, where, updateDoc, Unsubscribe } from 'firebase/firestore';
import { db } from '../core/firestore';
import { Multa } from '../models/multa.model';

@Injectable({ providedIn: 'root' })
export class MultasService {

  // Escucha en tiempo real las multas del usuario.
  // Uso where('uid', '==', uid) para traer solo las suyas.
  escucharMisMultas(uid: string, callback: (multas: Multa[]) => void): Unsubscribe {
    const q = query(collection(db, 'multas'), where('uid', '==', uid));
    return onSnapshot(q, (snapshot) => {
      const multas: Multa[] = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      // Ordeno aqui en el cliente (mas nueva primero) para no tener que crear un indice en Firestore
      multas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
      callback(multas);
    });
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
