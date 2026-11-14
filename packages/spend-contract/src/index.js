/**
 * The SPENT vs SAVED contract — the shape the api's `spendSavingsSummary` produces, on
 * every chat (`chat.spend`) and on the consumption snapshot (`spendSavings`, 30 days).
 * Declared ONCE, here: the api builds it, brain-embedded re-exports it to every surface
 * (web, editor, Rovr) and the shared UI in brain-ui renders it — no hand-copied twin to
 * drift. The fold that produces it (`fold.ts`) and the cost rule it prices with
 * (`cost.ts`) live here too, so a device folding its own usage (PRD 36) runs the same
 * arithmetic as the api.
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
export const USAGE_SURFACES = ['web', 'vsix', 'on_prem', 'cloud', 'sdk', 'rovr'];
/** True when `raw` names one of the {@link USAGE_SURFACES}. */
export function isUsageSurface(raw) {
    return typeof raw === 'string' && USAGE_SURFACES.includes(raw);
}
/** The header a client tags its gateway calls with, so the ledger knows the surface. */
export const USAGE_SURFACE_HEADER = 'x-builderforce-surface';
export { CACHE_CREATION_MULTIPLIER, CACHE_READ_MULTIPLIER, MEDIAN_TURN_TOKENS, MILLICENTS_PER_USD, computeCostMillicents, millicentsToUsd, } from './cost.js';
export { combineSpendSavings, foldSpendSavings } from './fold.js';
export { RUN_BUDGET_WARN_AT, runBudgetBreach, runBudgetUsedShare, runBudgetWarnDue, } from './runBudget.js';
//# sourceMappingURL=index.js.map