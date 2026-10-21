/**
 * THE rule for which cloud funds an unpinned turn: the free tier first, or the
 * tenant's connected accounts (BYO) first.
 *
 * Operator decision (2026-10-20): the free Cloudflare tier leads by default; a person
 * can state a preference on their account (`cloudOrder`, vocabulary in
 * `@builderforce/model-catalog`), and when they have not, the preference is INFERRED from
 * whether any BYO provider is connected — a workspace that connected an account has said
 * "use my account first".
 *
 * "First" is ORDER, not a boundary: connected-accounts-first puts the tenant's accounts
 * at the head of the chain and the plan pool behind them, so a failing key falls back to
 * the pool instead of ending the turn. The strict BYO execution boundary (operator-funded
 * models leave the chain) is only for a turn that explicitly picked the BYO pool
 * (`requested: 'byo_pool'`) and for the server-side agent callers that have always run
 * strict — they say so with {@link strictWhenConnected}.
 *
 * Precedence: an explicit per-request `routingMode` → the account preference → the
 * inference. One function so the completions route and every proxy resolve it
 * identically; the returned object holds only the TRUE flags so a caller spreads it
 * straight into the proxy options.
 */

import type { CloudOrder } from '@builderforce/model-catalog';

/** The per-request `routingMode` a client may send. */
export type RequestedRoutingMode = 'auto' | 'byo_pool';

export interface FundingOrderInput {
  /** The turn's explicit choice, when the client sent one. */
  requested?: RequestedRoutingMode;
  /** The person's account preference; absent for callers with no person (agent runs). */
  preference?: CloudOrder;
  /** At least one BYO provider is configured for the tenant. */
  byoConfigured: boolean;
}

/** Only the true flags — spread into `llmProxyForPlan` / `proxyForCompletion` options. */
export interface FundingOrder {
  /** BYO is an execution boundary: operator-funded models leave the chain. */
  byoRequired?: true;
  /** The gateway may continue into entitled shared routes after connected accounts
   *  (without it, any connected credential makes the chain BYO-strict — `ProxyFunding.byoStrict`). */
  allowGatewayAuto?: true;
  /** The free tier (FREE models + the Cloudflare daily allowance) leads; connected
   *  accounts follow it instead of heading the chain. */
  freeFirst?: true;
}

/** Free tier, then connected accounts, then the rest of the pool. */
const FREE_FIRST: FundingOrder = Object.freeze({ allowGatewayAuto: true, freeFirst: true });
/** Connected accounts head the chain (`composeCompletionSeed` seeds them as the head),
 *  then the pool — non-strict. */
const BYO_FIRST: FundingOrder = Object.freeze({ allowGatewayAuto: true });
/** Connected accounts only — the BYO execution boundary. */
const BYO_STRICT: FundingOrder = Object.freeze({ byoRequired: true });
const NOTHING_CONNECTED: FundingOrder = Object.freeze({});

export function resolveFundingOrder(input: FundingOrderInput): FundingOrder {
  if (input.requested === 'byo_pool') return BYO_STRICT;
  if (input.requested === 'auto') return FREE_FIRST;
  if (!input.byoConfigured) return NOTHING_CONNECTED;
  return input.preference === 'free_first' ? FREE_FIRST : BYO_FIRST;
}

/**
 * The server-side agent callers' rule (tenant proxy, cloud agent turns): no person and so
 * no preference — a configured BYO provider makes the run strict, exactly as these
 * callers always were. Named so the strictness is a stated choice, not an inference.
 */
export function strictWhenConnected(byoConfigured: boolean): FundingOrder {
  return resolveFundingOrder({ ...(byoConfigured ? { requested: 'byo_pool' as const } : {}), byoConfigured });
}
