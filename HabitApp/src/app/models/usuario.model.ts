export type RolUsuario = 'residente' | 'admin';
export type EstadoUsuario = 'pendiente' | 'activo';

export interface Usuario {
  uid: string;
  codigo: string;
  nombre: string;
  correo: string;
  rut: string;
  condominioId: string;
  condominioNombre: string;
  torre: string;
  depto: string;
  telefono: string;
  rol: RolUsuario;
  estado: EstadoUsuario;
}

export interface NuevoUsuario {
  nombre: string;
  correo: string;
  rut: string;
  condominioId: string;
  torre: string;
  depto: string;
  telefono: string;
}

export const CONDOMINIOS = [
  { id: 'habitapp', nombre: 'Condominio HabitApp' },
];

export function limpiarRut(rut: string): string {
  return rut.replace(/[.\-\s]/g, '').toUpperCase();
}

export function validarRut(rut: string): boolean {
  const r = limpiarRut(rut);
  if (!/^\d{7,8}[0-9K]$/.test(r)) return false;
  const cuerpo = r.slice(0, -1);
  const dv = r.slice(-1);
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const res = 11 - (suma % 11);
  const esperado = res === 11 ? '0' : res === 10 ? 'K' : String(res);
  return dv === esperado;
}

export function formatearRut(rut: string): string {
  const r = limpiarRut(rut);
  return r.slice(0, -1) + '-' + r.slice(-1);
}
