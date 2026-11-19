import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Coffee,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import {
  formatAmount,
  getAccentColor,
  getApiBase,
  getCurrency,
  isRazorpayConfigured,
  isRazorpayTestMode,
  loadRazorpayScript,
  RAZORPAY_KEY_ID,
  SUPPORTED_CURRENCIES,
  toMinorUnits,
  RazorpayCheckoutResponse,
} from '../utils/razorpay';
import { MIN_ORDER_AMOUNT } from '../../shared/currency';

interface SupportSectionProps {
  sectionRef?: (el: HTMLDivElement | null) => void;
}

type SupportState = 'idle' | 'creating' | 'verifying' | 'success' | 'error';

const inputClass =
  'w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/70 outline-none transition-colors focus:border-[var(--accent-primary)]';

const labelClass =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]';

export const SupportSection: React.FC<SupportSectionProps> = ({ sectionRef }) => {
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [amount, setAmount] = useState('100');
  const [supporterName, setSupporterName] = useState('');
  const [supporterMessage, setSupporterMessage] = useState('');
  const [state, setState] = useState<SupportState>('idle');
  const [error, setError] = useState<string>('');
  const [paymentId, setPaymentId] = useState<string>('');

  const currency = getCurrency(currencyCode);
  const numericAmount = Number.parseFloat(amount);
  const amountIsValid = Number.isFinite(numericAmount) && numericAmount > 0;
  const minimumMajor = MIN_ORDER_AMOUNT / Math.pow(10, currency.exponent);
  const configured = isRazorpayConfigured();
  const busy = state === 'creating' || state === 'verifying';

  const applyCurrency = (code: string) => {
    setCurrencyCode(code);
    const next = getCurrency(code);
    setAmount(String(next.presets[1]));
    setError('');
  };

  const resetForm = () => {
    setState('idle');
    setError('');
    setPaymentId('');
    setSupporterMessage('');
  };

  const verifyPayment = async (
    response: RazorpayCheckoutResponse,
    base: string
  ) => {
    setState('verifying');
    try {
      const res = await fetch(`${base}/api/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Payment verification failed (HTTP ${res.status}).`);
      }

      setPaymentId(response.razorpay_payment_id);
      setState('success');
    } catch (err: any) {
      setError(err?.message || 'Payment verification failed.');
      setState('error');
    }
  };

  const handleDonate = async () => {
    setError('');

    if (!configured) {
      setError('Razorpay is not configured yet. Add VITE_RAZORPAY_KEY_ID and restart the build.');
      setState('error');
      return;
    }

    if (!amountIsValid) {
      setError('Please enter a valid amount.');
      setState('error');
      return;
    }

    const amountInMinorUnits = toMinorUnits(numericAmount, currency.code);
    if (amountInMinorUnits < MIN_ORDER_AMOUNT) {
      setError(`The minimum amount is ${formatAmount(minimumMajor, currency.code)}.`);
      setState('error');
      return;
    }

    const base = getApiBase();
    setState('creating');

    try {
      // 1) Create the order on the server (the key secret never reaches the browser).
      const orderRes = await fetch(`${base}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountInMinorUnits,
          currency: currency.code,
          name: supporterName.trim() || undefined,
          message: supporterMessage.trim() || undefined,
        }),
      });

      const orderData = await orderRes.json().catch(() => ({}));
      if (!orderRes.ok || !orderData.order_id) {
        throw new Error(orderData.error || `Could not create the order (HTTP ${orderRes.status}).`);
      }

      // 2) Make sure the Razorpay checkout script is available.
      const scriptReady = await loadRazorpayScript();
      if (!scriptReady || !window.Razorpay) {
        throw new Error('Could not load the Razorpay checkout script. Check your connection and retry.');
      }

      setState('idle');

      // 3) Open the Razorpay Standard Checkout modal.
      const razorpay = new window.Razorpay({
        key: RAZORPAY_KEY_ID,
        amount: amountInMinorUnits,
        currency: currency.code,
        order_id: orderData.order_id,
        name: 'kathirStudio',
        description: `Support kathirStudio - ${formatAmount(numericAmount, currency.code)}`,
        image: '/favicon.svg',
        prefill: supporterName.trim() ? { name: supporterName.trim() } : undefined,
        notes: {
          source: 'kathir-audio-studio',
        },
        theme: { color: getAccentColor() },
        handler: (response: RazorpayCheckoutResponse) => {
          void verifyPayment(response, base);
        },
        modal: {
          ondismiss: () => setState((prev) => (prev === 'verifying' ? prev : 'idle')),
        },
      });

      razorpay.open();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong while starting the payment.');
      setState('error');
    }
  };

  return (
    <section
      ref={sectionRef}
      id="support"
      className="scroll-mt-24 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-6 sm:p-8 shadow-sm transition-colors"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left: pitch */}
        <div className="lg:w-[38%]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--accent-primary)]">
            <Coffee className="h-4 w-4" />
            <span>Support the project</span>
          </div>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">
            Buy me a coffee
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
            kathirStudio stays <strong className="text-[var(--text-primary)]">100% free</strong> for
            everyone - no limits, no sign-up, no subscription. If it saved you time, you can buy
            me a coffee to keep the servers and models running.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-main)] px-2.5 py-1">
              <Lock className="h-3 w-3" /> Secured by Razorpay
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-main)] px-2.5 py-1">
              <ShieldCheck className="h-3 w-3" /> Signature verified on the server
            </span>
            {isRazorpayTestMode() && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-400">
                Test mode
              </span>
            )}
          </div>
        </div>

        {/* Right: the payment form */}
        <div className="flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)] p-5">
          {state === 'success' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Thank you so much! ☕</h3>
              <p className="max-w-sm text-sm text-[var(--text-muted)]">
                Your {formatAmount(numericAmount, currency.code)} payment went through and the
                signature was verified. That really means a lot.
              </p>
              {paymentId && (
                <code className="rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)]">
                  {paymentId}
                </code>
              )}
              <button
                type="button"
                onClick={resetForm}
                className="mt-1 rounded-lg border border-[var(--border-color)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-subtle)]"
              >
                Send another coffee
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[150px_1fr]">
                <div>
                  <label htmlFor="coffee-currency" className={labelClass}>
                    Currency
                  </label>
                  <select
                    id="coffee-currency"
                    value={currencyCode}
                    onChange={(e) => applyCurrency(e.target.value)}
                    className={`${inputClass} cursor-pointer`}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.symbol} {c.code} - {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="coffee-amount" className={labelClass}>
                    Amount
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--text-muted)]">
                      {currency.symbol}
                    </span>
                    <input
                      id="coffee-amount"
                      type="number"
                      inputMode="decimal"
                      min={minimumMajor}
                      step="1"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        if (state === 'error') setState('idle');
                      }}
                      placeholder="100"
                      className={`${inputClass} pl-9 pr-24 font-semibold`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-[var(--text-muted)]">
                      {currency.code}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick amount presets */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-[var(--text-muted)]">Quick pick:</span>
                {currency.presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setAmount(String(preset));
                      if (state === 'error') setState('idle');
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      Number(amount) === preset
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)] text-[var(--accent-primary)]'
                        : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {formatAmount(preset, currency.code)}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="coffee-name" className={labelClass}>
                    Your name (optional)
                  </label>
                  <input
                    id="coffee-name"
                    type="text"
                    maxLength={60}
                    value={supporterName}
                    onChange={(e) => setSupporterName(e.target.value)}
                    placeholder="Ada"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="coffee-message" className={labelClass}>
                    Message (optional)
                  </label>
                  <input
                    id="coffee-message"
                    type="text"
                    maxLength={140}
                    value={supporterMessage}
                    onChange={(e) => setSupporterMessage(e.target.value)}
                    placeholder="Thanks for the tool!"
                    className={inputClass}
                  />
                </div>
              </div>

              {state === 'error' && error && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleDonate}
                disabled={busy || !configured}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-gradient)] px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 shadow-sm shadow-[var(--accent-primary)]/25"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{state === 'creating' ? 'Creating order...' : 'Verifying payment...'}</span>
                  </>
                ) : (
                  <>
                    <Coffee className="h-4 w-4" />
                    <span>
                      Send me a coffee
                      {amountIsValid
                        ? ` - ${formatAmount(numericAmount, currency.code)}`
                        : ''}
                    </span>
                  </>
                )}
              </button>

              <p className="text-center text-[11px] text-[var(--text-muted)]">
                Minimum {formatAmount(minimumMajor, currency.code)} - settle in your own currency,
                received in INR.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
