/**
 * Derive what a learned-memory row should SAY about its own provenance — the single
 * source of truth shared by the web console's recent list and the frontend's
 * <EvermindLearnings> detail panel, so the two can never disagree about whether a
 * teach-a-task actually learned anything.
 *
 * The distinction that matters: a "Taught" row is only meaningful when a frontier
 * TEACHER answered the task and the SSM learned that answer. When a pinned teacher
 * produces nothing, the coordinator falls back to adapting on the raw input — which,
 * for a teach-a-task, IS the question. Presenting that as "Learned" makes the model
 * look like it echoed the question back as its own answer. This helper is what turns
 * that silent fallback into a visible, named fault.
 */

/** Why distillation didn't happen (mirrors the API's `TeacherSkipReason`, plus the
 *  `unknown` bucket for rows written before the reason was recorded). */
export type EvermindTeacherSkipReason =
  | 'not_pinned'
  | 'budget_exhausted'
  | 'input_too_short'
  | 'gateway_error'
  | 'empty_output'
  | 'exception'
  | 'unknown';

/** The provenance verdict for one learned memory. */
export type EvermindLearnedStatus =
  /** A pre-diffed weight delta — no text provenance to report. */
  | { state: 'delta' }
  /** A frontier teacher answered and the model learned that answer. The good path. */
  | { state: 'distilled'; teacherModel?: string }
  /** No teacher pinned: the model self-learned from real run output. Normal, not a fault. */
  | { state: 'self' }
  /** A teacher WAS pinned but produced nothing — actionable, surfaced as a warning. */
  | { state: 'fault'; reason: EvermindTeacherSkipReason; teacherModel?: string; detail?: string };

/** The subset of a recent entry this verdict reads (structural, so both hosts' entry
 *  types satisfy it without importing each other). */
export interface LearnedStatusInput {
  kind: 'text' | 'delta';
  prompt?: string;
  text?: string;
  distilled?: boolean;
  teacherModel?: string;
  skipReason?: string;
  skipDetail?: string;
  attemptedTeacherModel?: string;
}

export function evermindLearnedStatus(entry: LearnedStatusInput): EvermindLearnedStatus {
  if (entry.kind === 'delta') return { state: 'delta' };
  if (entry.distilled) {
    return { state: 'distilled', ...(entry.teacherModel ? { teacherModel: entry.teacherModel } : {}) };
  }

  if (entry.skipReason) {
    // A teacher was never pinned → self-learning, which is a legitimate mode.
    if (entry.skipReason === 'not_pinned') return { state: 'self' };
    return {
      state: 'fault',
      reason: entry.skipReason as EvermindTeacherSkipReason,
      ...(entry.attemptedTeacherModel ? { teacherModel: entry.attemptedTeacherModel } : {}),
      ...(entry.skipDetail ? { detail: entry.skipDetail } : {}),
    };
  }

  // LEGACY rows (merged before the outcome was recorded) carry no provenance at all.
  // Infer the one case we can prove: text identical to the prompt is the echo a failed
  // teacher leaves behind — report it rather than passing the question off as an answer.
  const prompt = entry.prompt?.trim();
  const text = entry.text?.trim();
  if (prompt && text && prompt === text) return { state: 'fault', reason: 'unknown' };
  return { state: 'self' };
}
