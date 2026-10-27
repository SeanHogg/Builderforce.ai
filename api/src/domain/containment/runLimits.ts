import { runBudgetBreach, runBudgetUsedShare as sharedUsedShare } from '@builderforce/spend-contract';

export interface RunLimits {
  maxFiles: number | null;
  maxRepositories: number | null;
  maxSpendMillicents: number | null;
  /** Per-run TOKEN ceiling (prompt + completion), cost lever A2. Caps BYO runs too,
   *  whose spend is recorded as 0. Absent/null = no token cap (today's behaviour). */
  maxTokens?: number | null;
}

export interface RunUsage {
  files: number;
  repositories: number;
  spendMillicents: number;
  /** Tokens this run has consumed so far (prompt + completion). */
  tokens?: number;
}

/**
 * The run's FOOTPRINT caps alone — files written and repositories touched. What a tool
 * call is checked against before it runs: spend accrues per model turn and is checked
 * there ({@link checkRunLimits} in the cost loop's pre-turn check), never per tool.
 */
export function checkFootprintLimits(
  limits: Pick<RunLimits, 'maxFiles' | 'maxRepositories'>,
  usage: Pick<RunUsage, 'files' | 'repositories'>,
): string | null {
  if (limits.maxFiles != null && usage.files > limits.maxFiles) return `file limit exceeded (${usage.files}/${limits.maxFiles})`;
  if (limits.maxRepositories != null && usage.repositories > limits.maxRepositories) return `repository limit exceeded (${usage.repositories}/${limits.maxRepositories})`;
  return null;
}

export function checkRunLimits(limits: RunLimits, usage: RunUsage): string | null {
  const footprint = checkFootprintLimits(limits, usage);
  if (footprint) return footprint;
  // The spend / token caps are the ONE budget rule the editor's run store also holds a
  // run to (`@builderforce/spend-contract` `runBudget.ts`); only the wording is ours.
  const breach = runBudgetBreach(limits, usage);
  if (!breach) return null;
  return breach.kind === 'spend'
    ? `spend limit reached (${breach.used}/${breach.cap} millicents)`
    : `token limit reached (${breach.used}/${breach.cap} tokens)`;
}

/** Default per-run token ceiling by plan (cost lever A2). An unknown plan gets the free cap. */
export const RUN_TOKEN_CAP_BY_PLAN: Readonly<Record<'free' | 'pro' | 'teams', number>> = {
  free: 200_000,
  pro: 2_000_000,
  teams: 5_000_000,
};

/**
 * The run's token cap: an explicit `containmentLimits.maxTokens` override when it is a
 * non-negative finite number, else the plan default. Superadmin is NOT exempt — the USD
 * cap is not either, and the two caps follow one rule.
 */
export function resolveRunTokenCap(plan: string | null | undefined, override?: unknown): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return Math.trunc(override);
  return RUN_TOKEN_CAP_BY_PLAN[plan as keyof typeof RUN_TOKEN_CAP_BY_PLAN] ?? RUN_TOKEN_CAP_BY_PLAN.free;
}

/** Fraction (0..1+) of a run's budget used — the larger of the spend and token shares. */
export function runBudgetUsedShare(limits: RunLimits, usage: RunUsage): number {
  return sharedUsedShare(limits, usage);
}
