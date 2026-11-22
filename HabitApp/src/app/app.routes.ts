import { Routes } from '@angular/router';
import { authGuard, adminGuard, residenteGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then(m => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.page').then(m => m.RegisterPage),
  },
  {
    path: 'pendiente',
    canActivate: [authGuard],
    loadComponent: () => import('./pendiente/pendiente.page').then(m => m.PendientePage),
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/admin.page').then(m => m.AdminPage),
  },
  {
    path: 'webpay',
    canActivate: [residenteGuard],
    loadComponent: () => import('./webpay-sim/webpay-sim.page').then(m => m.WebpaySimPage),
  },
  {
    path: 'tabs',
    canActivate: [residenteGuard],
    loadChildren: () => import('./tabs/tabs.routes').then(m => m.routes),
  },
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: '/login',
  },
];