const { getServices, APP_URL, enviarComprobante, logError } = require('../lib/comun');

const destino = (tipo) => `${APP_URL}/tabs/${tipo === 'multa' ? 'multas' : 'pagos'}`;

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
  const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
  const p = { ...(req.query || {}), ...body };
  const token = p.token_ws;

  try {
    const { admin, db, tx } = getServices();
    // El usuario anulo el pago en Webpay (o se agoto el tiempo)
    if (!token || p.TBK_TOKEN) {
      let tipo;
      // No alterar una orden usando solamente parámetros del navegador.
      if (typeof p.TBK_TOKEN === 'string') {
        const found = await db.collection('ordenes').where('token', '==', p.TBK_TOKEN).limit(1).get();
        if (!found.empty) tipo = found.docs[0].data().tipo;
      }
      return res.redirect(302, `${destino(tipo)}?estado=cancelado`);
    }

    const snap = await db.collection('ordenes').where('token', '==', token).limit(1).get();
    if (snap.empty) return res.redirect(302, `${APP_URL}/tabs/pagos?estado=error`);
    const ordenRef = snap.docs[0].ref;
    const orden = snap.docs[0].data();
    const base = destino(orden.tipo);

    if (orden.estado === 'pagada') return res.redirect(302, `${base}?estado=ok&c=${orden.comprobante}`);

    if (typeof token !== 'string' || token.length > 256) throw new Error('Token inválido');
    let c;
    try { c = await tx.commit(token); }
    catch (_) { c = await tx.status(token); } // Recuperar confirmación previa si falló el registro local.
    const ok = c.status === 'AUTHORIZED' && c.response_code === 0 && Number(c.amount) === Number(orden.monto) && c.buy_order === ordenRef.id && c.session_id === orden.uid.slice(0, 60);

    if (!ok) {
      // No sobrescribir estados con una respuesta no autorizada o no coincidente.
      return res.redirect(302, `${base}?estado=rechazado`);
    }

    const comprobante = 'HB-' + String(c.buy_order).slice(-8);
    const registrada = await db.runTransaction(async (t) => {
      const actual = await t.get(ordenRef);
      if (actual.data().estado === 'pagada') return false;
      if (orden.tipo === 'gasto') {
        t.set(db.collection('pagos').doc(ordenRef.id), {
          uid: orden.uid, concepto: orden.concepto, mes: orden.mes, monto: orden.monto,
          metodo: 'Webpay', comprobante, autorizacion: c.authorization_code,
          tarjeta: c.card_detail?.card_number || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        t.update(db.collection('multas').doc(orden.multaId), {
          estado: 'pagada', comprobante,
          fechaPago: new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }),
        });
      }
      t.update(ordenRef, { estado: 'pagada', autorizacion: c.authorization_code, comprobante });
      return true;
    });

    // El correo nunca debe romper un pago ya confirmado
    try { if (registrada) await enviarComprobante(orden, comprobante, c); } catch (e) { logError('correo', e); }

    return res.redirect(302, `${base}?estado=ok&c=${comprobante}`);
  } catch (e) {
    logError('retorno', e);
    return res.redirect(302, `${APP_URL}/tabs/pagos?estado=error`);
  }
};