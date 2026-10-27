/**
 * policy/compaction/reserve — reserve tokens, ported.
 *
 * The tokens the packer holds back so the serving model has room to answer — the
 * shared hand-off reserve (`@builderforce/run-policy` `DEFAULT_HANDOFF_RESERVE_TOKENS`
 * / `handoffReserveTokens`) and the on-prem floor (`agent-runtime` agent-settings
 * `resolveCompactionReserveTokensFloor` / `ensureCompactionReserveTokens`, which bump
 * the reserve to the floor when a run is under it).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/** Tokens held back for the reply when a request names no `max_tokens`. */
export const DEFAULT_COMPACT_RESERVE_TOKENS = 4_096;

/** A model's context window, when the surface knows it. */
export type CompactWindow = number | undefined;

/** The on-prem floor: the reserve can never sit below this. */
export const MIN_COMPACT_RESERVE_TOKENS = 1_024;

/** The reserve the packer holds back: `maxTokens` when the request names one, else the default. */
export function compactReserveTokens(maxTokens: number | undefined): number {
  return maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_COMPACT_RESERVE_TOKENS;
}

/** The reserve floor for a serving model's window, when known. */
export function resolveCompactReserveTokensFloor(window: CompactWindow): number {
  return typeof window === 'number' && Number.isFinite(window) && window > 0 ? MIN_COMPACT_RESERVE_TOKENS : 0;
}

/** Never let the reserve sit below the floor the serving model's window sets. */
export function ensureCompactReserveTokens(reserve: number, floor: number): number {
  return Math.max(Math.max(1, Math.floor(reserve)), Math.max(0, Math.floor(floor)));
}
