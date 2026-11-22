import { Injectable } from '@angular/core';
import {
  Auth, getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, User, onAuthStateChanged, updateProfile, sendPasswordResetEmail,
  setPersistence, inMemoryPersistence
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseApp } from './firebase';
import { db } from './firestore';
import { RolUsuario } from '../models/usuario.model';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth: Auth = getAuth(firebaseApp);
  private userSubject = new BehaviorSubject<User | null | undefined>(undefined);
  user$ = this.userSubject.asObservable();

  constructor() {
    // La sesion vive solo en memoria: al recargar o reiniciar "ionic serve"
    // siempre se vuelve al login.
    setPersistence(this.auth, inMemoryPersistence).catch(e => console.error(e));
    onAuthStateChanged(this.auth, (user) => this.userSubject.next(user));
  }

  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  async register(email: string, password: string, nombre: string) {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(cred.user, { displayName: nombre });
    this.userSubject.next(cred.user);
    return cred;
  }

  resetPassword(email: string) {
    return sendPasswordResetEmail(this.auth, email);
  }

  logout() {
    return signOut(this.auth);
  }

  getCurrentUser(): User | null {
    return this.auth.currentUser;
  }

  waitForAuthState(): Promise<User | null> {
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(this.auth, (user) => {
        unsub();
        resolve(user);
      });
    });
  }

  /** Rol y estado desde usuarios/{uid}. Si falla la lectura, se asume residente pendiente. */
  async getPerfil(uid?: string): Promise<{ rol: RolUsuario; estado: string }> {
    const id = uid ?? this.auth.currentUser?.uid;
    if (!id) return { rol: 'residente', estado: 'pendiente' };
    try {
      const snap = await getDoc(doc(db, 'usuarios', id));
      const d = snap.data();
      return {
        rol: (d?.['rol'] as RolUsuario) ?? 'residente',
        estado: d?.['estado'] ?? 'activo', // cuentas antiguas sin estado = activas
      };
    } catch (e) {
      console.error('No se pudo leer el perfil:', e);
      return { rol: 'residente', estado: 'pendiente' };
    }
  }

  async getRol(uid?: string): Promise<RolUsuario> {
    return (await this.getPerfil(uid)).rol;
  }
}