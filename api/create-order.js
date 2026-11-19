/**
 * POST /api/create-order  (CommonJS - Vercel serverless function)
 *
 * Creates a Razorpay order for the "Buy me a coffee" section.
 * The key secret never leaves the server: the browser only receives the order id.
 *
 * The official `razorpay` SDK is used when it is available and the Razorpay
 * REST API is used as a fallback, so the function never depends on the SDK
 * being bundleable in the current runtime.
 */
const crypto = require('crypto');

const MIN_ORDER_AMOUNT = 100;
const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'ZAR'];
const RAZORPAY_ORDERS_API = 'https://api.razorpay.com/v1/orders';

/** Loads the CommonJS Razorpay SDK, or null when it cannot be resolved. */
function loadRazorpaySdk() {
  try {
    const mod = require('razorpay');
    const Razorpay = mod && mod.default ? mod.default : mod;
    return typeof Razorpay === 'function' ? Razorpay : null;
  } catch (err) {
    console.warn('[razorpay] SDK unavailable, using the REST fallback:', err && err.message);
    return null;
  }
}

/** Creates the order through the Razorpay REST API. */
async function createOrderViaRest(keyId, keySecret, payload) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const upstream = await fetch(RAZORPAY_ORDERS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    const error = new Error(
      (data && data.error && data.error.description) ||
        (data && data.message) ||
        `Razorpay order creation failed (HTTP ${upstream.status}).`
    );
    error.status = upstream.status;
    throw error;
  }

  return { id: data.id, amount: data.amount, currency: data.currency };
}

/** Creates the order through the official SDK, falling back to the REST API. */
async function createOrder(keyId, keySecret, payload) {
  const Razorpay = loadRazorpaySdk();

  if (Razorpay) {
    try {
      const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const order = await client.orders.create(payload);
      return { id: order.id, amount: order.amount, currency: order.currency };
    } catch (err) {
      console.warn(
        '[razorpay] SDK order creation failed, using the REST fallback:',
        err && err.message
      );
    }
  }

  return createOrderViaRest(keyId, keySecret, payload);
}

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
      return;
    }

    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

    if (!keyId || !keySecret) {
      res.status(500).json({
        success: false,
        error: 'Razorpay is not configured on the server (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).',
      });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const amount = Number(body.amount);
    const currency = String(body.currency || 'INR').toUpperCase();

    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid amount. Send a positive whole number in the minor unit of the currency.',
      });
      return;
    }

    if (amount < MIN_ORDER_AMOUNT) {
      res.status(400).json({
        success: false,
        error: `Minimum order amount is ${MIN_ORDER_AMOUNT} (e.g. 100 paise = ₹1).`,
      });
      return;
    }

    if (SUPPORTED_CURRENCIES.indexOf(currency) === -1) {
      res.status(400).json({ success: false, error: `Unsupported currency "${currency}".` });
      return;
    }

    const notes = { source: 'kathir-audio-studio' };
    if (typeof body.name === 'string' && body.name) {
      notes.supporter_name = body.name.slice(0, 100);
    }
    if (typeof body.message === 'string' && body.message) {
      notes.supporter_message = body.message.slice(0, 200);
    }

    const receipt = `coffee_${Date.now().toString(36)}_${crypto
      .randomBytes(4)
      .toString('hex')}`.slice(0, 40);

    const order = await createOrder(keyId, keySecret, {
      amount,
      currency,
      receipt,
      notes,
      payment_capture: 1,
    });

    res.status(200).json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error('[razorpay] create-order failed:', err && err.message);
    const status =
      err && typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({
      success: false,
      error: (err && err.message) || 'Could not create the Razorpay order.',
    });
  }
};
