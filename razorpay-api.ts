/**
 * Shared Razorpay server helpers.
 *
 * Used by BOTH:
 *   - the Vercel serverless functions in /api (create-order, verify-payment)
 *   - the local Express backend (server.ts)
 *
 * The key secret is only ever read from server-side environment variables and is
 * never referenced from anything under /src, so it can never reach the browser bundle.
 */
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { isSupportedCurrency, MIN_ORDER_AMOUNT } from './shared/currency';

export { MIN_ORDER_AMOUNT };

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

export interface CreateOrderInput {
  /** Amount in the minor unit of the currency (paise, cents, yen). */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Optional supporter name, stored as an order note. */
  supporterName?: string;
  /** Optional supporter message, stored as an order note. */
  supporterMessage?: string;
}

export interface CreatedOrder {
  orderId: string;
  amount: number;
  currency: string;
}

export interface PaymentVerificationInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

/** Reads the Razorpay credentials from the server environment. */
export function getRazorpayCredentials(): RazorpayCredentials {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  return { keyId, keySecret };
}

/** True when both server-side Razorpay credentials are present. */
export function isRazorpayConfigured(): boolean {
  const { keyId, keySecret } = getRazorpayCredentials();
  return Boolean(keyId && keySecret);
}

/** Builds a short, unique receipt id (Razorpay allows up to 40 characters). */
function buildReceipt(): string {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `coffee_${stamp}_${rand}`.slice(0, 40);
}

/**
 * Creates a Razorpay order through the official SDK.
 * Throws an Error carrying a human readable message on validation or upstream failure.
 */
export async function createRazorpayOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const { keyId, keySecret } = getRazorpayCredentials();

  if (!keyId || !keySecret) {
    throw new Error(
      'Razorpay is not configured on the server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
    );
  }

  const amount = Number(input.amount);
  const currency = (input.currency || 'INR').toUpperCase();

  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new Error('Amount must be a positive whole number of minor units (e.g. paise).');
  }

  if (amount < MIN_ORDER_AMOUNT) {
    throw new Error(`Minimum order amount is ${MIN_ORDER_AMOUNT} minor units.`);
  }

  if (!isSupportedCurrency(currency)) {
    throw new Error(`Unsupported currency "${currency}".`);
  }

  const notes: Record<string, string | undefined> = {
    source: 'kathir-audio-studio',
  };
  if (input.supporterName) notes.supporter_name = input.supporterName.slice(0, 100);
  if (input.supporterMessage) notes.supporter_message = input.supporterMessage.slice(0, 200);

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

  try {
    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt: buildReceipt(),
      notes,
      payment_capture: 1,
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    };
  } catch (err: any) {
    const message =
      err?.error?.description ||
      err?.response?.data?.error?.description ||
      err?.message ||
      'Razorpay order creation failed.';
    const status = err?.statusCode || err?.response?.statusCode;
    const wrapped = new Error(message) as Error & { status?: number };
    if (status) wrapped.status = status;
    throw wrapped;
  }
}

/** Constant-time string comparison that never throws on length mismatch. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the Razorpay checkout signature:
 *   HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET) === razorpay_signature
 */
export function verifyRazorpaySignature(input: PaymentVerificationInput): boolean {
  const { keySecret } = getRazorpayCredentials();
  if (!keySecret) return false;

  const { orderId, paymentId, signature } = input;
  if (!orderId || !paymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return safeCompare(expected, signature);
}
