/**
 * Minimal typings for the `razorpay` SDK, which ships without TypeScript definitions.
 */
declare module 'razorpay' {
  export interface RazorpayOrderResponse {
    id: string;
    entity: string;
    amount: number;
    currency: string;
    receipt?: string;
    status?: string;
    notes?: Record<string, string | undefined>;
    [key: string]: unknown;
  }

  export interface RazorpayOrderCreateParams {
    amount: number;
    currency: string;
    receipt?: string;
    notes?: Record<string, string | undefined>;
    payment_capture?: number;
    [key: string]: unknown;
  }

  export interface RazorpayPaymentResponse {
    id: string;
    entity: string;
    amount: number;
    currency: string;
    status?: string;
    [key: string]: unknown;
  }

  export default class Razorpay {
    constructor(options: { key_id: string; key_secret: string; app_id?: string });

    orders: {
      create(params: RazorpayOrderCreateParams): Promise<RazorpayOrderResponse>;
      fetch(orderId: string): Promise<RazorpayOrderResponse>;
      all(params?: Record<string, unknown>): Promise<{ items: RazorpayOrderResponse[] }>;
    };

    payments: {
      fetch(paymentId: string): Promise<RazorpayPaymentResponse>;
      all(params?: Record<string, unknown>): Promise<{ items: RazorpayPaymentResponse[] }>;
    };
  }
}
