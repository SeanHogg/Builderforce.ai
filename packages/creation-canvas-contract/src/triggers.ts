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
// A contract's obligations, as a deadline
// ---------------------------------------------------------------------------

/**
 * One row of a `contract`'s `obligations` table, reduced to what a countdown needs.
 *
 * `due` is the ISO string VERBATIM rather than the parsed instant, because the value a
 * trigger is judged against and the value a card prints have to be the same characters —
 * a countdown that reports a date the row does not contain is a second answer.
 */
export interface OpenObligation {
  /** The obligation's identity — what an `invoice` or a `bill` names in `obligationRef`. */
  reference: string;
  /** What is owed, for a sentence a reader recognises. Falls back to `reference`. */
  obligation: string;
  /** The row's `due`, verbatim. */
  due: string;
  /** `due` parsed, so a caller ordering several rows does not parse each one twice. */
  dueMs: number;
}

/**
 * The obligation statuses that are FINISHED, and are therefore not owed any more.
 *
 * `met` and `waived` and nothing else. `invoiced` is deliberately NOT here: an invoice
 * having been raised is not the money having arrived, and retiring the countdown at the
 * moment a document was created would silence exactly the obligations most likely to be
 * forgotten — the ones already half-actioned. `breached` stays live for the same reason
 * a missed deadline stays overdue rather than re-arming: it is still owed, and it is
 * worse news than it was yesterday.
 */
const SETTLED_OBLIGATION_STATUSES: ReadonlySet<string> = new Set(['met', 'waived']);

/**
 * The next obligation on a contract that somebody still owes something on.
 *
 * ── WHY THIS IS AN ENGINE FUNCTION AND NOT A CARD DERIVATION ────────────────────
 * `contract.obligations` is the one deadline in this vocabulary that lives in ROWS
 * rather than in a field. Every other watchable date — `renewsAt`, `dueAt`, `cliffAt` —
 * is a column the server sweep can read straight off a saved row, which is why the
 * equity projection WRITES `cliffAt` onto the card instead of computing it at render
 * time. An obligation has no projection to write it: the rows are authored on the board
 * directly. So the choice was between a date the card shows and the sweep cannot see —
 * the "armed on screen, breached in a digest" drift this module exists to prevent — and
 * teaching the ENGINE to read it. This is that, and the frontend's `nextObligationAt`
 * field calls this same function, so there is one rule and not two.
 *
 * ── WHAT IT DOES NOT DO: ROLL A CADENCE FORWARD ─────────────────────────────────
 * A `monthly` obligation whose `due` is six months past does NOT advance to next month.
 * It reports six months overdue, which is what it is. Projecting the next instance would
 * invent a date the contract does not state and would silently convert a missed
 * obligation into a comfortable future one — the exact failure a countdown exists to
 * make impossible.
 */
export function nextOpenObligation(data: Record<string, unknown>): OpenObligation | null {
  const rows = Array.isArray(data.obligations) ? data.obligations : [];
  let best: OpenObligation | null = null;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (SETTLED_OBLIGATION_STATUSES.has(String(row.status ?? '').trim().toLowerCase())) continue;
    const due = String(row.due ?? '').trim();
    const dueMs = dateValue(due);
    if (dueMs === null) continue;
    if (best && best.dueMs <= dueMs) continue;
    const reference = String(row.reference ?? '').trim();
    best = {
      reference,
      obligation: String(row.obligation ?? '').trim() || reference,
      due,
      dueMs,
    };
  }
  return best;
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
  // `nextObligationAt` follows `renewsAt` DELIBERATELY. A contract carries both, and a
  // board authored before this existed watches the renewal — putting the obligation first
  // would silently repoint every trigger already on a contract at a different date. The
  // renewal stays the default; an author who wants the obligation clock says so with
  // `watchesField`, which is the field that exists for a kind with two deadlines.
  'dueAt', 'renewsAt', 'nextObligationAt', 'closeTarget', 'cliffAt', 'maturesAt', 'reviewAt', 'deadlineAt', 'nextActionAt', 'expiresAt',
];

/**
 * The deadline fields that are COMPUTED from the watched object rather than stored on it.
 *
 * One entry, and the bar for a second is high: a virtual deadline is a date no saved row
 * contains, so nothing can drag it, edit it, or write it back. It earns its place only
 * where the date genuinely lives in rows — see {@link nextOpenObligation} for why a
 * contract's obligations are that case and `cliffAt` is not.
 */
const VIRTUAL_DEADLINES: Readonly<Record<string, (data: Record<string, unknown>) => OpenObligation | null>> = {
  nextObligationAt: nextOpenObligation,
};

/** Whether a deadline field is computed rather than stored — so a caller that WRITES a
 *  date back (a calendar drag) can refuse instead of authoring a field nothing reads. */
export function isVirtualDeadlineField(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(VIRTUAL_DEADLINES, name);
}

/**
 * The value of one deadline field on one object.
 *
 * THE accessor, so the sweep, the canvas tool and the calendar cannot disagree about
 * where a date comes from. A virtual field is computed and a stored one is read; the
 * virtual map wins on its own names, which is what stops a stray `nextObligationAt`
 * authored onto a card from shadowing the rows it is supposed to summarise.
 */
export function deadlineValueOf(data: Record<string, unknown>, field: string): unknown {
  const virtual = VIRTUAL_DEADLINES[field];
  return virtual ? virtual(data)?.due : data[field];
}

/**
 * What a virtual deadline is a deadline FOR, in a clause a reader recognises.
 *
 * Null for a stored field, whose own name already says it ("renewsAt"). A contract with
 * four obligations breaching on the third needs the row named: "due in 3 days
 * (nextObligationAt)" sends somebody to open the board to find out which one, which is
 * the round trip the sweep exists to remove.
 */
export function deadlineDetailOf(data: Record<string, unknown>, field: string): string | null {
  const virtual = VIRTUAL_DEADLINES[field];
  if (!virtual) return null;
  const row = virtual(data);
  if (!row) return null;
  return row.obligation && row.reference && row.obligation !== row.reference
    ? `obligation "${row.obligation}" (${row.reference})`
    : `obligation "${row.obligation || row.reference}"`;
}

/**
 * Which field on a watched object carries its deadline.
 *
 * `watchesField` wins when the author named one — a kind with two deadlines needs a way
 * to say which — and otherwise the first declared name actually PRESENT on the object is
 * used. "Present" means non-empty: an object with an empty `dueAt` and a filled
 * `renewsAt` resolves to the renewal rather than reporting no deadline, which is the
 * shape a half-filled card actually has. Presence is read through
 * {@link deadlineValueOf}, so a computed deadline counts as present exactly when it
 * resolves to a date — a contract whose obligations are all met has none.
 */
export function resolveDeadlineField(
  data: Record<string, unknown>,
  watchesField?: unknown,
): string | null {
  const named = typeof watchesField === 'string' ? watchesField.trim() : '';
  if (named) return named;
  return DEADLINE_FIELD_NAMES.find((name) => {
    const value = deadlineValueOf(data, name);
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
  /**
   * What a COMPUTED deadline is a deadline for — the obligation row behind a
   * `nextObligationAt`. Null for a stored field, whose name says it already. Carried on
   * the result rather than re-derived by each reporter, because the sweep writes its
   * digest line after the board is out of scope.
   */
  deadlineDetail: string | null;
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
      deadlineValue: deadlineField && watched ? deadlineValueOf(watched.data, deadlineField) : undefined,
      nowMs,
    });

    return {
      triggerId: trigger.id,
      triggerTitle: trigger.title,
      watchedId: watched?.id ?? null,
      watchedTitle: watched?.title ?? null,
      watchedKind: watched?.kind ?? null,
      deadlineField,
      deadlineDetail: deadlineField && watched ? deadlineDetailOf(watched.data, deadlineField) : null,
      comparator: typeof trigger.data.comparator === 'string' ? trigger.data.comparator : null,
      threshold: trigger.data.threshold ?? null,
      thenDo: Array.isArray(trigger.data.thenDo) ? trigger.data.thenDo : [],
      evaluation,
    };
  });
}
