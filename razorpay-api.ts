/**
 * Shared Razorpay server helpers.
 *
 * Used by BOTH:
 *   - the Vercel serverless functions in /api (create-order, verify-payment)
 *   - the local Express backend (server.ts)
 *
 * The key secret is only ever read from server-side environment variables and is
 * never referenced from anything under /src, so it can never reach the browser bundle.
 *
 * Order creation uses the official `razorpay` SDK when it can be loaded, and falls
 * back to a plain REST call against https://api.razorpay.com/v1/orders otherwise.
 * The fallback matters on Vercel: the SDK is CommonJS and its axios dependency calls
 * `require('util')`, which throws "Dynamic require of 'util' is not supported" when the
 * serverless function is bundled as ESM.
 */
import crypto from 'crypto';
import { isSupportedCurrency, MIN_ORDER_AMOUNT } from './shared/currency';

export { MIN_ORDER_AMOUNT };

const RAZORPAY_ORDERS_API = 'https://api.razorpay.com/v1/orders';

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
 * Loads the CommonJS `razorpay` SDK lazily.
 * Returns null when the SDK cannot be evaluated in the current runtime/bundler.
 */
async function loadRazorpaySdk(): Promise<any | null> {
  try {
    const mod: any = await import('razorpay');
    const Razorpay = mod?.default ?? mod;
    return typeof Razorpay === 'function' ? Razorpay : null;
  } catch (err: any) {
    console.warn('[razorpay] SDK unavailable, using the REST fallback:', err?.message);
    return null;
  }
}

/** Creates the order through the Razorpay REST API. */
async function createOrderViaRest(
  keyId: string,
  keySecret: string,
  payload: Record<string, unknown>
): Promise<CreatedOrder> {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const response = await fetch(RAZORPAY_ORDERS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  const data: any = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data?.error?.description ||
        data?.message ||
        `Razorpay order creation failed (HTTP ${response.status}).`
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  if (!data?.id) {
    throw new Error('Razorpay did not return an order id.');
  }

  return { orderId: data.id, amount: data.amount, currency: data.currency };
}

/**
 * Creates a Razorpay order.
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

  const payload = {
    amount,
    currency,
    receipt: buildReceipt(),
    notes,
    payment_capture: 1,
  };

  // 1) Preferred path: the official SDK.
  try {
    const Razorpay = await loadRazorpaySdk();
    if (Razorpay) {
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const order = await razorpay.orders.create(payload);
      return { orderId: order.id, amount: order.amount, currency: order.currency };
    }
  } catch (err: any) {
    console.warn('[razorpay] SDK order creation failed, using the REST fallback:', err?.message);
  }

  // 2) Fallback path: the Razorpay REST API.
  return createOrderViaRest(keyId, keySecret, payload);
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
