import { Component, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { AuthService } from '../core/auth.service';
import { UsuariosService } from '../services/usuarios.service';
import { CONDOMINIOS, validarRut } from '../models/usuario.model';

@Component({
  selector: 'app-register',
  standalone: true,
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  imports: [CommonModule, FormsModule, IonContent],
})
export class RegisterPage {
  private cdr = inject(ChangeDetectorRef);

  nombre = '';
  rut = '';
  email = '';
  condominioId = CONDOMINIOS[0].id;
  torre = '';
  depto = '';
  telefono = '';
  password = '';
  confirmPassword = '';

  condominios = CONDOMINIOS;
  cargando = false;
  errorMessage = '';

  constructor(
    private router: Router,
    private authService: AuthService,
    private usuariosService: UsuariosService
  ) {}

  async onSubmit() {
    this.errorMessage = '';

    if (!this.nombre.trim() || !this.rut.trim() || !this.email.trim() ||
        !this.torre.trim() || !this.depto.trim() || !this.telefono.trim() ||
        !this.password.trim()) {
      this.errorMessage = 'Completa todos los campos.';
      return;
    }
    if (!validarRut(this.rut)) {
      this.errorMessage = 'El RUT no es v\u00E1lido.';
      return;
    }
    if (!/^\+?\d[\d\s]{7,14}$/.test(this.telefono.trim())) {
      this.errorMessage = 'El tel\u00E9fono no es v\u00E1lido.';
      return;
    }
    if (this.password.length < 6) {
      this.errorMessage = 'La contrase\u00F1a debe tener al menos 6 caracteres.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Las contrase\u00F1as no coinciden.';
      return;
    }

    this.cargando = true;
    this.cdr.markForCheck();
    try {
      const cred = await this.authService.register(this.email.trim(), this.password, this.nombre.trim());
      await this.usuariosService.crearPerfil(cred.user.uid, {
        nombre: this.nombre,
        correo: this.email,
        rut: this.rut,
        condominioId: this.condominioId,
        torre: this.torre,
        depto: this.depto,
        telefono: this.telefono,
      });
      this.router.navigateByUrl('/tabs/home');
    } catch (error: any) {
      console.error(error);
      this.errorMessage = this.mapFirebaseError(error?.code) + ' (' + (error?.code || error?.message || 'error') + ')';
    } finally {
      this.cargando = false;
      this.cdr.markForCheck();
    }
  }

  private mapFirebaseError(code: string): string {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Ese correo ya est\u00E1 registrado.';
      case 'auth/invalid-email':
        return 'El correo ingresado no es v\u00E1lido.';
      case 'auth/weak-password':
        return 'La contrase\u00F1a es muy d\u00E9bil.';
      case 'permission-denied':
        return 'Sin permisos en Firestore. Publica las reglas (firestore.rules).';
      default:
        return 'No se pudo crear la cuenta. Intenta nuevamente.';
    }
  }

  goToLogin() {
    this.router.navigateByUrl('/login');
  }
}
