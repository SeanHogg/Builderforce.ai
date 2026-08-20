/**
 * HOW A PERSON GETS PAID — the freelancer's half of the payout seam.
 *
 * ── WHY THERE IS NO `withdrawal_methods` TABLE ───────────────────────────────────
 * Because the record already exists. `PayoutAccountService` stores a payout destination
 * as a kernel `connections` row with `capability = 'payout'`, its credential sealed by
 * the same `credentialCrypto` every connection uses, with migration 0459's partial
 * unique indexes enforcing one destination per (user, vendor) and EXACTLY ONE default.
 * That is the withdrawal-method record, complete, and a `withdrawal_methods` table
 * beside it would be a second answer to "where does this person's money go" — with a
 * second copy of the sealed credential, which is the worst possible fact to duplicate.
 *
 * So this module adds the three things that were genuinely missing, and nothing else:
 *
 *   1. **A tenantless door.** `/api/payouts` is behind the TENANT JWT. A for-hire
 *      freelancer holds a web JWT and may belong to no workspace at all, so the entire
 *      payout surface was unreachable for exactly the people it is for. Every function
 *      here resolves the person's own workspace first (`resolveOwnWorkspaceTenantId`),
 *      which is also what the per-tenant credential seal requires.
 *
 *   2. **Verification.** A method is verified or it is not, and nothing recorded which.
 *
 *   3. **Readiness.** "Can this person actually be paid right now, and if not, what is
 *      missing" — one answer, computed once on the server, instead of three surfaces
 *      each assembling it from a list and a boolean.
 *
 * ── VERIFICATION IS DERIVED, NOT STORED ──────────────────────────────────────────
 * A `verified` column would be a fact its own rows could contradict — the same argument
 * `summariseEscrow` makes about stored totals and `SpecField.derive` makes on the
 * canvas. What actually verifies a destination is that MONEY HAS SUCCESSFULLY LEFT
 * THROUGH IT, and the connection already records exactly that: `PayoutAccountService.pay`
 * writes `lastSyncedAt` on success and `lastError` on failure. So:
 *
 *   • `verified`   — a payout has completed through this destination (`lastSyncedAt`).
 *   • `failed`     — the last attempt was refused (`lastError`), which is the state a
 *                    person must be told about, because a silent "unverified" reads as
 *                    "not tried yet" and they will wait forever.
 *   • `unverified` — connected, nothing has moved through it yet.
 *
 * That is honest and it is not the same thing as KYC. A real identity/ownership check —
 * micro-deposits, a Stripe Connect onboarding requirement, a bank-account holder-name
 * match — is a payout PROVIDER's job and needs a configured provider to perform it.
 * With `PAYOUT_WEBHOOK_URL` unset and no connected vendor, there is no counterparty to
 * ask, and inventing a green "Verified" badge out of nothing would be worse than the
 * absence it replaced. `verificationBlocked` says so out loud.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { users } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import {
  PayoutAccountService,
  type PayoutAccountView,
} from '../payouts/PayoutAccountService';
import {
  getPayoutProvider,
  isPayoutProviderName,
  type PayoutCredential,
  type PayoutProviderName,
} from '../payouts/payoutProviders';
import { isPayoutsConfigured, settlementMode, type SettlementMode } from '../integrations/payments';
import { resolveOwnWorkspaceTenantId } from '../tenant/starterWorkspace';

/** Whether money has been proved to move through a destination. See the header. */
export type WithdrawalVerification = 'verified' | 'unverified' | 'failed';

/** A destination as a person sees it. Never a credential — the adapter's masked label
 *  is the only thing derived from the secret that ever leaves the server. */
export interface WithdrawalMethod extends PayoutAccountView {
  verification: WithdrawalVerification;
  /** When money last successfully left through it — the evidence for `verified`. */
  verifiedAtISO: string | null;
  /** Why it is `failed`, taken from the connection's last error. Null otherwise. */
  verificationDetail: string | null;
}

/**
 * The verification of one destination, from what the connection already records.
 *
 * Pure and exported so the rule is asserted in a table test rather than inferred from
 * the two call sites that use it.
 *
 * ORDER MATTERS: a destination that paid out once and then started failing is `failed`,
 * not `verified`. A person whose bank details have gone stale needs to be told the next
 * transfer will not arrive, and a badge that remembers the last success would be a badge
 * that lies about the next attempt.
 */
export function verificationOf(account: PayoutAccountView): {
  verification: WithdrawalVerification;
  verifiedAtISO: string | null;
  verificationDetail: string | null;
} {
  if (account.lastError) {
    return { verification: 'failed', verifiedAtISO: null, verificationDetail: account.lastError };
  }
  if (account.lastPayoutAtISO) {
    return { verification: 'verified', verifiedAtISO: account.lastPayoutAtISO, verificationDetail: null };
  }
  return { verification: 'unverified', verifiedAtISO: null, verificationDetail: null };
}

function decorate(account: PayoutAccountView): WithdrawalMethod {
  return { ...account, ...verificationOf(account) };
}

/**
 * The workspace this person's sealed payout credential lives in.
 *
 * Resolved (and provisioned on first use) from the AUTHENTICATED subject, never taken
 * from the request: the seal is per-tenant, so a caller-supplied workspace would mean a
 * credential written under one key and unreadable under another — and would be an IDOR
 * into somebody else's connections besides.
 *
 * Takes a bare `userId` and reads the row it needs, so no route has to know which user
 * columns the provisioning path wants. A caller that assembled that argument itself
 * would be a second place that knows, and the day the two disagree is the day a
 * workspace is provisioned with a missing name.
 */
export async function withdrawalTenantFor(db: Db, env: Env, userId: string): Promise<number | null> {
  const [user] = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  return resolveOwnWorkspaceTenantId(env, db, { id: userId, email: user.email, displayName: user.displayName });
}

export interface WithdrawalContext {
  tenantId: number;
  userId: string;
}

/** Every destination this person has recorded, default first, each with its verification. */
export async function listWithdrawalMethods(db: Db, env: Env, ctx: WithdrawalContext): Promise<WithdrawalMethod[]> {
  const accounts = await new PayoutAccountService(db, env).list(ctx.tenantId, ctx.userId);
  return accounts.map(decorate);
}

/** Why a connect attempt was refused. A code, so the surface translates it. */
export type WithdrawalRefusal =
  | 'unknown_provider'
  /** The provider is connected through consent, not a form — the caller used the wrong door. */
  | 'wrong_connect_flow'
  | 'missing_field'
  | 'not_saved'
  | 'not_found';

export type WithdrawalResult =
  | { ok: true; method: WithdrawalMethod }
  | { ok: false; reason: WithdrawalRefusal; field?: string };

/**
 * Record a destination whose credential the person TYPES (bank, Wise).
 *
 * Field validation happens here rather than in each adapter so every provider's form
 * fails the same way — the same reason `payoutRoutes` validates before calling. This is
 * a second CALLER of that rule, not a second copy of it: the field DECLARATIONS come
 * from the provider adapter, which stays the one place that knows what a bank account
 * looks like.
 *
 * OAuth-connected providers (Stripe, PayPal) are deliberately not reachable from here:
 * consent is a browser redirect and belongs to `payoutRoutes`' callback, which already
 * owns the signed state. Offering a second entrance to it would be a second place the
 * state could be got wrong.
 */
export async function connectWithdrawalMethod(
  db: Db,
  env: Env,
  ctx: WithdrawalContext,
  input: { provider: string; fields: Record<string, unknown>; makeDefault?: boolean },
): Promise<WithdrawalResult> {
  const provider = isPayoutProviderName(input.provider) ? getPayoutProvider(input.provider) : null;
  if (!provider) return { ok: false, reason: 'unknown_provider' };
  if (provider.connect !== 'fields') return { ok: false, reason: 'wrong_connect_flow' };

  const fields: Record<string, string> = {};
  for (const field of provider.fields ?? []) {
    const raw = input.fields?.[field.key];
    const value = typeof raw === 'string' ? raw.trim().slice(0, 255) : '';
    if (!value && field.required) return { ok: false, reason: 'missing_field', field: field.key };
    if (value) fields[field.key] = value;
  }

  const credential: PayoutCredential = { fields };
  const account = await new PayoutAccountService(db, env).connect({
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    provider: provider.name as PayoutProviderName,
    credential,
    makeDefault: input.makeDefault === true,
  });
  return account ? { ok: true, method: decorate(account) } : { ok: false, reason: 'not_saved' };
}

/** Make one destination the default. Exactly one may be, and the service clears the
 *  others before setting this one — the partial unique index is the backstop. */
export async function setDefaultWithdrawalMethod(
  db: Db,
  env: Env,
  ctx: WithdrawalContext,
  id: number,
): Promise<WithdrawalResult> {
  const account = await new PayoutAccountService(db, env).setDefault(ctx.tenantId, ctx.userId, id);
  return account ? { ok: true, method: decorate(account) } : { ok: false, reason: 'not_found' };
}

/** Remove a destination. Money already sent through it stays in the ledger. */
export async function removeWithdrawalMethod(
  db: Db,
  env: Env,
  ctx: WithdrawalContext,
  id: number,
): Promise<boolean> {
  return new PayoutAccountService(db, env).disconnect(ctx.tenantId, ctx.userId, id);
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** Why a person cannot be paid, in the order the problems have to be fixed. */
export type WithdrawalBlocker =
  /** Nothing recorded at all. */
  | 'no_method'
  /** Destinations exist but none is the default — should be impossible (the service
   *  promotes one on connect and on delete), so it is reported rather than repaired
   *  silently: a state that "cannot happen" and does is worth seeing. */
  | 'no_default'
  /** The default destination's last attempt was refused. */
  | 'default_failed'
  /** No destination is connected AND the deployment has no payout webhook — there is
   *  nowhere for money to go by either route. */
  | 'no_route';

export interface WithdrawalReadiness {
  ready: boolean;
  blockers: WithdrawalBlocker[];
  methodCount: number;
  defaultMethod: WithdrawalMethod | null;
  /**
   * True when identity/ownership verification cannot be performed at all on this
   * deployment, because there is no payout provider to ask. The surface says
   * "transfers settle manually" rather than showing a verification step that can
   * never complete.
   */
  verificationBlocked: boolean;
  /** How a transfer would actually settle today. */
  settlement: SettlementMode;
}

/**
 * CAN THIS PERSON BE PAID?
 *
 * One answer with its reasons, rather than a boolean each surface re-derives. The
 * `manual` settlement is NOT a blocker and must never be treated as one: with no payout
 * provider the ledger is still correct and an operator completes the transfer — the
 * existing seam's whole point, and refusing here would strand every self-hosted install
 * for the same reason `moveMilestone` refuses to.
 */
export async function withdrawalReadiness(db: Db, env: Env, ctx: WithdrawalContext): Promise<WithdrawalReadiness> {
  const methods = await listWithdrawalMethods(db, env, ctx);
  const defaultMethod = methods.find((method) => method.isDefault) ?? null;
  const configured = isPayoutsConfigured(env);

  const blockers: WithdrawalBlocker[] = [];
  if (methods.length === 0) {
    blockers.push('no_method');
    if (!configured) blockers.push('no_route');
  } else if (!defaultMethod) {
    blockers.push('no_default');
  } else if (defaultMethod.verification === 'failed') {
    blockers.push('default_failed');
  }

  return {
    // A deployment with a payout webhook can pay somebody with no connected
    // destination at all — that is what the webhook seam was for before anyone could
    // connect anything — so "ready" is not simply "has a default".
    ready: blockers.filter((blocker) => blocker !== 'no_method').length === 0
      && (methods.length > 0 || configured),
    blockers,
    methodCount: methods.length,
    defaultMethod,
    verificationBlocked: !configured && methods.length === 0,
    settlement: settlementMode(env),
  };
}
