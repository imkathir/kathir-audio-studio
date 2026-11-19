/**
 * Client-side Razorpay Standard Checkout helpers.
 *
 * Only the PUBLIC key id is used here - the key secret lives exclusively on the server.
 */
import { formatAmount, getCurrency, SUPPORTED_CURRENCIES, toMinorUnits } from '../../shared/currency';

export { SUPPORTED_CURRENCIES, formatAmount, getCurrency, toMinorUnits };

/** Public Razorpay key id, injected at build time by Vite (VITE_RAZORPAY_KEY_ID). */
export const RAZORPAY_KEY_ID: string = (import.meta.env.VITE_RAZORPAY_KEY_ID || '').trim();

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise: Promise<boolean> | null = null;

export interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  image?: string;
  prefill?: Record<string, string>;
  notes?: Record<string, string | undefined>;
  theme?: Record<string, string>;
  handler: (response: RazorpayCheckoutResponse) => void;
  modal?: Record<string, unknown>;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void; close: () => void };
  }
}

/** True when the public key id is configured (the checkout script may still be loading). */
export function isRazorpayConfigured(): boolean {
  return Boolean(RAZORPAY_KEY_ID);
}

/** True when the app is running against Razorpay test credentials. */
export function isRazorpayTestMode(): boolean {
  return RAZORPAY_KEY_ID.startsWith('rzp_test');
}

/**
 * Loads checkout.razorpay.com once and resolves with the availability of window.Razorpay.
 * The script is also declared statically in index.html; this is the lazy fallback.
 */
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT_SRC}"]`
    );

    if (existing) {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/** Reads the active accent colour so the Razorpay popup matches the current theme. */
export function getAccentColor(): string {
  if (typeof window === 'undefined') return '#6366f1';
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-primary')
    .trim();
  return value || '#6366f1';
}

/**
 * Resolves the base URL for backend calls.
 * Uses a custom backend when configured, otherwise falls back to same-origin
 * (Vercel serverless functions in /api, or the local Express backend).
 */
export function getApiBase(): string {
  if (typeof window === 'undefined') return '';
  const customBackend = localStorage.getItem('kathir_tts_backend_url') || '';
  return customBackend ? customBackend.replace(/\/+$/, '') : '';
}
