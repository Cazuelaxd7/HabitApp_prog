// Modelo de una multa.
// Cada multa pertenece a un usuario (uid) y la crea la administracion.
export type EstadoMulta = 'pendiente' | 'pagada';

export interface Multa {
  id: string;
  uid: string;
  motivo: string;        // por ejemplo "Ruido despues de las 23:00"
  monto: number;         // en pesos chilenos
  fecha: string;         // formato AAAA-MM-DD
  estado: EstadoMulta;
  comprobante?: string;  // se llena cuando la multa se paga
  fechaPago?: string;
}
