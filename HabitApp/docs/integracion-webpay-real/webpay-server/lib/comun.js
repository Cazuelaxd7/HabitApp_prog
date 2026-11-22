const APP_URL = (process.env.APP_URL || 'https://habitapp-1bade.web.app').trim().replace(/\/$/, '');
const API_URL = (process.env.API_URL || 'https://habitapp-webpay.vercel.app').trim().replace(/\/$/, '');
let cached;
function getServices() {
  if (cached) return cached;
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { WebpayPlus, Options, IntegrationApiKeys, Environment, IntegrationCommerceCodes } = require('transbank-sdk');
  let app = getApps()[0];
  if (!app) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw Object.assign(new Error('Falta FIREBASE_SERVICE_ACCOUNT'), { code: 'CONFIG_FIREBASE_MISSING' });
    let credential;
    try {
      const value = raw.trim();
      const data = JSON.parse(value.startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8').replace(/^\uFEFF/, ''));
      credential = cert(data);
    } catch (_) {
      throw Object.assign(new Error('Credencial Firebase inválida'), { code: 'CONFIG_FIREBASE_INVALID' });
    }
    app = initializeApp({ credential });
  }
  cached = {
    admin: { auth: () => getAuth(app), firestore: { FieldValue } },
    db: getFirestore(app),
    tx: new WebpayPlus.Transaction(new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration)),
  };
  return cached;
}
function logError(context, error) {
  // No registrar credenciales, tokens ni respuestas completas del proveedor.
  console.error(context, { code: error?.code || 'INTERNAL_ERROR', name: error?.name || 'Error' });
}
const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function mesActual() {
  const fechaChile = new Date(
    new Date().toLocaleString('en-US', {
      timeZone: 'America/Santiago',
    })
  );

  return `${MESES[fechaChile.getMonth()]} ${fechaChile.getFullYear()}`;
}

async function valorGastoComun() {
  const { db } = getServices();
  const snapshot = await db.collection('config').doc('general').get();
  const datos = snapshot.exists ? snapshot.data() : {};

  const gastoComun =
    Number(datos.gastoComun) > 0 ? Number(datos.gastoComun) : 40000;

  const fondoReserva =
    datos.fondoReserva !== undefined && Number(datos.fondoReserva) >= 0
      ? Number(datos.fondoReserva)
      : 5000;

  return gastoComun + fondoReserva;
}

async function enviarComprobante(orden, comprobante, transaccion) {
  const { admin } = getServices();
  const nodemailer = require('nodemailer');
  const usuario = await admin.auth().getUser(orden.uid);

  if (!usuario.email) return;

  const gmail = (process.env.GMAIL_USER || '').trim();
  const password = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmail,
      pass: password,
    },
  });

  const monto = Number(orden.monto).toLocaleString('es-CL');
  const fecha = new Date().toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
  });

  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[ch]));
  const fila = (etiqueta, valor) =>
    `<tr><td style="color:#6b7280;padding:4px 0">${etiqueta}</td>` +
    `<td align="right"><b>${escape(valor)}</b></td></tr>`;

  await transporter.sendMail({
    from: `HabitApp <${gmail}>`,
    to: usuario.email,
    subject: `Comprobante de pago ${comprobante}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
        <h2 style="margin:0 0 4px">HabitApp</h2>
        <p style="color:#6b7280;margin:0 0 20px">Comprobante de pago</p>
        <table style="width:100%;font-size:14px">
          ${fila('N° comprobante', comprobante)}
          ${fila('Concepto', orden.concepto)}
          ${orden.mes ? fila('Período', orden.mes) : ''}
          ${fila('Monto', '$' + monto)}
          ${fila(
            'Medio de pago',
            'Webpay ****' + (transaccion.card_detail?.card_number || '')
          )}
          ${fila('Autorización', transaccion.authorization_code || '')}
          ${fila('Fecha', fecha)}
        </table>
        <p style="color:#9ca3af;font-size:12px;margin-top:20px">
          Guarda este correo como respaldo de tu pago.
        </p>
      </div>
    `,
  });
}

module.exports = { getServices, APP_URL, API_URL, mesActual, valorGastoComun, enviarComprobante, logError };
