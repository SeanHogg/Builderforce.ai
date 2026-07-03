/**
 * Freelancer payout provider seam.
 *
 * Env-gated on `PAYOUT_WEBHOOK_URL`: when configured, `createPayout` POSTs the
 * invoice to the partner payout endpoint and returns its reference. When
 * unconfigured, callers fall back to a manual "Mark paid" (no money movement) —
 * the invoice/payment records still work, they just aren't settled by a provider.
 * A thin webhook seam (not a hard Stripe dependency) keeps the Worker bundle lean
 * and lets any payout backend be wired without a code change.
 */
import type { Env } from '../../env';

type PayoutEnv = Pick<Env, 'PAYOUT_WEBHOOK_URL' | 'PAYOUT_WEBHOOK_KEY'>;

export function isPayoutsConfigured(env: PayoutEnv): boolean {
  return typeof env.PAYOUT_WEBHOOK_URL === 'string' && env.PAYOUT_WEBHOOK_URL.length > 0;
}

export interface PayoutInput {
  invoiceId: string;
  amountCents: number;
  currency: string;
  freelancerUserId: string;
  tenantId: number;
}

/** Settle an invoice via the configured payout provider. Never throws — a failure
 *  returns `{ ok:false }` so the employer can retry or fall back to manual. */
export async function createPayout(env: PayoutEnv, input: PayoutInput): Promise<{ configured: boolean; ok: boolean; externalRef?: string; error?: string }> {
  if (!isPayoutsConfigured(env)) return { configured: false, ok: false };
  try {
    const res = await fetch(env.PAYOUT_WEBHOOK_URL as string, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.PAYOUT_WEBHOOK_KEY ? { authorization: `Bearer ${env.PAYOUT_WEBHOOK_KEY}` } : {}) },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { configured: true, ok: false, error: `payout provider HTTP ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { reference?: string; id?: string };
    return { configured: true, ok: true, externalRef: body.reference ?? body.id };
  } catch (err) {
    return { configured: true, ok: false, error: (err as Error)?.message };
  }
}
