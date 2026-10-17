/**
 * The SPENT vs SAVED contract — the shape the api's `spendSavingsSummary` produces, on
 * every chat (`chat.spend`) and on the consumption snapshot (`spendSavings`, 30 days).
 * Declared ONCE, here: the api builds it, brain-embedded re-exports it to every surface
 * (web, editor, Rovr) and the shared UI in brain-ui renders it — no hand-copied twin to
 * drift.
 */

/**
 * Which surface drove a usage row — the usage ledger's `surface` column (varchar(16)).
 * Set on every row so metering can apply the BYO exemption (own-machine on-prem/VSIX
 * BYO usage is free; every other surface's BYO is charged) and so spend is reported
 * by where it happened.
 *   • web      → the web app (Brain chat, dashboards) or an unattributed call.
 *   • vsix     → the VS Code extension (own machine).
 *   • on_prem  → a self-hosted agent host (own machine).
 *   • cloud    → a cloud agent run (Durable Object / container) on our infra.
 *   • sdk      → a direct SDK/API caller.
 *   • rovr     → the Rovr Chrome side panel.
 * Declared once here: the api records it, brain-embedded's memory hooks send it.
 */
export const USAGE_SURFACES = ['web', 'vsix', 'on_prem', 'cloud', 'sdk', 'rovr'] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];

/** True when `raw` names one of the {@link USAGE_SURFACES}. */
export function isUsageSurface(raw: unknown): raw is UsageSurface {
  return typeof raw === 'string' && (USAGE_SURFACES as readonly string[]).includes(raw);
}

/** The header a client tags its gateway calls with, so the ledger knows the surface. */
export const USAGE_SURFACE_HEADER = 'x-builderforce-surface';

/** Where a saving came from. `recall_overhead` is the one COST (negative `usd`). */
export type SavingsSourceKey =
  | 'prompt_cache'
  | 'memory_answer'
  | 'evermind_answer'
  | 'response_cache'
  | 'context_trim'
  | 'recall_overhead';

export interface SpendBreakdown {
  /** What the platform billed (plan / overflow / premium). */
  platformUsd: number;
  /** Own-key (BYO) calls priced at list — what the person's provider charged. */
  yourKeyUsd: number;
  totalUsd: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  /** Tokens on models with no catalog price (counted, not valued). */
  unpricedTokens: number;
  requests: number;
}

export interface SavingsBySource {
  source: SavingsSourceKey;
  usd: number;
  tokens: number;
  events: number;
  estimated: boolean;
}

export interface SavingsBreakdown {
  /** Recorded figures + the provider prompt cache. */
  measuredUsd: number;
  /** Character estimates, net of what recall added. */
  estimatedUsd: number;
  netUsd: number;
  tokensSaved: number;
  bySource: SavingsBySource[];
}

export interface SpendSavingsSummary {
  spend: SpendBreakdown;
  saved: SavingsBreakdown;
  /** Net saved ÷ (spent + net saved); null when nothing was spent or saved. */
  savedPct: number | null;
}
