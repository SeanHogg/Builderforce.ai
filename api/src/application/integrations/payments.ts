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

/**
 * HOW A TRANSFER ACTUALLY SETTLES on this deployment.
 *
 * `provider` — a payout backend is wired and money moves through it.
 * `manual`   — no backend: the ledger entry is still written and still correct, and an
 *              operator completes the transfer by hand.
 *
 * Named rather than left as a bare `isPayoutsConfigured` ternary at each call site,
 * because `manual` is a legitimate operating mode and not an error. Every surface that
 * reports settlement has to say the same two words, and the moment two of them spell it
 * differently one of them starts reading like a failure — which is exactly the thing
 * `moveMilestone`'s comment warns about: refusing (or alarming) when payouts are
 * unconfigured would strand every self-hosted install.
 */
export type SettlementMode = 'provider' | 'manual';

export function settlementMode(env: PayoutEnv): SettlementMode {
  return isPayoutsConfigured(env) ? 'provider' : 'manual';
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
