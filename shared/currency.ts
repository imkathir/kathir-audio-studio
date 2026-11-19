/**
 * Currency table shared by the browser (checkout UI) and the server (order validation).
 *
 * Razorpay settles international payments in INR, but a supporter can pay in their
 * own currency when the Razorpay account has international transactions enabled.
 * Every currency is stored with its minor-unit exponent so the amount can be sent
 * to Razorpay in the smallest unit (paise/cents/yen) exactly as the API expects.
 */

export interface CurrencyInfo {
  /** ISO 4217 code sent to Razorpay when creating the order. */
  code: string;
  /** Display symbol shown next to the amount input. */
  symbol: string;
  /** Human readable name for the currency dropdown. */
  name: string;
  /** Number of minor-unit digits: 2 for paise/cents, 0 for yen. */
  exponent: number;
  /** Quick-pick amounts offered above the amount field, in major units. */
  presets: number[];
}

export const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', exponent: 2, presets: [50, 100, 500] },
  { code: 'USD', symbol: '$', name: 'US Dollar', exponent: 2, presets: [5, 10, 25] },
  { code: 'EUR', symbol: '€', name: 'Euro', exponent: 2, presets: [5, 10, 25] },
  { code: 'GBP', symbol: '£', name: 'British Pound', exponent: 2, presets: [3, 5, 10] },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', exponent: 2, presets: [8, 15, 30] },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', exponent: 2, presets: [7, 12, 25] },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', exponent: 2, presets: [6, 10, 25] },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham', exponent: 2, presets: [20, 40, 100] },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', exponent: 0, presets: [500, 1000, 3000] },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', exponent: 2, presets: [50, 100, 250] },
];

export const DEFAULT_CURRENCY = 'INR';

/** Smallest chargeable amount in minor units (100 paise = ₹1). */
export const MIN_ORDER_AMOUNT = 100;

export function getCurrency(code: string): CurrencyInfo {
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === code.toUpperCase());
  return found || SUPPORTED_CURRENCIES[0];
}

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.some((c) => c.code === code.toUpperCase());
}

/** Converts a major-unit amount (e.g. 10.5 USD) into minor units (1050 cents). */
export function toMinorUnits(majorAmount: number, code: string): number {
  const { exponent } = getCurrency(code);
  return Math.round(majorAmount * Math.pow(10, exponent));
}

/** Converts minor units (1050 cents) back into major units (10.5). */
export function fromMinorUnits(minorAmount: number, code: string): number {
  const { exponent } = getCurrency(code);
  return minorAmount / Math.pow(10, exponent);
}

/** Formats a major-unit amount with its currency symbol, e.g. "₹100.00". */
export function formatAmount(majorAmount: number, code: string): string {
  const { symbol, exponent } = getCurrency(code);
  return `${symbol}${majorAmount.toFixed(exponent)}`;
}
