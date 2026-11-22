const { getServices, APP_URL, API_URL, mesActual, valorGastoComun, logError } = require('../lib/comun');

const ORIGENES = [APP_URL, 'http://localhost:8100'];

module.exports = async (req, res) => {
  const origen = req.headers.origin;
  if (ORIGENES.includes(origen)) res.setHeader('Access-Control-Allow-Origin', origen);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const h = req.headers.authorization || '';
    const idToken = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Debes iniciar sesión' });
    const { admin, db, tx } = getServices();
    let uid;
    try { uid = (await admin.auth().verifyIdToken(idToken)).uid; }
    catch (_) { return res.status(401).json({ error: 'Sesión inválida o vencida' }); }

    const usuario = await db.collection('usuarios').doc(uid).get();
    if (!usuario.exists) return res.status(403).json({ error: 'Perfil no encontrado' });
    const perfil = usuario.data();
    if (perfil.rol !== 'admin' && (perfil.estado ?? 'activo') !== 'activo') {
      return res.status(403).json({ error: 'Tu cuenta aún no está verificada' });
    }

    const tipo = req.body?.tipo === 'multa' ? 'multa' : 'gasto';
    let monto, concepto, mes = null, multaId = null;

    if (tipo === 'gasto') {
      mes = mesActual();
      const ya = await db.collection('pagos').where('uid', '==', uid).where('mes', '==', mes).limit(1).get();
      if (!ya.empty) return res.status(409).json({ error: 'El mes ya está pagado' });
      monto = await valorGastoComun();
      concepto = 'Gastos comunes';
    } else {
      multaId = String(req.body?.multaId || '');
      const m = multaId ? await db.collection('multas').doc(multaId).get() : null;
      if (!m || !m.exists || m.data().uid !== uid || m.data().estado !== 'pendiente') {
        return res.status(400).json({ error: 'Multa no válida' });
      }
      monto = m.data().monto;
      concepto = 'Multa: ' + m.data().motivo;
    }

    const buyOrder = ('HB' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase().slice(0, 26);
    monto = Number(monto);
    if (!Number.isSafeInteger(monto) || monto <= 0) return res.status(400).json({ error: 'Monto inválido' });
    const r = await tx.create(buyOrder, uid.slice(0, 60), monto, `${API_URL}/api/retorno`);

    await db.collection('ordenes').doc(buyOrder).set({
      uid, tipo, monto, concepto, mes, multaId, estado: 'iniciada',
      token: r.token, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ url: r.url, token: r.token });
  } catch (e) {
    logError('iniciar', e);
    return res.status(500).json({ error: 'No se pudo iniciar el pago' });
  }
};