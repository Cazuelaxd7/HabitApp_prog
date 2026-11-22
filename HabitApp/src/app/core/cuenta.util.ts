import { PagoPendiente } from '../models/pago.model';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Valores de la cuenta. El admin los cambia en Configuracion (Firestore: config/general). */
let cfg = { gastoComun: 40000, fondoReserva: 5000 };

export function setConfigCuenta(c: Partial<typeof cfg>) {
  cfg = { ...cfg, ...c };
}

export function getConfigCuenta() {
  return cfg;
}

export function mesActual(d: Date = new Date()): string {
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Vence el ultimo dia del mes en curso. */
export function vencimientoActual(d: Date = new Date()): string {
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${ultimo} de ${MESES[d.getMonth()].toLowerCase()}`;
}

export function pendienteDelMes(d: Date = new Date()): PagoPendiente {
  const desglose = [
    { concepto: 'Gastos comunes', monto: cfg.gastoComun },
    { concepto: 'Fondo de reserva', monto: cfg.fondoReserva },
  ];
  return {
    mes: mesActual(d),
    vencimiento: vencimientoActual(d),
    desglose,
    total: desglose.reduce((s, i) => s + i.monto, 0),
  };
}