/**
 * POST /api/verify-payment  (CommonJS, fully self-contained)
 *
 * Verifies the Razorpay checkout signature with the key secret:
 *   HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET) === razorpay_signature
 * The payment is only accepted when the signatures match.
 */
const crypto = require('crypto');

/** Origins allowed to call the payment API from a browser (the GitHub Pages copy of the site). */
const ALLOWED_ORIGINS = ['https://imkathir.github.io'];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.setHeader('Vary', 'Origin');
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
      return;
    }

    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

    if (!keySecret) {
      res.status(500).json({
        success: false,
        error: 'Razorpay is not configured on the server (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).',
      });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const orderId = String(body.razorpay_order_id || '');
    const paymentId = String(body.razorpay_payment_id || '');
    const signature = String(body.razorpay_signature || '');

    if (!orderId || !paymentId || !signature) {
      res.status(400).json({
        success: false,
        verified: false,
        error: 'Missing razorpay_order_id, razorpay_payment_id or razorpay_signature.',
      });
      return;
    }

    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const given = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');

    const verified =
      given.length === expectedBuf.length && crypto.timingSafeEqual(given, expectedBuf);

    if (!verified) {
      res.status(400).json({
        success: false,
        verified: false,
        error: 'Payment signature verification failed. The payment was not accepted.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      verified: true,
      order_id: orderId,
      payment_id: paymentId,
    });
  } catch (err) {
    console.error('[razorpay] verify-payment failed:', err && err.message);
    res.status(500).json({
      success: false,
      verified: false,
      error: (err && err.message) || 'Payment verification failed.',
    });
  }
};
