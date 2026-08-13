/**
 * Assessment mode — the switch that lets the canvas ADMINISTER an exam, not just
 * author one.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * The product ships an assistant that can author any object on the board. Handed to a
 * student sitting a test, it sits the test. There was no way to say otherwise, so
 * every summative use of the platform was blocked on a control that did not exist —
 * a teacher could build a beautiful assessment and could never run one.
 *
 * ── WHY THE GATE IS COMPUTED HERE AND NOWHERE ELSE ───────────────────────────────
 * Three surfaces can reach the assistant on a distributed board — the canvas prompt,
 * the Brain dock and the per-object actions — and a rule implemented three times is a
 * rule with two holes in it. `assessmentGate` is the single evaluator; a surface asks
 * it and renders the answer. That is the same shape as the platform's plan gate: ONE
 * evaluator, and a miss is a refusal rather than a silent allow.
 *
 * ── WHY EXTRA TIME IS ARITHMETIC AND NOT A CHECKBOX ──────────────────────────────
 * An accommodation of "25% extra time" is worthless if a human has to apply it to each
 * learner's deadline, because that is the step that gets forgotten under pressure and
 * the failure is invisible until an appeal. `effectiveDeadline` computes it from the
 * approved accommodation, so the deadline a learner sees IS their deadline.
 */

import { ASSESSMENT_MODES, isAssessmentMode, type AssessmentMode } from '@builderforce/creation-canvas-contract';

export { ASSESSMENT_MODES, isAssessmentMode };
export type { AssessmentMode };

const text = (value: unknown, limit = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const number = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null;
};

/** The mode an object declares, defaulting to `open` — every existing board is open,
 *  and a silent upgrade to a restricted mode would break them. */
export function assessmentModeOf(data: Readonly<Record<string, unknown>>): AssessmentMode {
  return isAssessmentMode(data.assessmentMode) ? data.assessmentMode : 'open';
}

/**
 * The strictest mode declared anywhere on the board.
 *
 * Strictest wins, deliberately. A board carrying one closed-book assignment and one
 * open one must be closed while that exam is open — the alternative is a student
 * opening the assistant "for the other assignment" mid-exam, which is not a
 * distinction any invigilator could enforce.
 */
export function boardAssessmentMode(nodes: readonly Readonly<Record<string, unknown>>[]): AssessmentMode {
  let mode: AssessmentMode = 'open';
  for (const data of nodes) {
    const candidate = assessmentModeOf(data);
    if (candidate === 'closed') return 'closed';
    if (candidate === 'assisted') mode = 'assisted';
  }
  return mode;
}

export interface AssessmentGate {
  mode: AssessmentMode;
  /** May the assistant author or answer at all? */
  assistantAllowed: boolean;
  /** Must every assistant turn be written to the learner's integrity ledger? */
  recordsAssistance: boolean;
  /** Why the assistant is unavailable, as a message key. Null when it is available. */
  refusalCode: 'closedBook' | null;
}

/** THE evaluator. Every surface that can reach the assistant asks this. */
export function assessmentGate(mode: AssessmentMode): AssessmentGate {
  switch (mode) {
    case 'closed':
      return { mode, assistantAllowed: false, recordsAssistance: true, refusalCode: 'closedBook' };
    case 'assisted':
      return { mode, assistantAllowed: true, recordsAssistance: true, refusalCode: null };
    default:
      return { mode, assistantAllowed: true, recordsAssistance: false, refusalCode: null };
  }
}

// ---------------------------------------------------------------------------
// Windows and deadlines
// ---------------------------------------------------------------------------

export type WindowState = 'beforeRelease' | 'open' | 'closed';

/**
 * Whether an assessment is currently open.
 *
 * `now` is a parameter rather than read from the clock so the state is a pure function
 * of its inputs — a timed assessment whose state depends on an ambient clock cannot be
 * tested, and an untested exam window is one that opens at the wrong hour.
 */
export function windowState(
  data: Readonly<Record<string, unknown>>,
  now: number,
  extraTimePercent = 0,
): WindowState {
  const release = Date.parse(text(data.releaseAt, 60));
  const due = effectiveDeadline(data.dueAt, extraTimePercent, number(data.durationMinutes) ?? undefined);
  if (Number.isFinite(release) && now < release) return 'beforeRelease';
  if (due != null && now > due) return 'closed';
  return 'open';
}

/**
 * The deadline that applies to ONE learner, with their approved extra time.
 *
 * Extra time extends the DURATION of a timed assessment, not the wall-clock deadline of
 * an untimed one — 25% extra on a 2-hour exam is 30 minutes, and 25% of "due on the
 * 14th" is meaningless. So when a duration is known the extension is computed from it;
 * otherwise the deadline stands and the accommodation is applied by the late policy
 * instead. Getting this backwards hands a coursework student six extra days.
 */
export function effectiveDeadline(
  dueAt: unknown,
  extraTimePercent = 0,
  durationMinutes?: number,
): number | null {
  const due = Date.parse(text(dueAt, 60));
  if (!Number.isFinite(due)) return null;
  if (!extraTimePercent || extraTimePercent <= 0) return due;
  if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return due;
  return due + (durationMinutes * (extraTimePercent / 100)) * 60_000;
}

/**
 * The extra time one learner is entitled to, read off the approved accommodations.
 *
 * Takes the MAXIMUM rather than the sum: two accommodations granting 25% each do not
 * make 50%, and summing them is how a board silently doubles an entitlement nobody
 * approved.
 */
export function extraTimeFor(
  learnerRef: string,
  accommodations: readonly Readonly<Record<string, unknown>>[],
  now = Date.now(),
): number {
  let best = 0;
  for (const data of accommodations) {
    if (text(data.kind) !== 'accommodation') continue;
    if (text(data.learnerRef, 120) !== learnerRef) continue;
    const expires = Date.parse(text(data.expiresAt, 60));
    if (Number.isFinite(expires) && expires < now) continue;
    if (text(data.evidenceHeld).toLowerCase().startsWith('pending')) continue;
    best = Math.max(best, number(data.extraTimePercent) ?? 0);
  }
  return best;
}
