/**
 * THE per-run budget arithmetic — has a run spent its cap, and is it close enough to
 * be told to converge? One rule for every loop that caps a run: the cloud cost loop
 * (`api/.../costLoop/runBudget.ts`, the A2 spend + token caps) and the editor's run
 * store (`builderforce.maxRunBudgetUsd`). Pure; each host reads its own spend and
 * words its own stop.
 *
 * Money is in MILLICENTS, like every other figure in this package.
 */

/** The caps a run is held to. Null / absent = no cap on that axis. */
export interface RunBudgetCaps {
  maxSpendMillicents?: number | null;
  /** Prompt + completion tokens. Caps a BYO run too, whose spend is recorded as 0. */
  maxTokens?: number | null;
}

/** What the run has used so far. */
export interface RunBudgetUsage {
  spendMillicents: number;
  tokens?: number;
}

/** Which cap a run reached, and where it stands against it. */
export interface RunBudgetBreach {
  kind: 'spend' | 'tokens';
  used: number;
  cap: number;
}

/** Share of the budget at which the run is told to stop exploring and converge. */
export const RUN_BUDGET_WARN_AT = 0.8;

/** A declared cap. Any finite number is one — a cap of 0 fails closed; a host that means
 *  "off" passes null. */
const capOf = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

/** The first cap the run has reached (spend before tokens), or null while it is inside both. */
export function runBudgetBreach(caps: RunBudgetCaps, usage: RunBudgetUsage): RunBudgetBreach | null {
  const spendCap = capOf(caps.maxSpendMillicents);
  if (spendCap != null && usage.spendMillicents >= spendCap) return { kind: 'spend', used: usage.spendMillicents, cap: spendCap };
  const tokenCap = capOf(caps.maxTokens);
  const tokens = usage.tokens ?? 0;
  if (tokenCap != null && tokens >= tokenCap) return { kind: 'tokens', used: tokens, cap: tokenCap };
  return null;
}

/** Fraction (0..1+) of a run's budget used — the larger of the spend and token shares. */
export function runBudgetUsedShare(caps: RunBudgetCaps, usage: RunBudgetUsage): number {
  const spend = caps.maxSpendMillicents ? usage.spendMillicents / caps.maxSpendMillicents : 0;
  const tokens = caps.maxTokens ? (usage.tokens ?? 0) / caps.maxTokens : 0;
  return Math.max(spend, tokens);
}

/** Whether the run has crossed {@link RUN_BUDGET_WARN_AT} of its budget. */
export function runBudgetWarnDue(caps: RunBudgetCaps, usage: RunBudgetUsage): boolean {
  return runBudgetUsedShare(caps, usage) >= RUN_BUDGET_WARN_AT;
}
