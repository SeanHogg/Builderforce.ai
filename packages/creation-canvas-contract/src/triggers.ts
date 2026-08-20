/**
 * THE trigger engine — what makes a board speak first.
 *
 * ── WHY IT LIVES IN THE CONTRACT AND NOT IN `frontend/src/lib` ───────────────────
 * It used to be a frontend module, and that placement was the reason the feature only
 * half existed. A trigger evaluated ONLY when a person opened the board and the model
 * chose to call `canvas_evaluate_triggers` — so "the board tells you before the contract
 * auto-renews" was true exactly when somebody was already looking, which is the one
 * circumstance in which they did not need telling.
 *
 * Making the server evaluate it too means two callers, and two callers is the threshold
 * at which a rule gets copied and one copy drifts. A comparator that breached on the
 * board and stayed armed in the nightly sweep would be worse than no sweep: the founder
 * would have two answers to "what needs my attention" and no way to know which lied. So
 * the comparison is ONE pure function, here, in the package both sides already alias.
 *
 * ── PURE BY CONSTRUCTION ────────────────────────────────────────────────────────
 * No React, no DB, no clock. `nowMs` is passed in so the same board evaluates identically
 * in the tool, in the sweep and in a test, and so a test can sit on a date boundary
 * without mocking global time. The CALLER resolves which object is watched and hands
 * over its value; this module decides. `canvasApprovalGate.ts` draws the same line for
 * the same reason.
 */

// ---------------------------------------------------------------------------
// Comparators
// ---------------------------------------------------------------------------

/**
 * How a threshold is tested.
 *
 * ── THE NUMERIC FOUR ─────────────────────────────────────────────────────────────
 * `below` / `above` / `equals` compare an absolute level. `changes-by` compares against
 * the previous observation rather than a level — the shape of "tell me if burn moves at
 * all".
 *
 * ── THE DATE TWO, AND WHY THEY ARE NOT `before`/`after` ──────────────────────────
 * A trigger exists to fire BEFORE the thing it watches goes wrong, and an absolute
 * `before <date>` cannot express that: it needs a second date, re-typed every period,
 * and it is stale the moment the contract renews. What a founder actually says is "warn
 * me thirty days before" and "chase it once it is a week late" — both RELATIVE to now,
 * both with the threshold as a number of DAYS, which is also what keeps the threshold
 * field one type across all six comparators.
 *
 *  • `due-within`  breached when the watched date is `threshold` days away OR CLOSER,
 *    including already past. The "warn me before" case. A renewal that slipped by
 *    without anyone looking must stay breached, not silently re-arm — which is exactly
 *    what an exclusive window would have done, and it is the failure the whole object
 *    exists to prevent.
 *  • `overdue-by`  breached only once the watched date is `threshold` days IN THE PAST.
 *    `0` means "the day after it lapses". The "chase it" case, and the reason the two
 *    are separate: an invoice due next week needs no action, and one a fortnight late
 *    needs a different action from the one three days late.
 */
export type TriggerComparator = 'below' | 'above' | 'equals' | 'changes-by' | 'due-within' | 'overdue-by';

export const TRIGGER_COMPARATORS: readonly TriggerComparator[] =
  ['below', 'above', 'equals', 'changes-by', 'due-within', 'overdue-by'];

/** The comparators that read a DATE off the watched object rather than a number. */
export const DATE_COMPARATORS: readonly TriggerComparator[] = ['due-within', 'overdue-by'];

/** True when this comparator watches a date. THE one test — the tool, the sweep and the
 *  card all ask it here rather than each keeping a copy of the pair. */
export function isDateComparator(value: unknown): boolean {
  return DATE_COMPARATORS.includes(value as TriggerComparator);
}

export type TriggerState = 'armed' | 'breached' | 'muted' | 'unbound';

export interface TriggerEvaluation {
  state: TriggerState;
  /**
   * The value tested, when one was found.
   *
   * For a numeric comparator this is the metric's value. For a date comparator it is
   * DAYS REMAINING — negative once the date is past — because that is the number a
   * person reads ("renews in 12 days", "9 days overdue") and the number the reply should
   * lead with. An epoch millisecond would have been the value tested and not the value
   * meant.
   */
  observed: number | null;
  /** Model- and user-facing reason. Says WHY, including why it could not evaluate. */
  reason:
    | 'breached'
    | 'within-threshold'
    | 'muted'
    | 'no-metric'
    | 'metric-has-no-value'
    | 'no-threshold'
    | 'no-previous-value'
    /** A date comparator was set and the watched object carries no deadline field. */
    | 'no-deadline-field'
    /** The deadline field exists and does not parse as a date. */
    | 'deadline-not-a-date';
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/**
 * The numeric token, most specific shape first.
 *
 *  1. group-separated  "1,200" · "1,200,000.50"   → commas are thousands separators
 *  2. comma decimal    "1200,50"                  → comma followed by one or two digits
 *  3. plain            "1200" · "1200.50" · "-3.5"
 *
 * Order is load-bearing. A single `[.,]` alternation read "$1,200" as 1.2 — the
 * thousands separator taken for a decimal point — which compares a $1,200 burn against
 * a $1,000 ceiling and reports it healthy by a factor of a thousand.
 *
 * KNOWN LIMIT: a European "1.234,56" is genuinely ambiguous without a locale, and this
 * resolves it US-style. A decimal comma is understood only WITHOUT a group separator
 * ("1200,50"). Documented rather than guessed at, because silently picking the wrong
 * convention on a money figure is the failure mode this whole function exists to avoid.
 */
const NUMERIC_TOKEN = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+,\d{1,2}(?!\d)|-?\d+(?:\.\d+)?/;

/**
 * Magnitude suffixes. A BARE letter or the written word only.
 *
 * Matching any word that merely STARTS with the letter turned "14 months" into
 * 14,000,000 — so a six-month runway alarm never fired, because a runway of "4.5 months"
 * was read as 4.5 million and compared as comfortably above the threshold. That is the
 * exact silent failure a trigger exists to prevent, produced by the trigger itself.
 */
const MAGNITUDE = /^(k|thousand|m|mm|million|b|bn|billion)\b/i;

const MAGNITUDE_FACTOR: Readonly<Record<string, number>> = {
  k: 1_000, thousand: 1_000,
  m: 1_000_000, mm: 1_000_000, million: 1_000_000,
  b: 1_000_000_000, bn: 1_000_000_000, billion: 1_000_000_000,
};

/** Parse a number out of a value that may be a formatted string ("$1.2M", "14 months").
 *  Returns null rather than NaN so an unparseable value is a distinct, reportable state
 *  instead of a comparison that silently evaluates false. */
export function numericValue(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(NUMERIC_TOKEN);
  if (!match) return null;
  const token = match[0];
  // A comma is a group separator when it is followed by exactly three digits; the
  // alternation above already guaranteed which branch matched, so this only has to
  // distinguish the two comma shapes.
  const literal = /,\d{3}/.test(token) ? token.replace(/,/g, '') : token.replace(',', '.');
  const base = Number(literal);
  if (!Number.isFinite(base)) return null;
  // `suffix[1]` is the capture group, which is only optional to the type system: the
  // pattern cannot match without it. Read defensively anyway, because this module is now
  // compiled under the API's stricter `noUncheckedIndexedAccess` as well as the
  // frontend's — and a `?? 1` here is the identity multiplier, not a silent wrong answer.
  const suffix = trimmed.slice((match.index ?? 0) + token.length).trim().match(MAGNITUDE);
  const magnitude = suffix?.[1] ? MAGNITUDE_FACTOR[suffix[1].toLowerCase()] ?? 1 : 1;
  return base * magnitude;
}

/** Milliseconds in a day. A calendar day, not a DST-corrected one: a renewal date is a
 *  date, and no deadline in this product is decided by an hour. */
const DAY_MS = 86_400_000;

/**
 * Parse a watched deadline into epoch ms.
 *
 * Deliberately strict about the SHAPE and lenient about the format: `Date.parse` accepts
 * everything the specs ask for (`2026-09-30`, `2026-09-30T17:00:00Z`) and also accepts a
 * bare number, which is the trap — `Date.parse('30')` is a valid date in some engines, so
 * a threshold typed into the wrong field would silently become a deadline. A value with
 * no `-` and no `/` is refused rather than guessed at.
 */
export function dateValue(raw: unknown): number | null {
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw.getTime() : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || !/[-/]/.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whole days from `now` until `deadline`. Negative once the deadline is past.
 *
 * `floor` throughout, so "0" means today and "-1" means yesterday — the reading a person
 * expects from a countdown, and the one that makes `overdue-by: 0` fire the day after.
 */
export function daysUntil(deadlineMs: number, nowMs: number): number {
  return Math.floor((deadlineMs - nowMs) / DAY_MS);
}

// ---------------------------------------------------------------------------
// Which field carries the deadline
// ---------------------------------------------------------------------------

/**
 * The deadline field names, in resolution order.
 *
 * ── WHY A NAME LIST AND NOT A KIND→FIELD MAP ────────────────────────────────────
 * The declaration lives with the field, on the spec (`SpecField.deadline` in
 * `frontend/src/lib/specObjects.ts`), which is what stops a new deadline-bearing kind
 * from needing an entry in a second file somebody forgets. But the SERVER sweep reads
 * saved `creation_session_objects` rows and cannot import the frontend registry, so it
 * needs the names on this side of the wire.
 *
 * A kind→field map would duplicate the whole vocabulary here. A NAME list does not: it
 * is the same handful of words across every kind (`dueAt` on an invoice, a bill, an
 * obligation, an assignment and a peer review), and `specDeadlineFields()` on the
 * frontend still resolves per kind from the declaration. `specObjects.test.ts` asserts
 * every field flagged `deadline` appears here and that nothing here is unused, so the
 * two cannot drift.
 *
 * ORDER MATTERS. An object carrying two of these resolves to the first, which is why
 * `renewsAt` precedes `expiresAt`: a contract's renewal is the date somebody is
 * ambushed by, and its expiry is usually the same day expressed differently.
 */
export const DEADLINE_FIELD_NAMES: readonly string[] = [
  // `cliffAt` precedes `maturesAt` on the same principle: a vesting cliff is the date a
  // founder is ambushed by, and it is the one an `equityGrant` carries. Both are written
  // onto their card by the equity projection rather than authored, so the sweep — which
  // reads saved rows and cannot run a derivation — sees the same date the card shows.
  // `nextActionAt` is a `legalMatter`'s filing deadline, hearing or response-by. It sits
  // after the ownership dates and before `expiresAt` for the same reason `renewsAt` does:
  // a matter that also carries an expiry is judged against the ACTION, and the expiry is
  // the consequence of missing it rather than a second thing to watch.
  'dueAt', 'renewsAt', 'closeTarget', 'cliffAt', 'maturesAt', 'reviewAt', 'deadlineAt', 'nextActionAt', 'expiresAt',
];

/**
 * Which field on a watched object carries its deadline.
 *
 * `watchesField` wins when the author named one — a kind with two deadlines needs a way
 * to say which — and otherwise the first declared name actually PRESENT on the object is
 * used. "Present" means non-empty: an object with an empty `dueAt` and a filled
 * `renewsAt` resolves to the renewal rather than reporting no deadline, which is the
 * shape a half-filled card actually has.
 */
export function resolveDeadlineField(
  data: Record<string, unknown>,
  watchesField?: unknown,
): string | null {
  const named = typeof watchesField === 'string' ? watchesField.trim() : '';
  if (named) return named;
  return DEADLINE_FIELD_NAMES.find((name) => {
    const value = data[name];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }) ?? null;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

export interface TriggerInput {
  comparator?: unknown;
  threshold?: unknown;
  state?: unknown;
  /** Latest value of the watched metric, if a metric was resolved. */
  metricValue?: unknown;
  /** Previous observation, for `changes-by`. */
  previousValue?: unknown;
  /** False when no object on the board matched `watches`. */
  metricFound: boolean;
  /**
   * The watched object's deadline, for a date comparator. Resolved by the CALLER through
   * {@link resolveDeadlineField} so this function stays pure and vocabulary-neutral.
   */
  deadlineValue?: unknown;
  /** Evaluation instant. Passed in rather than read here so the same board evaluates
   *  identically on the server sweep, in the tool, and in a test. */
  nowMs?: number;
}

export function evaluateTrigger(input: TriggerInput): TriggerEvaluation {
  if (input.state === 'muted') return { state: 'muted', observed: null, reason: 'muted' };
  if (!input.metricFound) return { state: 'unbound', observed: null, reason: 'no-metric' };

  const comparator = TRIGGER_COMPARATORS.includes(input.comparator as TriggerComparator)
    ? input.comparator as TriggerComparator
    : 'below';

  if (isDateComparator(comparator)) return evaluateDeadline(comparator, input);

  const observed = numericValue(input.metricValue);
  if (observed == null) return { state: 'unbound', observed: null, reason: 'metric-has-no-value' };

  const threshold = numericValue(input.threshold);
  if (threshold == null) return { state: 'unbound', observed, reason: 'no-threshold' };

  if (comparator === 'changes-by') {
    const previous = numericValue(input.previousValue);
    if (previous == null) return { state: 'armed', observed, reason: 'no-previous-value' };
    const breached = Math.abs(observed - previous) >= Math.abs(threshold);
    return { state: breached ? 'breached' : 'armed', observed, reason: breached ? 'breached' : 'within-threshold' };
  }

  const breached = comparator === 'below' ? observed < threshold
    : comparator === 'above' ? observed > threshold
    : observed === threshold;

  return { state: breached ? 'breached' : 'armed', observed, reason: breached ? 'breached' : 'within-threshold' };
}

/**
 * The date half.
 *
 * Split out rather than folded into the branch above because its `observed` means
 * something different (days remaining, not a level) and its unbound reasons are
 * different — and a reader who has to hold both meanings of one variable in mind is a
 * reader who introduces the bug where a threshold in days is compared against a value in
 * dollars.
 *
 * A MISSING THRESHOLD IS ZERO HERE, and that is the one asymmetry with the numeric path
 * worth defending: a numeric trigger with no threshold has nothing to compare against and
 * must say so, while a date trigger with no threshold has an obvious and safe reading —
 * "the day it passes" — and refusing to evaluate it would leave the most common authored
 * shape (`due-within` on a renewal, threshold forgotten) permanently unbound and silent.
 * Silence is the failure mode; a same-day warning is not.
 */
function evaluateDeadline(comparator: TriggerComparator, input: TriggerInput): TriggerEvaluation {
  if (input.deadlineValue === undefined || input.deadlineValue === null || String(input.deadlineValue).trim() === '') {
    return { state: 'unbound', observed: null, reason: 'no-deadline-field' };
  }
  const deadlineMs = dateValue(input.deadlineValue);
  if (deadlineMs == null) return { state: 'unbound', observed: null, reason: 'deadline-not-a-date' };

  const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const remaining = daysUntil(deadlineMs, nowMs);
  const days = Math.abs(numericValue(input.threshold) ?? 0);

  const breached = comparator === 'due-within'
    // `<=` so an already-past deadline stays breached rather than re-arming.
    ? remaining <= days
    : remaining < 0 && -remaining >= days;

  return {
    state: breached ? 'breached' : 'armed',
    observed: remaining,
    reason: breached ? 'breached' : 'within-threshold',
  };
}

// ---------------------------------------------------------------------------
// Board resolution — shared by the canvas tool and the server sweep
// ---------------------------------------------------------------------------

/** The minimum an object must expose to take part in an evaluation. Both callers have
 *  richer shapes; neither needs the other's. */
export interface TriggerBoardObject {
  id: string;
  kind: string;
  title: string;
  data: Record<string, unknown>;
}

export interface ResolvedTrigger {
  triggerId: string;
  triggerTitle: string;
  /** The object matched by `watches`, when one matched. */
  watchedId: string | null;
  watchedTitle: string | null;
  watchedKind: string | null;
  /** Which field the deadline was read from, for a date comparator. */
  deadlineField: string | null;
  comparator: string | null;
  threshold: unknown;
  /** What the author said should happen on breach. Carried through so a caller that
   *  reports a breach can name the action without re-reading the object. */
  thenDo: unknown[];
  evaluation: TriggerEvaluation;
}

/**
 * Match a `watches` string to an object on the board.
 *
 * Exact title first, then a containment fallback — a model that wrote "Acme MSA" for an
 * object titled "Acme MSA (2026)" meant that object, and refusing the match would report
 * `unbound` for a trigger a person would call correctly configured. Case- and
 * whitespace-insensitive for the same reason.
 *
 * A trigger never watches ITSELF, which the id guard enforces: without it a trigger
 * titled "Renewal" watching "Renewal" resolves to itself, reads no deadline, and reports
 * unbound for a reason nobody could see.
 */
function findWatched(
  board: readonly TriggerBoardObject[],
  trigger: TriggerBoardObject,
): TriggerBoardObject | null {
  const watches = String(trigger.data.watches ?? '').trim().toLowerCase();
  if (!watches) return null;
  const candidates = board.filter((node) => node.id !== trigger.id);
  return candidates.find((node) => node.title.trim().toLowerCase() === watches)
    ?? candidates.find((node) => node.title.trim().toLowerCase().includes(watches))
    ?? null;
}

/**
 * Evaluate every trigger on a board.
 *
 * THE one traversal. The canvas tool and the nightly sweep both call this, so a board
 * cannot report one thing on screen and another in a digest — the drift that made a
 * server-side sweep dangerous to add until the engine moved here.
 */
export function evaluateBoardTriggers(
  board: readonly TriggerBoardObject[],
  nowMs: number,
  options?: { onlyTriggerId?: string },
): ResolvedTrigger[] {
  const triggers = board.filter((node) => node.kind === 'trigger'
    && (!options?.onlyTriggerId || node.id === options.onlyTriggerId));

  return triggers.map((trigger) => {
    const watched = findWatched(board, trigger);
    const dateMode = isDateComparator(trigger.data.comparator);
    const deadlineField = dateMode && watched
      ? resolveDeadlineField(watched.data, trigger.data.watchesField)
      : null;
    const series = Array.isArray(watched?.data.series) ? watched.data.series as Array<Record<string, unknown>> : [];

    const evaluation = evaluateTrigger({
      comparator: trigger.data.comparator,
      threshold: trigger.data.threshold,
      state: trigger.data.state,
      metricValue: watched?.data.value,
      previousValue: series.length > 1 ? series[series.length - 2]?.value : undefined,
      metricFound: !!watched,
      deadlineValue: deadlineField ? watched?.data[deadlineField] : undefined,
      nowMs,
    });

    return {
      triggerId: trigger.id,
      triggerTitle: trigger.title,
      watchedId: watched?.id ?? null,
      watchedTitle: watched?.title ?? null,
      watchedKind: watched?.kind ?? null,
      deadlineField,
      comparator: typeof trigger.data.comparator === 'string' ? trigger.data.comparator : null,
      threshold: trigger.data.threshold ?? null,
      thenDo: Array.isArray(trigger.data.thenDo) ? trigger.data.thenDo : [],
      evaluation,
    };
  });
}
