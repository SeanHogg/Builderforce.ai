/**
 * Proof measures (PRD 33 D12, §5.3.1) — what visitor behaviour grades a proof.
 *
 * A realization target that runs on a website (a smoke test's landing page)
 * declares, from the numbers its own charter already states, which visits form
 * the sample, which smart event or funnel counts as success, the threshold the
 * success has to clear and the window it has to clear it in. The API persists it
 * once at materialise time (`realizations.measure`), evaluates it over the proof's
 * own hosted Insights site and writes the measured verdict; the canvas scoreboard
 * reads the same shapes. A target whose criteria are not visitor behaviour (a
 * pilot's survey, a POC's trial pass rate) declares no measure at all — a measure
 * invented for it would grade the wrong thing.
 *
 * Pure: no DOM, no I/O.
 */

import { parseReplayFilter, type ReplayFilter } from './filters';

export const PROOF_SUCCESS_KINDS = ['smartEvent', 'funnel'] as const;
export type ProofSuccessKind = (typeof PROOF_SUCCESS_KINDS)[number];

export const PROOF_THRESHOLD_OPS = ['>=', '<='] as const;
export type ProofThresholdOp = (typeof PROOF_THRESHOLD_OPS)[number];

export const PROOF_THRESHOLD_UNITS = ['count', 'rate'] as const;
export type ProofThresholdUnit = (typeof PROOF_THRESHOLD_UNITS)[number];

/** `collecting` until the window ends (or a count floor is cleared on a full sample). */
export const PROOF_STATUSES = ['collecting', 'met', 'missed'] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

/** Longest window a proof may run. A "proof" open for over a year is a product. */
export const PROOF_WINDOW_DAYS_MAX = 365;
/** Most non-converting recordings a grade cites. */
export const PROOF_EVIDENCE_RECORDINGS = 5;
const REF_MAX = 200;
const SAMPLE_MAX = 10_000_000;

export interface ProofThreshold {
  op: ProofThresholdOp;
  value: number;
  /** `count` = successes; `rate` = successes ÷ sample (0–1). */
  unit: ProofThresholdUnit;
}

export interface ProofMeasure {
  /** Which visits are the sample, and how many it takes before the number means anything. */
  sample: { filter: ReplayFilter; min: number };
  /** A smart-event NAME (built-in or the site's) or a funnel id (its last step is success). */
  success: { kind: ProofSuccessKind; ref: string };
  threshold: ProofThreshold;
  /** From the first sampled visit. */
  windowDays: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** Validate an untrusted measure (a `realizations.measure` row, a request body). Null when malformed. */
export function parseProofMeasure(raw: unknown): ProofMeasure | null {
  if (!isRecord(raw) || !isRecord(raw.sample) || !isRecord(raw.success) || !isRecord(raw.threshold)) return null;

  const filter = parseReplayFilter(raw.sample.filter);
  const min = raw.sample.min;
  if (!filter || typeof min !== 'number' || !Number.isInteger(min) || min < 1 || min > SAMPLE_MAX) return null;

  const { kind, ref } = raw.success;
  if (!oneOf(PROOF_SUCCESS_KINDS, kind)) return null;
  if (typeof ref !== 'string' || !ref.trim() || ref.length > REF_MAX) return null;

  const { op, value, unit } = raw.threshold;
  if (!oneOf(PROOF_THRESHOLD_OPS, op) || !oneOf(PROOF_THRESHOLD_UNITS, unit)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (unit === 'rate' && value > 1) return null;

  const windowDays = raw.windowDays;
  if (typeof windowDays !== 'number' || !Number.isInteger(windowDays) || windowDays < 1 || windowDays > PROOF_WINDOW_DAYS_MAX) {
    return null;
  }

  return {
    sample: { filter, min },
    success: { kind, ref: ref.trim() },
    threshold: { op, value, unit },
    windowDays,
  };
}

/** The measured value in the threshold's unit: the success count, or successes ÷ sample. */
export function proofValue(sampleN: number, successN: number, unit: ProofThresholdUnit): number {
  if (unit === 'count') return successN;
  return sampleN > 0 ? successN / sampleN : 0;
}

/** Whether `value` clears the threshold. */
export function thresholdMet(value: number, threshold: Pick<ProofThreshold, 'op' | 'value'>): boolean {
  return threshold.op === '>=' ? value >= threshold.value : value <= threshold.value;
}

export interface ProofStatusInput {
  sampleReached: boolean;
  value: number;
  threshold: ProofThreshold;
  /** Null until the first sampled visit starts the window. */
  windowEndsAt: Date | null;
}

/**
 * Where a proof stands at `now`.
 *
 * At the window's end it is `met` only with a full sample AND the threshold
 * cleared — a threshold cleared on thirty visits is a coincidence, not a grade.
 * Before the end it is decisive only for a count that must reach a floor on a
 * full sample, because that number can only rise; a rate, or a ceiling, can
 * still move either way until the window closes.
 */
export function proofStatus(input: ProofStatusInput, now: Date): ProofStatus {
  const passes = thresholdMet(input.value, input.threshold);
  const ended = input.windowEndsAt !== null && now.getTime() >= input.windowEndsAt.getTime();
  if (ended) return input.sampleReached && passes ? 'met' : 'missed';
  if (input.sampleReached && passes && input.threshold.op === '>=' && input.threshold.unit === 'count') return 'met';
  return 'collecting';
}

/** One cited pattern over the visitors who did not convert (`summarizeSegment` output). */
export interface ProofPattern {
  text: string;
  examples: Array<{ recordingId: string; atMs: number }>;
}

/** What a measured grade carries (`proof.grade` metadata and `verdictMetric.evidence`). */
export interface ProofEvidence {
  sampleN: number;
  successN: number;
  threshold: ProofThreshold;
  value: number;
  releaseKeys: string[];
  recordingIds: string[];
  /** Only on `missed`; trimmed first under the ledger's metadata ceiling. */
  patterns: ProofPattern[];
}

/** `GET /api/realizations/:id/measure` — the scoreboard's one read. */
export interface ProofEvaluationDto {
  realizationId: string;
  /** The proof's own hosted Insights site; null before the proof is published. */
  siteId: string | null;
  measure: ProofMeasure;
  sampleN: number;
  sampleMin: number;
  sampleReached: boolean;
  successN: number;
  value: number;
  threshold: ProofThreshold;
  status: ProofStatus;
  /** ISO; null until the first sampled visit. */
  windowStartedAt: string | null;
  windowEndsAt: string | null;
  releaseKeys: string[];
  /** ≤ {@link PROOF_EVIDENCE_RECORDINGS} sampled recordings that did NOT succeed. */
  evidenceRecordingIds: string[];
  /** Cited patterns over the non-converting sample, once the grade is `missed`. */
  patterns: ProofPattern[];
}

/** `GET /api/realizations/journey-signal` — the founder's Make / Measure position. */
export interface ProofJourneySignalDto {
  stage: 'make' | 'measure' | null;
  realizationId: string | null;
}

/**
 * The filter for "the visitors who didn't": the sample, minus the success event.
 * A funnel success has no single-clause negation, so its non-converting filter is
 * the sample itself (the funnel view then shows where they dropped).
 */
export function nonConvertingFilter(measure: ProofMeasure): ReplayFilter {
  if (measure.success.kind !== 'smartEvent') return { all: [...measure.sample.filter.all] };
  return { all: [...measure.sample.filter.all, { field: 'smartEvent', op: 'neq', value: measure.success.ref }] };
}
