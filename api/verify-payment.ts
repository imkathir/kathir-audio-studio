/**
 * POST /api/verify-payment
 *
 * Verifies the Razorpay checkout signature with the key secret:
 *   HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET) === razorpay_signature
 * A payment is only reported as successful when the signatures match.
 */
import { isRazorpayConfigured, verifyRazorpaySignature } from '../razorpay-api';
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

    const verified = verifyRazorpaySignature({ orderId, paymentId, signature });

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
  } catch (err: any) {
    console.error('[razorpay] verify-payment failed:', err?.message || err);
    res.status(500).json({
      success: false,
      verified: false,
      error: err?.message || 'Payment verification failed.',
    });
  }
}
