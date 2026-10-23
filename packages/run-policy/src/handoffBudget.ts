/**
 * THE budget inputs every host feeds the hand-off packer
 * (`@seanhogg/builderforce-memory/handoff`) when it fits a transcript into the window
 * of the model about to serve it — the Brain's window fit, the native agent loop's stall
 * failover and the cloud loop's compaction all size the same request the same way.
 *
 * Pure and dependency-free: the token estimator is the caller's (the packer's own
 * `defaultEstimateTokens`), so this package stays I/O- and dependency-free.
 */

/** Tokens held back for the reply when the request names no `max_tokens`. */
export const DEFAULT_HANDOFF_RESERVE_TOKENS = 4_096;

/** Estimated tokens the advertised tool schemas cost a request — 0 when none are offered. */
export function toolSchemaTokens(schemas: readonly unknown[] | undefined, estimate: (text: string) => number): number {
  return schemas && schemas.length > 0 ? estimate(JSON.stringify(schemas)) : 0;
}

/** The reply reserve for a request: its own `max_tokens` when set, else the default. */
export function handoffReserveTokens(maxTokens: number | undefined): number {
  return maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_HANDOFF_RESERVE_TOKENS;
}

/** What sizes one hand-off's token budget. */
export interface HandoffTokenBudgetInput {
  /** The host's cost cap (the cloud loop's 40K), when it has one. Absent = window-bound. */
  costCapTokens?: number;
  /** The serving model's context window, when known. */
  contextWindow?: number;
  /** Tokens held back for the reply. */
  reserveOutputTokens?: number;
  /**
   * The model's lowest long-context price boundary (`@builderforce/model-catalog`
   * `priceTierBoundary`), passed ONLY when cost lever `c9_price_tier_budget` is on.
   * Absent = today's budget exactly.
   */
  priceTierBoundary?: number;
}

/**
 * THE hand-off token budget: the smallest of the cost cap, the window less the reply
 * reserve and — when the caller passes it (cost PRD C9) — the model's lowest
 * long-context price boundary (an input-token boundary), so a packed request never crosses into
 * the tier that re-bills the whole request at a higher rate. Never below 1. Returns
 * `undefined` when there is nothing to bound by (no cap, no window, no tier). PURE.
 */
export function handoffTokenBudget(input: HandoffTokenBudgetInput): number | undefined {
  const reserve = Math.max(0, input.reserveOutputTokens ?? 0);
  const bounds: number[] = [];
  if (input.costCapTokens && input.costCapTokens > 0) bounds.push(input.costCapTokens);
  if (input.contextWindow && input.contextWindow > 0) bounds.push(input.contextWindow - reserve);
  // The tier is priced on INPUT tokens only, so the reply reserve does not come off it.
  if (input.priceTierBoundary && input.priceTierBoundary > 0) bounds.push(input.priceTierBoundary);
  if (bounds.length === 0) return undefined;
  return Math.max(1, Math.min(...bounds));
}
