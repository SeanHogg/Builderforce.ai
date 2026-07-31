/**
 * Trait reinforcement (Gap 6) — the pure core that lets an agent's STATIC
 * psychometric trait vector self-update from real run outcomes, closing the gap
 * where only the limbic affect-DYNAMICS model learned while the trait vector was
 * recomputed from the human-authored DB every run and never reinforced.
 *
 * This module is deliberately PURE + deterministic (no DB, no env, no clock): given
 * an agent's current trait vector and a set of {@link RunOutcomeSignal}s, it PROPOSES
 * a small, bounded, reversible set of per-dimension nudges with a rationale. It never
 * applies anything itself — the api apply endpoint (human/manager approval, or an
 * explicit auto-apply flag) is what commits a proposal to `ide_agents.psychometric`.
 * That "propose, never silently mutate" split is the whole safety story.
 *
 * DRY: the dimension ids come from the ONE shared `PSYCH_DIM` map (no local list),
 * and the 0..100 scale + NEUTRAL come from the shared scorer, so a reinforcement is
 * expressed in exactly the vocabulary the compiler consumes.
 */
import { PSYCH_DIM, NEUTRAL, HI, LO, score } from '@builderforce/agent-tools';

/** A single terminal run's outcome, distilled to the signals reinforcement reads.
 *  Produced LIVE from `run_model_outcomes` (see personalityRoutes). */
export interface RunOutcomeSignal {
  /** The run reached a successful terminal state (merged/among completed). */
  succeeded: boolean;
  /** 0..1 — how error-prone the run's tool use was (degradation / hallucination). */
  toolErrorRate: number;
  /** A human accepted the deliverable (e.g. the PR was merged / approved). */
  humanAccepted: boolean;
  /** A human rejected the run (cancelled it, or completed-but-not-accepted). */
  humanRejected: boolean;
  /** Loop/step count the run took — a proxy for retries. */
  retries: number;
  /** Optional: actual/estimated duration ratio (>1 = slower than estimated). */
  durationVsEstimate?: number;
}

/** The bounded proposal: per-dimension deltas keyed by DIM id + a why. */
export interface TraitReinforcementProposal {
  deltas: Record<string, number>;
  rationale: string[];
}

export interface ProposeOptions {
  /** Minimum terminal runs before ANY proposal is made (below → empty). Default 5. */
  minRuns?: number;
  /** Absolute cap on a single dimension's delta in ONE reinforcement. Default 3. */
  maxDeltaPerDim?: number;
  /** Absolute cap on a dimension's cumulative applied delta within the period
   *  (e.g. a week). The running total already applied is passed via
   *  {@link priorAppliedThisPeriod}; a fresh nudge is clamped so |prior+nudge| never
   *  exceeds this. Default 6. */
  maxPeriodAbs?: number;
  /** Deltas already committed to this agent within the current period (DIM id →
   *  signed total). Used to enforce {@link maxPeriodAbs}. Default {} (none). */
  priorAppliedThisPeriod?: Record<string, number>;
  /** Fraction of runs whose toolErrorRate is "high" that trips the tool-error rule.
   *  Default 0.30. */
  toolErrorThreshold?: number;
  /** Retry count at/above which a run counts as "excessive retries". Default 15. */
  excessiveRetries?: number;
}

/** Conservative defaults — exported so tests + the route agree on the caps. */
export const DEFAULT_MIN_RUNS = 5;
export const MAX_DELTA_PER_DIM = 3;
export const MAX_PERIOD_ABS = 6;
const DEFAULT_TOOL_ERROR_THRESHOLD = 0.3;
const DEFAULT_EXCESSIVE_RETRIES = 15;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const clamp0100 = (n: number): number => clamp(Math.round(n), 0, 100);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Apply a set of bounded deltas to a trait vector, clamping every resulting score to
 * 0..100 (an absent dimension starts from NEUTRAL). Pure — returns a NEW vector and
 * never mutates the input, so the caller keeps the "before" snapshot for reversal.
 */
export function applyDeltas(
  vector: Record<string, number> | undefined,
  deltas: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...(vector ?? {}) };
  for (const [dim, delta] of Object.entries(deltas)) {
    if (!Number.isFinite(delta) || delta === 0) continue;
    const base = typeof out[dim] === 'number' ? out[dim]! : NEUTRAL;
    out[dim] = clamp0100(base + delta);
  }
  return out;
}

/**
 * Propose bounded, reversible trait nudges from a batch of run outcomes.
 *
 * The rules are intentionally conservative — a personality should DRIFT toward what
 * works, not lurch. Each raw nudge is scaled by how strong the signal is, then hard-
 * capped per dimension (±{@link MAX_DELTA_PER_DIM}) and again so the cumulative
 * applied change within the period never exceeds ±{@link MAX_PERIOD_ABS}. Every nudge
 * carries a rationale line for observability. Below `minRuns` samples it proposes
 * nothing (too little signal to move a personality).
 *
 *   Rules (all bounded, all reversible):
 *    1. Repeated tool errors        → conscientiousness ↑, reflection ↑
 *       (be more methodical, distrust the first answer and verify).
 *    2. Excessive retries, low win  → grit ↓, emotionality ↑
 *       (escalate earlier instead of grinding; surface the blocker).
 *    3. Humans reject risky actions → riskTolerance ↓, regulatoryFocus ↓
 *       (only when the agent is CURRENTLY risk-seeking — i.e. its risky actions
 *        are what got rejected; bias toward safe, reversible, prevention-focused).
 *    4. Strong success + acceptance → grit ↑, locusInternal ↑ (small)
 *       (reinforce persistence + ownership when the current approach is working).
 */
export function proposeTraitReinforcement(
  currentVector: Record<string, number> | undefined,
  signals: RunOutcomeSignal[],
  opts: ProposeOptions = {},
): TraitReinforcementProposal {
  const minRuns = opts.minRuns ?? DEFAULT_MIN_RUNS;
  const maxDim = opts.maxDeltaPerDim ?? MAX_DELTA_PER_DIM;
  const maxPeriod = opts.maxPeriodAbs ?? MAX_PERIOD_ABS;
  const prior = opts.priorAppliedThisPeriod ?? {};
  const toolErrThreshold = opts.toolErrorThreshold ?? DEFAULT_TOOL_ERROR_THRESHOLD;
  const excessiveRetries = opts.excessiveRetries ?? DEFAULT_EXCESSIVE_RETRIES;

  const rationale: string[] = [];
  const raw: Record<string, number> = {};

  if (signals.length < minRuns) {
    return { deltas: {}, rationale: [`Not enough terminal runs yet (${signals.length}/${minRuns}) — no reinforcement proposed.`] };
  }

  // Accumulate a raw nudge for a dimension (rules may reinforce the same dim).
  const nudge = (dim: string, amount: number) => {
    raw[dim] = (raw[dim] ?? 0) + amount;
  };

  const n = signals.length;
  const successRate = mean(signals.map((s) => (s.succeeded ? 1 : 0)));
  const highToolErrorRate = mean(signals.map((s) => (s.toolErrorRate >= toolErrThreshold ? 1 : 0)));
  const avgToolErrorRate = mean(signals.map((s) => clamp(s.toolErrorRate, 0, 1)));
  const rejectRate = mean(signals.map((s) => (s.humanRejected ? 1 : 0)));
  const acceptRate = mean(signals.map((s) => (s.humanAccepted ? 1 : 0)));
  const excessiveRetryRate = mean(signals.map((s) => (s.retries >= excessiveRetries && !s.succeeded ? 1 : 0)));

  // Rule 1 — repeated tool errors ⇒ be more careful.
  if (highToolErrorRate >= 0.3 || avgToolErrorRate >= 0.4) {
    const severity = Math.max(highToolErrorRate, avgToolErrorRate); // 0..1
    nudge(PSYCH_DIM.conscientiousness, maxDim * severity);
    nudge(PSYCH_DIM.reflection, maxDim * severity * 0.8);
    rationale.push(
      `Tool errors were high in ${Math.round(highToolErrorRate * 100)}% of the last ${n} runs — nudging Conscientiousness and Reflection up so the agent plans, tests, and verifies more before acting.`,
    );
  }

  // Rule 2 — excessive retries that still fail ⇒ escalate earlier.
  if (excessiveRetryRate >= 0.3 && successRate < 0.5) {
    const severity = excessiveRetryRate;
    nudge(PSYCH_DIM.grit, -maxDim * severity);
    nudge(PSYCH_DIM.emotionality, maxDim * severity * 0.6);
    rationale.push(
      `${Math.round(excessiveRetryRate * 100)}% of runs burned many retries without succeeding — lowering Grit and raising Emotionality so the agent escalates or surfaces the blocker sooner instead of grinding.`,
    );
  }

  // Rule 3 — humans reject the agent's RISKY actions ⇒ dial risk down.
  const currentRisk = score(currentVector, PSYCH_DIM.riskTolerance);
  if (rejectRate >= 0.25 && currentRisk > NEUTRAL) {
    const severity = rejectRate;
    nudge(PSYCH_DIM.riskTolerance, -maxDim * severity);
    nudge(PSYCH_DIM.regulatoryFocus, -maxDim * severity * 0.7);
    rationale.push(
      `Humans rejected ${Math.round(rejectRate * 100)}% of runs while the agent is risk-seeking — lowering Risk tolerance and shifting Regulatory focus toward prevention (safe, reversible steps).`,
    );
  }

  // Rule 4 — the current approach is working ⇒ small positive reinforcement.
  if (successRate >= 0.8 && acceptRate >= 0.6 && rejectRate <= 0.1) {
    const severity = Math.min(1, (successRate + acceptRate) / 2);
    nudge(PSYCH_DIM.grit, maxDim * 0.5 * severity);
    nudge(PSYCH_DIM.locusInternal, maxDim * 0.5 * severity);
    rationale.push(
      `Runs are succeeding (${Math.round(successRate * 100)}%) and being accepted (${Math.round(acceptRate * 100)}%) — gently reinforcing Grit and Ownership so the working approach persists.`,
    );
  }

  // ── Bound every nudge: per-dimension cap, then the period cumulative cap. ────────
  const deltas: Record<string, number> = {};
  for (const [dim, rawDelta] of Object.entries(raw)) {
    // Per-reinforcement cap.
    let delta = clamp(Math.round(rawDelta), -maxDim, maxDim);
    // Period cap: |priorApplied + delta| must not exceed maxPeriod.
    const priorApplied = Number.isFinite(prior[dim]) ? (prior[dim] as number) : 0;
    const room = maxPeriod - Math.abs(priorApplied);
    if (room <= 0) {
      // Already at the weekly ceiling for this dimension — propose nothing more.
      continue;
    }
    if (delta > 0) delta = Math.min(delta, room);
    else if (delta < 0) delta = Math.max(delta, -room);
    // If the prior push is in the SAME direction, ensure we never cross the ceiling.
    if (priorApplied !== 0 && Math.sign(priorApplied) === Math.sign(delta)) {
      const headroom = maxPeriod - Math.abs(priorApplied);
      delta = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, headroom));
    }
    if (delta !== 0) deltas[dim] = delta;
  }

  if (Object.keys(deltas).length === 0 && rationale.length === 0) {
    rationale.push(`Outcomes over the last ${n} runs look balanced — no reinforcement needed.`);
  }

  return { deltas, rationale };
}

/** Convenience: the strongest applied dimension names in a proposal (for a summary). */
export function summarizeDeltas(deltas: Record<string, number>): string {
  const entries = Object.entries(deltas).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (entries.length === 0) return 'no change';
  return entries.map(([dim, d]) => `${dim} ${d > 0 ? '+' : ''}${d}`).join(', ');
}

/** Re-export the scale anchors so consumers don't re-derive them. */
export { NEUTRAL, HI, LO };
