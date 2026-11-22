export interface DesgloseItem {
  concepto: string;
  monto: number;
}

export interface PagoPendiente {
  mes: string;
  vencimiento: string;
  desglose: DesgloseItem[];
  total: number;
}

export type EstadoPago =
  | 'aprobado'
  | 'rechazado'
  | 'en_revision';

export interface Pago {
  id: string;
  uid?: string;
  concepto: string;
  mes: string;
  monto: number;
  fecha: string;
  metodo: string;
  comprobante: string;

  // Estado y datos complementarios de los registros.
  estado?: EstadoPago;
  referencia?: string;
  simulado?: boolean;
  autorizacion?: string;
  tarjeta?: string;
  pagadoEn?: string;

  // El servicio de historial transforma createdAt a milisegundos.
  createdAt?: number;
}