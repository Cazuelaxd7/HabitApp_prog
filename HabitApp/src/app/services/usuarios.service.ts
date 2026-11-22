import { Injectable } from '@angular/core';
import { doc, getDoc, updateDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../core/firestore';
import { Usuario, NuevoUsuario, CONDOMINIOS, limpiarRut } from '../models/usuario.model';

function conTiempo<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject({ code: 'timeout', message: 'Firestore no responde' }), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private cache: Usuario | null = null;

  /** Crea usuarios/{uid} con un codigo HB-000001 secuencial (transaccion sobre meta/contadores). */
  async crearPerfil(uid: string, datos: NuevoUsuario): Promise<Usuario> {
    const contadorRef = doc(db, 'meta', 'contadores');
    const userRef = doc(db, 'usuarios', uid);
    const condo = CONDOMINIOS.find(c => c.id === datos.condominioId);

    await conTiempo(runTransaction(db, async (tx) => {
      const c = await tx.get(contadorRef);
      const n = (c.exists() ? (c.data() as any).usuarios || 0 : 0) + 1;
      const codigo = 'HB-' + String(n).padStart(6, '0');
      tx.set(contadorRef, { usuarios: n });
      tx.set(userRef, {
        uid,
        codigo,
        nombre: datos.nombre.trim(),
        correo: datos.correo.trim().toLowerCase(),
        rut: limpiarRut(datos.rut),
        condominioId: datos.condominioId,
        condominioNombre: condo?.nombre || '',
        torre: datos.torre.trim(),
        depto: datos.depto.trim(),
        telefono: datos.telefono.trim(),
        rol: 'residente',
        estado: 'pendiente',
        createdAt: serverTimestamp(),
      });
    }), 12000);

    this.cache = null;
    return (await this.obtenerPerfil(uid)) as Usuario;
  }

  async obtenerPerfil(uid: string): Promise<Usuario | null> {
    if (this.cache && this.cache.uid === uid) return this.cache;
    const snap = await conTiempo(getDoc(doc(db, 'usuarios', uid)));
    if (!snap.exists()) return null;
    this.cache = snap.data() as Usuario;
    return this.cache;
  }

  async actualizarTelefono(uid: string, telefono: string): Promise<void> {
    await conTiempo(updateDoc(doc(db, 'usuarios', uid), { telefono }));
    if (this.cache && this.cache.uid === uid) this.cache = { ...this.cache, telefono };
  }
}
