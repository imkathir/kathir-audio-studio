/**
 * POST /api/create-order
 *
 * Creates a Razorpay order for the "Buy me a coffee" section.
 * The key secret never leaves the server: the browser only receives the order id.
 */
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  MIN_ORDER_AMOUNT,
} from '../razorpay-api';
import { ApiRequest, ApiResponse } from '../shared/api-types';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
      return;
    }

    if (!isRazorpayConfigured()) {
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

    const order = await createRazorpayOrder({
      amount,
      currency,
      supporterName: typeof body.name === 'string' ? body.name : undefined,
      supporterMessage: typeof body.message === 'string' ? body.message : undefined,
    });

    res.status(200).json({
      success: true,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err: any) {
    const status =
      typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 502;
    console.error('[razorpay] create-order failed:', err?.message || err);
    res.status(status).json({
      success: false,
      error: err?.message || 'Could not create the Razorpay order.',
    });
  }
}
