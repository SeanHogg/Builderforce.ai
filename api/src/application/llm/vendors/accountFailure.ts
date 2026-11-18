/**
 * ACCOUNT-level failure within one cascade — when a connected account has said "not me,
 * not now", its other models are not tried again this turn.
 *
 * A connected vendor seeds more than one model (`vendorFlagshipSeeds`: both flagships, or
 * the tenant's ordered selection), so a refused account used to cost one failed attempt —
 * and, on a timeout, one full vendor deadline — PER MODEL, every turn. The refusals that
 * speak for the account rather than the model:
 *   • 401 — the credential is rejected;
 *   • 402 — the account is out of credit;
 *   • 429 — ONLY on a SUBSCRIPTION (`sharesAccountQuota`: a Claude / ChatGPT / SuperGrok /
 *     Kimi Code plan), whose quota every model draws on. An API key's rate limits are PER
 *     MODEL (Anthropic, OpenAI and the rest meter each model separately), so a 429 on Opus
 *     says nothing about Sonnet on the same key — it fails only its model;
 *   • a streak of {@link ACCOUNT_FAULT_STREAK} consecutive timeouts / 5xx on the vendor —
 *     the upstream is not answering this account, whichever model is asked.
 * One timeout or 5xx alone is not account-level (a single model can be slow or down).
 * Neither is a 403: it is as often "this MODEL is not on your plan" (Kimi Code refusing K3
 * on a subscription without it) as a refused account, and skipping the account's other
 * models would lose a working fallback (`kimi-for-coding`) — so a 403 fails only its model.
 *
 * Applies only where the caller says a vendor IS one account (`isAccountScoped` on the
 * dispatch: a tenant's own connected provider). A shared operator vendor serves many
 * models on independent per-model limits, and an OpenRouter connection carries its own key
 * per model — neither is skipped wholesale. Pure state, one tracker per cascade.
 */

import type { DispatchAttempt } from './registry';
import type { VendorId } from './types';

/** Consecutive timeouts / 5xx on one vendor that mark its account as not answering. */
export const ACCOUNT_FAULT_STREAK = 2;

/** What the caller (the proxy, which knows which vendors ride the tenant's credential and
 *  how) tells a dispatch about its accounts. Both absent = every model is tried. */
export interface AccountScopeParams {
  /** Is this vendor ONE ACCOUNT for this dispatch (a tenant's own connected provider)? When
   *  it is, an account-level failure on it skips its remaining models for the cascade. */
  isAccountScoped?: (vendor: VendorId, model: string) => boolean;
  /** Does every model on this vendor draw on ONE quota this dispatch (a subscription)? Only
   *  then is a 429 account-level. Absent = no: a key's limits are per model. */
  sharesAccountQuota?: (vendor: VendorId) => boolean;
}

/**
 * A status that refuses the ACCOUNT, not the model: 401 and 402 always; 429 only when the
 * account's quota is shared by its models (a subscription). 403 is model-level — see above.
 * Pure.
 */
export function isAccountRefusalStatus(status: number, sharedQuota = false): boolean {
  return status === 401 || status === 402 || (status === 429 && sharedQuota);
}

/** A timeout or upstream 5xx — counts toward the vendor's streak. Pure. */
function isUpstreamFault(attempt: Pick<DispatchAttempt, 'status' | 'kind'>): boolean {
  return attempt.kind === 'timeout' || attempt.kind === 'server_error' || attempt.status >= 500;
}

export interface AccountFailureTracker {
  /** Record a failed attempt; true when its vendor's account is now failed for this turn. */
  record(attempt: Pick<DispatchAttempt, 'vendor' | 'status' | 'kind'>): boolean;
  /** Has this vendor's account failed earlier in this turn? */
  failed(vendor: string): boolean;
}

/** `sharesAccountQuota` decides whether a 429 on a vendor is account-level (see above). */
export function createAccountFailureTracker(sharesAccountQuota: (vendor: VendorId) => boolean = () => false): AccountFailureTracker {
  const failedVendors = new Set<string>();
  const faultStreak = new Map<string, number>();
  return {
    record(attempt) {
      if (isAccountRefusalStatus(attempt.status, sharesAccountQuota(attempt.vendor as VendorId))) {
        failedVendors.add(attempt.vendor);
      } else if (isUpstreamFault(attempt)) {
        const streak = (faultStreak.get(attempt.vendor) ?? 0) + 1;
        faultStreak.set(attempt.vendor, streak);
        if (streak >= ACCOUNT_FAULT_STREAK) failedVendors.add(attempt.vendor);
      } else {
        // Any other failure (a request error, a schema refusal, a per-model 429) breaks
        // the streak: the account answered.
        faultStreak.delete(attempt.vendor);
      }
      return failedVendors.has(attempt.vendor);
    },
    failed: (vendor) => failedVendors.has(vendor),
  };
}

/** One cascade's account bookkeeping, as the dispatch loop uses it. */
export interface CascadeAccounts {
  /** Push a failed attempt onto the cascade's `attempts` and record it against its account. */
  recordFailed(attempt: DispatchAttempt): void;
  /** True — and the candidate is noted in {@link skipped} — when its account already
   *  refused earlier in this cascade: its next model would be refused the same way, so it
   *  is skipped rather than spending an attempt. */
  skips(vendor: VendorId, model: string): boolean;
  /** `vendor:model` of every candidate skipped this way, for `CascadeExhaustedError`. */
  readonly skipped: string[];
}

/** The account bookkeeping for one cascade over `attempts`. With no `isAccountScoped`,
 *  nothing is ever skipped (attempts are still pushed). */
export function createCascadeAccounts(attempts: DispatchAttempt[], scope: AccountScopeParams): CascadeAccounts {
  const { isAccountScoped, sharesAccountQuota } = scope;
  const tracker = isAccountScoped ? createAccountFailureTracker(sharesAccountQuota) : null;
  const skipped: string[] = [];
  return {
    recordFailed(attempt) {
      attempts.push(attempt);
      tracker?.record(attempt);
    },
    skips(vendor, model) {
      if (!tracker?.failed(vendor) || !isAccountScoped?.(vendor, model)) return false;
      skipped.push(`${vendor}:${model}`);
      return true;
    },
    skipped,
  };
}
