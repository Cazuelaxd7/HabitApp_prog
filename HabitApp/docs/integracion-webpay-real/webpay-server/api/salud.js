module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let etapa = 'cargar_firebase_app';

  try {
    const { getApps, initializeApp, cert } = require('firebase-admin/app');

    etapa = 'consultar_apps';
    let app = getApps()[0];

    if (!app) {
      etapa = 'leer_credencial';
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) {
        return res.status(503).json({
          ok: false,
          etapa,
          code: 'CONFIG_FIREBASE_MISSING',
        });
      }

      etapa = 'decodificar_credencial';
      const value = raw.trim();
      const data = JSON.parse(
        value.startsWith('{')
          ? value
          : Buffer.from(value, 'base64').toString('utf8').replace(/^\uFEFF/, '')
      );

      etapa = 'crear_certificado';
      const credential = cert(data);

      etapa = 'inicializar_firebase';
      app = initializeApp({ credential });
    }

    etapa = 'cargar_firestore';
    require('firebase-admin/firestore').getFirestore(app);

    etapa = 'cargar_auth';
    require('firebase-admin/auth').getAuth(app);

    etapa = 'cargar_transbank';
    require('transbank-sdk');

    etapa = 'inicializar_comun';
    require('../lib/comun').getServices();

    return res.status(200).json({
      ok: true,
      version: 'diagnostico-3',
      alcance: 'Inicializacion; pendiente probar pago y conexiones',
    });
  } catch (e) {
    return res.status(503).json({
      ok: false,
      version: 'diagnostico-3',
      etapa,
      code: e.code || 'SIN_CODIGO',
      tipo: e.name || 'Error',
    });
  }
};