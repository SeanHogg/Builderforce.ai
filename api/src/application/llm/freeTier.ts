/**
 * The FREE tier, as the cost rules see it: FREE-tier models plus the vendor whose daily
 * allowance makes its paid models free up to a limit (`PAID_LEAD_VENDOR`, Cloudflare
 * Workers AI). "Free" here means free to the OPERATOR — a model the tenant serves from
 * their own connected account (`isOwnerServed`) is neither free tier nor a twin, because
 * the tenant pays for it and has already said where it ranks. Two rules read it:
 *
 *   - `orderFreeFirst` — the seed order for a free-first turn (`fundingOrder.ts`): the
 *     free tier, then the tenant's connected accounts, then the rest of the plan pool.
 *   - `preferFreeTwins` — operator rule (2026-10-20): when a paid model and a free model
 *     are the SAME model (`VendorModelEntry.weights`), the free one is tried first. It is
 *     applied to the SEED, before the free-capped cascade, so a FREE twin counts against
 *     the free budget like any other FREE model; the paid one stays behind it as the
 *     fallback, so an unbound, cooled or capped-out twin costs one skipped attempt rather
 *     than the model. A PINNED head is not displaced: the cascade places the head first
 *     verbatim, so a pin with a free twin still leads, and its twin — inserted ahead of it
 *     in the seed — lands in the free slice right after the head, taking one free slot
 *     (it is capped out like any FREE model once the budget is spent).
 *
 * Neither rule applies to the strict BYO pool (`buildCandidateChain` hands it the seed
 * untouched) nor to the tenant's own connected models (`isOwnerServed`).
 */

import { PAID_LEAD_VENDOR } from './modelPool';
import { capableTwinsOf, tierForModel, vendorForModel } from './vendors';

/** 0 = FREE tier, 1 = the free-allowance vendor, 2 = metered. */
export function costRank(model: string): 0 | 1 | 2 {
  if (tierForModel(model) === 'FREE') return 0;
  return vendorForModel(model) === PAID_LEAD_VENDOR ? 1 : 2;
}

export function isFreeTierModel(model: string): boolean {
  return costRank(model) < 2;
}

/**
 * True when the tenant serves this model from their own connected account. REQUIRED on
 * every rule below: a caller that forgot it would quietly treat the tenant's own account
 * as the operator's free tier (capped, twinned). A caller with no tenant passes `() => false`.
 */
export type OwnerServedPredicate = (model: string) => boolean;

/**
 * Seed for a free-first turn: `head` (an honoured caller pin) leads, then every free-tier
 * model of the pool the operator funds, then the connected-account seeds, then the rest of
 * the pool (owner-served pool models included). Order within each group is preserved;
 * nothing is dropped and nothing repeats.
 */
export function orderFreeFirst(
  head: readonly string[],
  pool: readonly string[],
  connected: readonly string[],
  isOwnerServed: OwnerServedPredicate,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (m: string) => {
    if (seen.has(m)) return;
    seen.add(m);
    out.push(m);
  };
  head.forEach(add);
  pool.filter((m) => isFreeTierModel(m) && !isOwnerServed(m)).forEach(add);
  connected.forEach(add);
  pool.forEach(add);
  return out;
}

/**
 * The capable twins of `model` that are strictly cheaper than it, cheapest first. Empty
 * for an owner-served model, and no owner-served model is ever offered as a twin. The
 * ONE lookup both `preferFreeTwins` and the cooldown prefetch (`loadSeedCooldowns`) use.
 * The prefetch asks it for EVERY seed entry — not only the leading
 * `COOLDOWN_PREFETCH_LIMIT` slice it reads the seed's own models for — because
 * `preferFreeTwins` expands the whole seed; so every twin the chain may insert has had
 * its cooldown read.
 */
export function cheaperTwinsOf(model: string, isOwnerServed: OwnerServedPredicate): string[] {
  const rank = costRank(model);
  if (rank === 0 || isOwnerServed(model)) return [];
  return capableTwinsOf(model)
    .filter((t) => costRank(t) < rank && !isOwnerServed(t))
    .sort((a, b) => costRank(a) - costRank(b));
}

/**
 * Put the cheapest available capable twin of each model directly ahead of it. A twin
 * already earlier in the chain is left where it is; `isUnavailable` (cooldowns) keeps a
 * known-failing twin out. Only a twin that is strictly cheaper moves, and owner-served
 * models are left alone in both directions (see `cheaperTwinsOf`). Pure.
 */
export function preferFreeTwins(
  chain: readonly string[],
  isUnavailable: (model: string) => boolean,
  isOwnerServed: OwnerServedPredicate,
): string[] {
  const out: string[] = [];
  const placed = new Set<string>();
  for (const model of chain) {
    if (placed.has(model)) continue;
    const twin = cheaperTwinsOf(model, isOwnerServed).find((t) => !isUnavailable(t));
    if (twin && !placed.has(twin)) {
      out.push(twin);
      placed.add(twin);
    }
    out.push(model);
    placed.add(model);
  }
  return out;
}
