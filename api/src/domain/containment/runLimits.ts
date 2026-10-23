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

export function checkRunLimits(limits: RunLimits, usage: RunUsage): string | null {
  if (limits.maxFiles != null && usage.files > limits.maxFiles) return `file limit exceeded (${usage.files}/${limits.maxFiles})`;
  if (limits.maxRepositories != null && usage.repositories > limits.maxRepositories) return `repository limit exceeded (${usage.repositories}/${limits.maxRepositories})`;
  if (limits.maxSpendMillicents != null && usage.spendMillicents >= limits.maxSpendMillicents) return `spend limit reached (${usage.spendMillicents}/${limits.maxSpendMillicents} millicents)`;
  if (limits.maxTokens != null && (usage.tokens ?? 0) >= limits.maxTokens) return `token limit reached (${usage.tokens ?? 0}/${limits.maxTokens} tokens)`;
  return null;
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
  const spend = limits.maxSpendMillicents ? usage.spendMillicents / limits.maxSpendMillicents : 0;
  const tokens = limits.maxTokens ? (usage.tokens ?? 0) / limits.maxTokens : 0;
  return Math.max(spend, tokens);
}
