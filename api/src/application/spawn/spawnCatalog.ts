/**
 * SPAWN'S PRICE LIST — what a membership costs and what each token pack buys.
 *
 * Spawn (`spawn.builderforce.ai`) is the Roblox game builder for players 13 and up.
 * A membership is $1.99 a month and opens the builder; the building itself is paid
 * from a prepaid token wallet topped up in four fixed packs. Packs, not an amount
 * field, for the reason `commsTopUp.ts` gives: a free-text amount is a price the
 * buyer sets, and fixed packs make `assertCovers` a real check.
 *
 * A token here is a model token, one for one: a build that read 9,000 tokens and
 * wrote 3,000 spends 12,000. Larger packs carry more tokens per dollar, and the
 * per-pack number is the one the buyer is shown, so there is no hidden rate.
 */
import { PLAN_LIMITS } from '../../domain/tenant/PlanLimits';
import { TenantPlan } from '../../domain/shared/types';

export const SPAWN_PLAN = {
  /** US cents charged each month. */
  monthlyCents: 199,
  currency: 'USD',
} as const;

/** Roblox's own minimum for an account that chats; Spawn keeps the same line, and
 *  it is the COPPA line — nobody younger may hold an account that stores their work. */
export const SPAWN_MIN_AGE = 13;

export interface SpawnTokenPack {
  id: string;
  /** US cents charged. */
  cents: number;
  /** Spawn tokens granted. */
  tokens: number;
}

export const SPAWN_TOKEN_PACKS: readonly SpawnTokenPack[] = [
  { id: 'spawn-10', cents: 1000, tokens: 1_000_000 },
  { id: 'spawn-20', cents: 2000, tokens: 2_100_000 },
  { id: 'spawn-50', cents: 5000, tokens: 5_500_000 },
  { id: 'spawn-100', cents: 10000, tokens: 12_000_000 },
];

export function spawnTokenPack(id: string): SpawnTokenPack | null {
  return SPAWN_TOKEN_PACKS.find((pack) => pack.id === id) ?? null;
}

/** What a typical build spends — shown as "about N builds" next to a pack, never charged. */
export const TYPICAL_BUILD_TOKENS = 12_000;

/**
 * The least a wallet must hold to start a build. A build's cost is only known once
 * the model has answered, so this is the floor below which a build would very likely
 * overdraw rather than a price.
 */
export const MIN_BUILD_TOKENS = 4_000;

/**
 * The free trial: one per person, no card. SEVEN days — the 2025 paywall benchmarks
 * (Superwall/RevenueCat/Adapty) put 7-day trials at the top (5.2% vs 3.1% for 3-day),
 * 84% of 3-day cancellations land on day 0–1, and Spawn's buyer is a parent the
 * player has to reach: a week always contains a weekend.
 */
export const SPAWN_TRIAL_DAYS = 7;

/** The trial's tokens are exactly Builderforce's free-plan monthly allowance, read from
 *  the plan table so the two can never disagree. */
export const SPAWN_TRIAL_TOKENS = PLAN_LIMITS[TenantPlan.FREE].tokenMonthlyLimit;
