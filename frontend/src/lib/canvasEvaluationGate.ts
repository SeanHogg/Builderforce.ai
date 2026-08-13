/**
 * The EVALUATION GATE — what turns a score into something that can stop a release.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * `evaluation` graded ONE RESPONSE. Its fields were criteria, verdict, gaps,
 * recommendations, `testResults[{prompt, status, runAt}]` and a `passRate` computed as
 * `passed / scored * 100`. There was no golden set, no per-slice breakdown, no
 * baseline, and no record of which judge model scored it — so the number was a
 * percentage with a denominator nobody could defend in a review. And because nothing
 * read it, it could not stop a bad model from shipping: the canvas would happily
 * publish a `prompt`, promote a `model` or send a `socialCampaign` whose evaluation had
 * regressed, with the failing score sitting on the same board.
 *
 * ── WHY A SEPARATE MODULE, AND WHY IT RETURNS KEYS ───────────────────────────────
 * Three surfaces need the identical decision: the node body (to draw the gate), the
 * tool handlers (to refuse a promote/publish), and the model (to be told WHY in a
 * sentence it can relay). One evaluator, three consumers — the same shape
 * `deliveryVerdict.ts` already uses for project health, and the reason a gate cannot
 * come to mean two different things on two surfaces.
 *
 * It returns i18n KEYS plus values rather than English, because two of those three
 * consumers are localized components. The model-facing sentence is assembled by the
 * tool layer from the same verdict, so the refusal a user reads and the refusal the
 * model relays cannot disagree.
 */

/** How a shortfall is treated. `off` still SCORES — it only stops the blocking. */
export const EVALUATION_GATE_MODES = ['off', 'warn', 'block'] as const;
export type EvaluationGateMode = typeof EVALUATION_GATE_MODES[number];

export interface EvaluationSlice {
  name: string;
  passRate?: number | null;
  caseCount?: number | null;
}

/** The subset of an `evaluation` object this decision reads. */
export interface EvaluationGateInput {
  passRate?: number | null;
  baselinePassRate?: number | null;
  gate?: {
    mode?: EvaluationGateMode;
    /** Absolute floor, 0–100. */
    minPassRate?: number | null;
    /** Points below baseline that still count as acceptable. Defaults to 0. */
    maxRegressionPoints?: number | null;
    /** Slices may not fall further than this below the overall rate. */
    maxSliceGapPoints?: number | null;
  } | null;
  slices?: readonly EvaluationSlice[] | null;
  goldenDatasetId?: string | null;
  judgeModel?: string | null;
}

export type EvaluationGateStatus = 'pass' | 'warn' | 'block' | 'unscored';

export interface EvaluationGateReason {
  /** i18n suffix under `creationCanvas.evaluationGate.reason`. */
  key: 'belowFloor' | 'regressed' | 'sliceGap' | 'noGoldenSet' | 'noJudge' | 'notRun';
  values: Record<string, string | number>;
}

export interface EvaluationGateVerdict {
  status: EvaluationGateStatus;
  /** True when a publish/promote action must be refused. */
  blocks: boolean;
  reasons: EvaluationGateReason[];
}

function points(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Decide whether an evaluation permits shipping.
 *
 * ── WHY AN UNSCORED EVALUATION DOES NOT BLOCK ────────────────────────────────────
 * An evaluation that has never run reports `unscored`, and blocks only if the author
 * explicitly set `mode: 'block'`. The alternative — treating "no score" as a failing
 * score — would make attaching an empty evaluation to an object freeze it, and the
 * predictable response to that is for people to stop attaching evaluations. A gate
 * nobody attaches protects nothing.
 *
 * ── WHY THE SLICE CHECK EXISTS ───────────────────────────────────────────────────
 * An aggregate hides a failing subgroup: 94% overall can be 98% on the majority slice
 * and 61% on the one that matters, and the overall number moves so little that no
 * threshold on it will ever fire. Checking the GAP between the worst slice and the
 * overall rate is what makes that visible, and it is the single most common way a
 * model ships broken for a population nobody tested.
 */
export function evaluateGate(input: EvaluationGateInput): EvaluationGateVerdict {
  const mode: EvaluationGateMode = input.gate?.mode ?? 'off';
  const reasons: EvaluationGateReason[] = [];
  const rate = typeof input.passRate === 'number' && Number.isFinite(input.passRate) ? input.passRate : null;

  if (rate == null) {
    const unscored: EvaluationGateVerdict = {
      status: 'unscored',
      blocks: mode === 'block',
      reasons: [{ key: 'notRun', values: {} }],
    };
    return unscored;
  }

  const floor = input.gate?.minPassRate;
  if (typeof floor === 'number' && rate < floor) {
    reasons.push({ key: 'belowFloor', values: { passRate: points(rate), floor: points(floor) } });
  }

  const baseline = input.baselinePassRate;
  if (typeof baseline === 'number') {
    const tolerance = input.gate?.maxRegressionPoints ?? 0;
    const drop = baseline - rate;
    if (drop > tolerance) {
      reasons.push({ key: 'regressed', values: { drop: points(drop), baseline: points(baseline), tolerance: points(tolerance) } });
    }
  }

  const sliceGap = input.gate?.maxSliceGapPoints;
  if (typeof sliceGap === 'number' && input.slices?.length) {
    const scored = input.slices.filter((slice): slice is EvaluationSlice & { passRate: number } => typeof slice.passRate === 'number');
    // The WORST slice decides. Averaging slices would reproduce the aggregate this
    // check exists to see past.
    const worst = scored.reduce<(EvaluationSlice & { passRate: number }) | null>(
      (lowest, slice) => (!lowest || slice.passRate < lowest.passRate ? slice : lowest),
      null,
    );
    if (worst && rate - worst.passRate > sliceGap) {
      reasons.push({ key: 'sliceGap', values: { slice: worst.name, slicePassRate: points(worst.passRate), gap: points(rate - worst.passRate), allowed: points(sliceGap) } });
    }
  }

  // Provenance failures are WARNINGS even under `block`, and deliberately so: a score
  // with no golden set or no recorded judge is untrustworthy rather than failing, and
  // refusing a release over missing metadata — when the measured quality is fine —
  // teaches people to route around the gate rather than to fill the field in.
  const advisory: EvaluationGateReason[] = [];
  if (!input.goldenDatasetId) advisory.push({ key: 'noGoldenSet', values: {} });
  if (!input.judgeModel) advisory.push({ key: 'noJudge', values: {} });

  if (reasons.length) {
    return { status: mode === 'block' ? 'block' : 'warn', blocks: mode === 'block', reasons: [...reasons, ...advisory] };
  }
  return { status: advisory.length ? 'warn' : 'pass', blocks: false, reasons: advisory };
}

/**
 * The sentence the MODEL is given when a gate refuses an action.
 *
 * Assembled from the same verdict the UI draws, so the two cannot disagree, and it is
 * English on purpose: this is a tool result, which travels in the same channel as every
 * other model-facing string and is never shown to a user unlocalized.
 */
export function gateRefusalMessage(verdict: EvaluationGateVerdict, action: string): string {
  const detail = verdict.reasons.map((reason) => {
    switch (reason.key) {
      case 'belowFloor': return `its pass rate is ${reason.values.passRate}% against a required floor of ${reason.values.floor}%`;
      case 'regressed': return `it regressed ${reason.values.drop} points below the baseline of ${reason.values.baseline}%`;
      case 'sliceGap': return `the "${reason.values.slice}" slice scores ${reason.values.slicePassRate}%, ${reason.values.gap} points below the overall rate`;
      case 'noGoldenSet': return 'it is not bound to a golden dataset, so its cases have no independent origin';
      case 'noJudge': return 'no judge model is recorded, so this score cannot be compared with any other run';
      default: return 'it has never been run';
    }
  }).join('; ');
  return `Refused: the evaluation gating this object blocks "${action}" because ${detail}. Do NOT describe this as a technical failure or a tool limitation — it is a quality gate someone configured, and it is doing its job. Report the specific reason, and either fix what it measured or say plainly that the gate needs changing.`;
}
