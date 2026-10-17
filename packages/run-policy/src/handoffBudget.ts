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
