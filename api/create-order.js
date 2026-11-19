/**
 * POST /api/create-order  (CommonJS, fully self-contained)
 *
 * Creates a Razorpay order for the "Buy me a coffee" section.
 * The key secret never leaves the server: the browser only receives the order id.
 */
const crypto = require('crypto');

const MIN_ORDER_AMOUNT = 100;
const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'ZAR'];
const RAZORPAY_ORDERS_API = 'https://api.razorpay.com/v1/orders';

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

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const upstream = await fetch(RAZORPAY_ORDERS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount,
        currency,
        receipt,
        notes,
        payment_capture: 1,
      }),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      res.status(status).json({
        success: false,
        error:
          (data && data.error && data.error.description) ||
          (data && data.message) ||
          `Razorpay order creation failed (HTTP ${upstream.status}).`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
    });
  } catch (err) {
    console.error('[razorpay] create-order failed:', err && err.message);
    res.status(502).json({
      success: false,
      error: (err && err.message) || 'Could not create the Razorpay order.',
    });
  }
};
