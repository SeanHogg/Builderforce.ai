/**
 * THE weak-first verifier cascade (cost PRD D1), as pure policy.
 *
 * A run's work comes in UNITS: a batch of code edits made in one turn, a finish attempt,
 * a structured answer. Each unit has a VERIFIER the host already owns — the changed-file
 * checks for code, the finish gates for a finish, a schema for structured output. Today
 * a failed verifier hands the SAME model the same problem again. The cascade says
 * instead: start the unit on the cheapest tier that can plausibly do it; when its
 * verifier fails, move ONE tier up the role's tier list (and raise reasoning one level),
 * carrying the failed attempt and the verifier's reason as a steer; give up escalating
 * after {@link MAX_UNIT_ESCALATIONS}; when the unit passes, step back down to where the
 * unit started so the next unit is weak-first again.
 *
 * Model state stays in the run policy (`reduceRunPolicy` `escalated`); this module only
 * decides. Pure, I/O-free; the state is plain JSON so a durable host carries it.
 */

/** What kind of work a unit is — names the verifier that judges it. */
export type CascadeUnitKind = 'code_edit' | 'finish' | 'structured_output';

/** A verifier's judgement on one attempt at a unit. */
export interface CascadeVerdict {
  passed: boolean;
  /** Which verifier judged it (`changed_files`, `finish_gates`, `schema`, …). */
  verifier: string;
  /** Why it failed, in words the next model can act on. */
  reason?: string;
  /**
   * The attempt could not be judged for a reason that is not the model's (CI still
   * running, a transient read failure). Neither escalates nor closes the unit.
   */
  inconclusive?: boolean;
}

/** At most this many tier steps per unit of work. */
export const MAX_UNIT_ESCALATIONS = 2;

export interface CascadeState {
  /** The unit currently being repaired, if one failed and has not passed since. */
  open?: { kind: CascadeUnitKind; escalations: number; baseModel?: string };
  /** Tier steps taken this run (telemetry; also bounds reasoning escalation). */
  escalations: number;
  /** Reasoning levels raised above the role default for the current unit. */
  reasoningBoost: number;
}

export function initialCascadeState(): CascadeState {
  return { escalations: 0, reasoningBoost: 0 };
}

/** The ordered models a role may run on, and how strong each one is. */
export interface TierLadder {
  /** Candidate models, in the host's preference order. */
  candidates: readonly string[];
  /** Tier rank of a model — higher is stronger (FREE < STANDARD < PREMIUM < ULTRA). */
  rankOf(model: string): number;
}

/** The first candidate on the WEAKEST tier present, skipping `exclude`. */
export function weakestTierModel(ladder: TierLadder, exclude: readonly string[] = []): string | undefined {
  const usable = ladder.candidates.filter((m) => !exclude.includes(m));
  if (usable.length === 0) return undefined;
  const floor = Math.min(...usable.map((m) => ladder.rankOf(m)));
  return usable.find((m) => ladder.rankOf(m) === floor);
}

/**
 * The first candidate exactly ONE tier above `current` (the next tier present above
 * it), skipping `exclude`. Undefined at the top of the ladder. An unknown current model
 * (auto-selected) is treated as the weakest tier, so the first step is to the next tier
 * above the floor.
 */
export function nextTierModel(ladder: TierLadder, current: string | undefined, exclude: readonly string[] = []): string | undefined {
  const usable = ladder.candidates.filter((m) => !exclude.includes(m) && m !== current);
  if (usable.length === 0) return undefined;
  const known = current !== undefined && ladder.candidates.includes(current);
  const from = known ? ladder.rankOf(current as string) : Math.min(...ladder.candidates.map((m) => ladder.rankOf(m)));
  const above = usable.map((m) => ladder.rankOf(m)).filter((r) => r > from);
  if (above.length === 0) return undefined;
  const next = Math.min(...above);
  return usable.find((m) => ladder.rankOf(m) === next);
}

/** What the host must do about a verdict. */
export type CascadeAction =
  | { kind: 'none' }
  /** Move up: ask for `to` (undefined ⇒ no stronger model — raise reasoning only), show `steer`. */
  | { kind: 'escalate'; to: string | undefined; escalateReasoning: true; steer: string }
  /** The unit failed after its last allowed step: stay, and say so. */
  | { kind: 'exhausted'; steer: string }
  /** The repaired unit passed: return to the model it started on. */
  | { kind: 'deescalate'; to: string };

/**
 * Fold one verdict into the cascade. `current` is the model that produced the attempt;
 * `ladder` the role's tiers; `exclude` the models the run routes around.
 */
export function cascadeVerdict(
  state: CascadeState,
  kind: CascadeUnitKind,
  verdict: CascadeVerdict,
  ctx: { current: string | undefined; ladder: TierLadder; exclude?: readonly string[] },
): { state: CascadeState; action: CascadeAction } {
  if (verdict.inconclusive) return { state, action: { kind: 'none' } };
  const open = state.open && state.open.kind === kind ? state.open : undefined;
  if (verdict.passed) {
    if (!open) return { state, action: { kind: 'none' } };
    const next: CascadeState = { ...state, open: undefined, reasoningBoost: 0 };
    const base = open.baseModel;
    return { state: next, action: base && open.escalations > 0 && base !== ctx.current ? { kind: 'deescalate', to: base } : { kind: 'none' } };
  }
  const unit = open ?? { kind, escalations: 0, ...(ctx.current ? { baseModel: ctx.current } : {}) };
  if (unit.escalations >= MAX_UNIT_ESCALATIONS) {
    return {
      state: { ...state, open: unit },
      action: { kind: 'exhausted', steer: cascadeSteer(kind, verdict, ctx.current, undefined, true) },
    };
  }
  const to = nextTierModel(ctx.ladder, ctx.current, ctx.exclude ?? []);
  return {
    state: {
      ...state,
      open: { ...unit, escalations: unit.escalations + 1 },
      escalations: state.escalations + 1,
      reasoningBoost: Math.min(state.reasoningBoost + 1, MAX_UNIT_ESCALATIONS),
    },
    action: { kind: 'escalate', to, escalateReasoning: true, steer: cascadeSteer(kind, verdict, ctx.current, to, false) },
  };
}

const UNIT_WORDS: Readonly<Record<CascadeUnitKind, string>> = {
  code_edit: 'your last code change',
  finish: 'your finish attempt',
  structured_output: 'your structured answer',
};

/** The steer the next attempt reads: what failed, why, and who is taking it now. */
export function cascadeSteer(
  kind: CascadeUnitKind,
  verdict: CascadeVerdict,
  from: string | undefined,
  to: string | undefined,
  exhausted: boolean,
): string {
  const why = verdict.reason ? `: ${verdict.reason.trim().slice(0, 1_200)}` : '.';
  const who = exhausted
    ? 'The run has already escalated this unit as far as it may — fix it on this model.'
    : to
      ? `It has been handed one tier up${from ? ` from ${from}` : ''} to ${to}, with more reasoning.`
      : 'No stronger model is available, so reasoning has been raised instead.';
  return `Verifier check (${verdict.verifier}) failed on ${UNIT_WORDS[kind]}${why}\n${who} Read the failure above, correct exactly what it names, and verify again before moving on.`;
}

/**
 * The structured-output verifier: a value passes when the host's schema check accepts
 * it. `validate` returns null for valid, else the reason. Pure — the schema engine is
 * the host's.
 */
export function verifyStructuredOutput(value: unknown, validate: (value: unknown) => string | null): CascadeVerdict {
  const reason = validate(value);
  return reason ? { passed: false, verifier: 'schema', reason } : { passed: true, verifier: 'schema' };
}
