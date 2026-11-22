import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
    {
        path: '',
        component: TabsPage,
        children: [
            {
                path: 'home',
                loadComponent: () => import('./home/home.page').then(m => m.HomePage),
            },
            {
                path: 'comunidad',
                loadComponent: () => import('./comunidad/comunidad.page').then(m => m.ComunidadPage),
            },
            {
                path: 'pagos',
                loadComponent: () => import('./pagos/pagos.page').then(m => m.PagosPage),
            },
            {
                // Ruta nueva: se llega desde la tarjeta "Multas pendientes" del inicio
                path: 'multas',
                loadComponent: () => import('./multas/multas.page').then(m => m.MultasPage),
            },
            {
                path: 'reservas',
                loadComponent: () => import('./reservas/reservas.page').then(m => m.ReservasPage),
            },
            {
                path: 'notificaciones',
                loadComponent: () => import('./notificaciones/notificaciones.page').then(m => m.NotificacionesPage),
            },
            {
                path: 'perfil',
                loadComponent: () => import('./perfil/perfil.page').then(m => m.PerfilPage),
            },
            {
                path: '',
                redirectTo: 'home',
                pathMatch: 'full',
            },
        ],
    },
];
