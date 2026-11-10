/**
 * Stripe → `purchase.reversed`: money went back to the buyer of a pay-once purchase.
 *
 * One concern, out of StripeProvider's webhook switch: recognising a FULL refund or a
 * LOST dispute, reading the purchase's signed metadata back off the payment intent
 * (the charge and dispute carry no session), and translating it into the provider-
 * neutral reversal event. A charge that is not ours (no `purchaseKind`) is
 * acknowledged and ignored.
 *
 * Disputes reverse on exactly ONE event, `charge.dispute.closed` with status `lost`:
 * `created` only opens a dispute the merchant may still win (so reversing there would
 * have to be un-done), and `funds_withdrawn` also fires for disputes later won back
 * (`funds_reinstated`). A won dispute therefore needs no restore at all.
 */
import type { WebhookEvent } from './PaymentProvider';
import { WebhookUpstreamError } from './PaymentProvider';

/** The parsed webhook envelope, as StripeProvider.parseWebhook reads it. */
export interface StripeWebhookEnvelope {
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * The `purchase.reversed` event for a full refund / lost dispute on one of our
 * pay-once purchases, or null when the event is not a reversal of ours (partial
 * refund, dispute not lost, no payment intent, foreign charge).
 * Throws {@link WebhookUpstreamError} when the intent lookup fails, so Stripe redelivers.
 */
export async function stripePurchaseReversal(
  event: StripeWebhookEnvelope,
  secretKey: string,
): Promise<WebhookEvent | null> {
  const obj = event.data.object;
  if (event.type === 'charge.refunded' && obj['refunded'] !== true) return null; // partial refund
  if (event.type === 'charge.dispute.closed' && obj['status'] !== 'lost') return null;
  const intentId = obj['payment_intent'];
  if (typeof intentId !== 'string' || !intentId) return null;
  const meta = await fetchPaymentIntentMetadata(secretKey, intentId);
  const kind = meta?.['purchaseKind'];
  if (!meta || !kind) return null;
  const rawTenantId = Number(meta['buyerTenantId'] ?? meta['tenantId']);
  return {
    type: 'purchase.reversed',
    purchaseKind: kind,
    metadata: meta,
    ...(Number.isInteger(rawTenantId) && rawTenantId > 0 ? { tenantId: rawTenantId } : {}),
    externalCustomerId: typeof obj['customer'] === 'string' ? obj['customer'] : '',
    externalSubscriptionId: '',
    raw: event,
  };
}

/** The signed metadata stamped on a payment intent at checkout, or null when unreadable. */
async function fetchPaymentIntentMetadata(secretKey: string, intentId: string): Promise<Record<string, string> | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intentId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  } catch (cause) {
    throw new WebhookUpstreamError('Stripe payment_intent lookup failed (network)', { cause });
  }
  if (res.status === 404) return null; // not an intent of ours
  // Any other failure THROWS (a distinct type, so the route answers 500, not "Invalid signature")
  // and Stripe redelivers: a reversal swallowed here would leave a refunded purchase usable.
  if (!res.ok) throw new WebhookUpstreamError(`Stripe payment_intent lookup failed: ${res.status}`);
  const body = await res.json() as { metadata?: Record<string, string> };
  return body.metadata ?? null;
}
