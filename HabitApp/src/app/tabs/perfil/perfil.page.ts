import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IonContent, ToastController } from '@ionic/angular';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { UsuariosService } from '../../services/usuarios.service';
import { Usuario, CONDOMINIOS, validarRut } from '../../models/usuario.model';

@Component({
  selector: 'app-perfil',
  standalone: true,
  templateUrl: './perfil.page.html',
  styleUrls: ['./perfil.page.scss'],
  imports: [IonContent, FormsModule],
})
export class PerfilPage implements OnInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);

  uid = '';
  correo = '';
  nombreAuth = '';
  perfil: Usuario | null = null;

  cargando = true;
  error = '';

  telefono = '';
  editando = false;
  guardando = false;

  condominios = CONDOMINIOS;
  form = { rut: '', condominioId: CONDOMINIOS[0].id, torre: '', depto: '', telefono: '' };
  creando = false;

  private sub?: Subscription;

  constructor(
    private router: Router,
    private toastCtrl: ToastController,
    private authService: AuthService,
    private usuariosService: UsuariosService
  ) {}

  ngOnInit() {
    this.cargar();
    this.sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (e.urlAfterRedirects.includes('/tabs/perfil')) this.cargar();
      });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    this.editando = false;
    this.cdr.markForCheck();

    const user = this.authService.getCurrentUser();
    if (!user) {
      this.perfil = null;
      this.cargando = false;
      this.error = 'Sin sesi\u00F3n activa. Vuelve a iniciar sesi\u00F3n.';
      this.cdr.markForCheck();
      return;
    }
    this.uid = user.uid;
    this.correo = user.email || '';
    this.nombreAuth = user.displayName || '';

    try {
      this.perfil = await this.usuariosService.obtenerPerfil(this.uid);
      this.telefono = this.perfil?.telefono || '';
    } catch (e: any) {
      console.error('Error cargando perfil', e);
      this.perfil = null;
      this.error = 'Error al leer el perfil: ' + (e?.code || e?.message || 'desconocido');
    }
    this.cargando = false;
    this.cdr.markForCheck();
  }

  async completar() {
    this.error = '';
    const f = this.form;
    if (!f.rut.trim() || !f.torre.trim() || !f.depto.trim() || !f.telefono.trim()) {
      this.error = 'Completa todos los campos.';
      return;
    }
    if (!validarRut(f.rut)) {
      this.error = 'El RUT no es v\u00E1lido.';
      return;
    }
    if (!/^\+?\d[\d\s]{7,14}$/.test(f.telefono.trim())) {
      this.error = 'El tel\u00E9fono no es v\u00E1lido.';
      return;
    }
    this.creando = true;
    this.cdr.markForCheck();
    try {
      this.perfil = await this.usuariosService.crearPerfil(this.uid, {
        nombre: this.nombreAuth || this.correo.split('@')[0],
        correo: this.correo,
        rut: f.rut,
        condominioId: f.condominioId,
        torre: f.torre,
        depto: f.depto,
        telefono: f.telefono,
      });
      this.telefono = this.perfil?.telefono || '';
      await this.toast('Datos guardados', 'success');
    } catch (e: any) {
      console.error(e);
      this.error = 'No se pudo guardar: ' + (e?.code || e?.message || 'desconocido');
    } finally {
      this.creando = false;
      this.cdr.markForCheck();
    }
  }

  get nombreMostrado(): string {
    return this.perfil?.nombre || this.nombreAuth || this.correo.split('@')[0] || 'Usuario';
  }

  get iniciales(): string {
    const partes = this.nombreMostrado.trim().split(/\s+/);
    return ((partes[0]?.[0] || 'U') + (partes[1]?.[0] || '')).toUpperCase();
  }

  get rolTexto(): string {
    return this.perfil?.rol === 'admin' ? 'Administrador' : 'Residente';
  }

  get rutFormateado(): string {
    const r = this.perfil?.rut || '';
    return r ? r.slice(0, -1) + '-' + r.slice(-1) : '-';
  }

  editar() {
    this.telefono = this.perfil?.telefono || '';
    this.editando = true;
  }

  cancelar() {
    this.telefono = this.perfil?.telefono || '';
    this.editando = false;
  }

  async guardar() {
    if (!this.uid || this.guardando) return;
    if (!/^\+?\d[\d\s]{7,14}$/.test(this.telefono.trim())) {
      await this.toast('Tel\u00E9fono no v\u00E1lido', 'danger');
      return;
    }
    this.guardando = true;
    this.cdr.markForCheck();
    try {
      await this.usuariosService.actualizarTelefono(this.uid, this.telefono.trim());
      if (this.perfil) this.perfil = { ...this.perfil, telefono: this.telefono.trim() };
      this.editando = false;
      await this.toast('Tel\u00E9fono actualizado', 'success');
    } catch (e) {
      console.error(e);
      await this.toast('No se pudo guardar', 'danger');
    } finally {
      this.guardando = false;
      this.cdr.markForCheck();
    }
  }

  async cerrarSesion() {
    await this.authService.logout();
    this.perfil = null;
    this.correo = '';
    this.router.navigateByUrl('/login');
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 2000, color });
    await t.present();
  }
}
