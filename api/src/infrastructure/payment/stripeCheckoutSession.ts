/**
 * ONE hosted-checkout session, described as data.
 *
 * Every flow that sells something — a plan, a marketplace creation, a knowledge
 * listing, a capability pack, a tenant add-on, a Spawn membership, a tenant's own
 * invoice — opens the same Stripe object: a Checkout Session with some line items,
 * a mode, two return URLs and signed metadata. The provider used to write that
 * form body out longhand once per flow (seven copies), and the copies had already
 * drifted: some mirrored the metadata onto the subscription, some onto the payment
 * intent, one mirrored only half of it, and only some sent an idempotency key.
 *
 * So a flow now DESCRIBES its session ({@link HostedCheckoutDescriptor}) and this
 * module is the one place that turns a description into Stripe's form encoding.
 * What a paid session then grants is not here — that is the purchase registry's
 * job (`application/billing/purchaseRegistry.ts`), dispatched by `purchaseKind`.
 */

/** One line on the hosted page. Either a reusable Price or inline price data. */
export interface CheckoutLineItem {
  quantity: number;
  /** A pre-created Stripe Price. When set, the inline fields are ignored. */
  priceId?: string;
  /** Integer minor units — money stays in cents all the way to the processor. */
  unitAmountCents?: number;
  currency?: string;
  name?: string;
  /** Present only on a recurring line; absent = charged once. */
  interval?: 'month' | 'year';
}

export interface HostedCheckoutDescriptor {
  /** `payment` = bought once; `subscription` = billed again every interval. */
  mode: 'payment' | 'subscription';
  lineItems: CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  /**
   * Signed metadata the grant is decided from. Mirrored onto the object that
   * OUTLIVES the session — the subscription (renewal invoices carry no session) or
   * the payment intent (refunds and disputes carry no session) — so whatever
   * arrives later still says what it was for.
   */
  metadata: Record<string, string>;
  /**
   * Session parameters that are not line items or metadata: a discount coupon, a
   * Connect destination. Kept as raw Stripe keys because each is used by exactly
   * one flow, and modelling them would be modelling Stripe rather than our domain.
   */
  extraParams?: Record<string, string>;
  idempotencyKey?: string;
}

/** Stripe caps a product name; a longer one is a 400 rather than a truncation. */
const MAX_PRODUCT_NAME = 250;

/** The form body Stripe's `POST /v1/checkout/sessions` takes for a descriptor. */
export function checkoutSessionParams(descriptor: HostedCheckoutDescriptor): URLSearchParams {
  const params = new URLSearchParams({
    mode: descriptor.mode,
    success_url: descriptor.successUrl,
    cancel_url: descriptor.cancelUrl,
  });
  if (descriptor.customerEmail) params.set('customer_email', descriptor.customerEmail);

  descriptor.lineItems.forEach((line, i) => {
    const at = `line_items[${i}]`;
    params.set(`${at}[quantity]`, String(line.quantity));
    if (line.priceId) {
      params.set(`${at}[price]`, line.priceId);
      return;
    }
    params.set(`${at}[price_data][currency]`, (line.currency ?? '').toLowerCase());
    params.set(`${at}[price_data][unit_amount]`, String(line.unitAmountCents ?? 0));
    if (line.interval) params.set(`${at}[price_data][recurring][interval]`, line.interval);
    params.set(`${at}[price_data][product_data][name]`, (line.name ?? '').slice(0, MAX_PRODUCT_NAME));
  });

  const outlives = descriptor.mode === 'subscription' ? 'subscription_data' : 'payment_intent_data';
  for (const [key, value] of Object.entries(descriptor.metadata)) {
    params.set(`metadata[${key}]`, value);
    params.set(`${outlives}[metadata][${key}]`, value);
  }
  for (const [key, value] of Object.entries(descriptor.extraParams ?? {})) params.set(key, value);
  return params;
}
