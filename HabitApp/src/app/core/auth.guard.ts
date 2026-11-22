import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Solo exige sesion iniciada. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.waitForAuthState();
  if (user) return true;
  return router.parseUrl('/login');
};

/** Solo admins. Un residente es enviado a /tabs/home. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.waitForAuthState();
  if (!user) return router.parseUrl('/login');
  const perfil = await auth.getPerfil(user.uid);
  return perfil.rol === 'admin' ? true : router.parseUrl('/tabs/home');
};

/** Solo residentes verificados. Admin -> /admin. Pendiente -> /pendiente. */
export const residenteGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.waitForAuthState();
  if (!user) return router.parseUrl('/login');
  const perfil = await auth.getPerfil(user.uid);
  if (perfil.rol === 'admin') return router.parseUrl('/admin');
  if (perfil.estado !== 'activo') return router.parseUrl('/pendiente');
  return true;
};