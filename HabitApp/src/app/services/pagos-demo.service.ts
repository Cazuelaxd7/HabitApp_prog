import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '../core/firestore';
import { firebaseApp } from '../core/firebase';
import {
  pendienteDelMes,
  setConfigCuenta,
} from '../core/cuenta.util';

import {
  CuentaBancaria,
  camposBanco,
} from './pagos.service';

export interface PagoDemo {
  id: string;
  uid: string;
  tipo: 'gasto' | 'multa';
  objetivo: string;
  mes: string;
  monto: number;
  metodo: 'Simulador' | 'Transferencia demo';
  estado: 'aprobado' | 'rechazado' | 'en_revision';
  referencia: string;
  comprobante: string;
  simulado: true;
  cuentaDestino: Partial<CuentaBancaria>;
  createdAt?: { toMillis(): number };
  resueltoAt?: unknown;
}

export interface ConceptoDemo {
  tipo: 'gasto' | 'multa';
  objetivo: string;
  mes: string;
  monto: number;
  concepto: string;
}

export function errorPagoDemo(error: unknown): string {
  const code = (error as { code?: string })?.code || '';

  if (code.includes('permission-denied')) {
    return 'Sin permiso para la demostración. Publica las reglas entregadas y verifica que la cuenta esté activa.';
  }

  if (code.includes('unavailable')) {
    return 'No hay conexión con Firestore. Revisa Internet y vuelve a intentar.';
  }

  return error instanceof Error
    ? error.message
    : 'No se pudo completar la demostración.';
}

@Injectable({ providedIn: 'root' })
export class PagosDemoService {

  private uid() {
    const uid = getAuth(firebaseApp).currentUser?.uid;

    if (!uid) {
      throw new Error('Inicia sesión para continuar.');
    }

    return uid;
  }

  escuchar(
    uid: string | null,
    next: (pagos: PagoDemo[]) => void,
    error: (e: unknown) => void
  ) {
    const ref = collection(db, 'pagosDemo');

    return onSnapshot(
      uid ? query(ref, where('uid', '==', uid)) : ref,
      s => {
        next(
          s.docs
            .map(d => ({
              ...d.data(),
              id: d.id,
            } as PagoDemo))
            .sort(
              (a, b) =>
                (b.createdAt?.toMillis?.() || 0) -
                (a.createdAt?.toMillis?.() || 0)
            )
        );
      },
      error
    );
  }

  async concepto(
    tipo: 'gasto' | 'multa',
    multaId = ''
  ): Promise<ConceptoDemo> {
    const uid = this.uid();

    if (tipo === 'multa') {
      if (!multaId || multaId.includes('/')) {
        throw new Error('Multa no válida.');
      }

      const s = await getDoc(doc(db, 'multas', multaId));
      const m = s.data();

      if (
        !m ||
        m['uid'] !== uid ||
        m['estado'] !== 'pendiente'
      ) {
        throw new Error(
          'La multa no está pendiente o no pertenece a tu cuenta.'
        );
      }

      return {
        tipo,
        objetivo: multaId,
        mes: '',
        monto: Number(m['monto']),
        concepto: 'Multa: ' + m['motivo'],
      };
    }

    // Valores predeterminados alineados con el cobro mensual.
    const s = await getDoc(doc(db, 'config', 'general'));
    const c = s.data();

    const gastoComun = Number(c?.['gastoComun'] ?? 220000);
    const fondoReserva = Number(c?.['fondoReserva'] ?? 5000);

    if (
      !Number.isSafeInteger(gastoComun) ||
      gastoComun <= 0 ||
      !Number.isSafeInteger(fondoReserva) ||
      fondoReserva < 0
    ) {
      throw new Error('La configuración del cobro mensual no es válida.');
    }

    setConfigCuenta({
      gastoComun,
      fondoReserva,
    });

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());

    const objetivo =
      parts.find(p => p.type === 'year')!.value +
      '-' +
      parts.find(p => p.type === 'month')!.value;

    const [year, month] = objetivo.split('-').map(Number);

    const p = pendienteDelMes(
      new Date(year, month - 1, 15)
    );

    return {
      tipo,
      objetivo,
      mes: p.mes,
      monto: p.total,
      concepto: 'Gastos comunes',
    };
  }

  async registrar(
    concepto: ConceptoDemo,
    metodo: PagoDemo['metodo'],
    estado: PagoDemo['estado'],
    referencia = ''
  ) {
    const uid = this.uid();

    const vigente = await this.concepto(
      concepto.tipo,
      concepto.tipo === 'multa' ? concepto.objetivo : ''
    );

    if (
      vigente.monto !== concepto.monto ||
      vigente.objetivo !== concepto.objetivo
    ) {
      throw new Error(
        'El cobro cambió. Vuelve a abrir la demostración.'
      );
    }

    if (
      !Number.isSafeInteger(vigente.monto) ||
      vigente.monto <= 0
    ) {
      throw new Error('El monto configurado no es válido.');
    }

    let cuentaDestino: Partial<CuentaBancaria> = {};

    if (metodo === 'Transferencia demo') {
      referencia = referencia.trim();

      if (referencia.length < 4 || referencia.length > 80) {
        throw new Error(
          'La referencia debe tener entre 4 y 80 caracteres.'
        );
      }

      const banco = (
        await getDoc(doc(db, 'config', 'transferencia'))
      ).data();

      if (
        !banco ||
        !camposBanco.every(
          c =>
            typeof banco[c] === 'string' &&
            banco[c].trim()
        )
      ) {
        throw new Error(
          'Administración debe configurar la cuenta bancaria.'
        );
      }

      cuentaDestino = Object.fromEntries(
        camposBanco.map(c => [c, banco[c]])
      );

      estado = 'en_revision';
    } else if (
      estado !== 'aprobado' &&
      estado !== 'rechazado'
    ) {
      throw new Error(
        'Resultado de demostración no válido.'
      );
    }

    // Un único documento por residente, tipo y período.
    // No se generan transacciones mensuales duplicadas.
    const id =
      `${uid}__${vigente.tipo}__${vigente.objetivo}`;

    const ref = doc(db, 'pagosDemo', id);

    const nuevo = {
      uid,
      tipo: vigente.tipo,
      objetivo: vigente.objetivo,
      mes: vigente.mes,
      monto: vigente.monto,
      metodo,
      estado,
      referencia,
      cuentaDestino,
      simulado: true as const,
      comprobante: 'DEMO-' + crypto.randomUUID(),
      createdAt: serverTimestamp(),
    };

    return runTransaction(db, async tx => {
      const s = await tx.get(ref);

      if (
        s.exists() &&
        s.data()['estado'] !== 'rechazado'
      ) {
        return {
          ...s.data(),
          id,
        } as PagoDemo;
      }

      tx.set(ref, nuevo);

      return {
        ...nuevo,
        createdAt: undefined,
        id,
      } as PagoDemo;
    });
  }

  async resolver(id: string, aprobar: boolean) {
    const ref = doc(db, 'pagosDemo', id);

    await runTransaction(db, async tx => {
      const s = await tx.get(ref);

      if (
        !s.exists() ||
        s.data()['estado'] !== 'en_revision'
      ) {
        throw new Error(
          'Esta solicitud ya fue resuelta.'
        );
      }

      tx.update(ref, {
        estado: aprobar ? 'aprobado' : 'rechazado',
        resueltoAt: serverTimestamp(),
      });
    });
  }
}