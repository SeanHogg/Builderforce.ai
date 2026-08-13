/**
 * Trigger evaluation — the board's ability to speak first.
 *
 * A canvas that only answers when asked makes the founder the scheduler: they have to
 * remember to open the board and re-read the number. `trigger` binds a threshold to a
 * `liveMetric` on the same board, and this is the comparison that decides whether it has
 * been breached.
 *
 * ── WHY THE COMPARISON LIVES HERE AND NOT IN THE TOOL ────────────────────────────
 * The same evaluation has to run from three places — the `canvas_evaluate_triggers`
 * tool, the metric refresh (a new value must re-arm or breach its watchers immediately,
 * or the board shows a fresh number beside a stale "armed"), and the trigger card's own
 * action. Three call sites is exactly the threshold at which a rule gets copied and one
 * copy drifts, so the rule is one pure function and all three call it.
 */

/** How a threshold is tested. `changes-by` compares against the previous observation
 *  rather than an absolute level — the shape of "tell me if burn moves at all". */
export type TriggerComparator = 'below' | 'above' | 'equals' | 'changes-by';

export const TRIGGER_COMPARATORS: readonly TriggerComparator[] = ['below', 'above', 'equals', 'changes-by'];

export type TriggerState = 'armed' | 'breached' | 'muted' | 'unbound';

export interface TriggerEvaluation {
  state: TriggerState;
  /** The value tested, when one was found. */
  observed: number | null;
  /** Model- and user-facing reason. Says WHY, including why it could not evaluate. */
  reason:
    | 'breached'
    | 'within-threshold'
    | 'muted'
    | 'no-metric'
    | 'metric-has-no-value'
    | 'no-threshold'
    | 'no-previous-value';
}

/** Parse a number out of a value that may be a formatted string ("$1.2M", "14 months").
 *  Returns null rather than NaN so an unparseable value is a distinct, reportable state
 *  instead of a comparison that silently evaluates false. */
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
 * 14,000,000 — so a six-month runway alarm never fired, because a runway of "4.5
 * months" was read as 4.5 million and compared as comfortably above the threshold.
 * That is the exact silent failure a trigger exists to prevent, produced by the trigger
 * itself.
 */
const MAGNITUDE = /^(k|thousand|m|mm|million|b|bn|billion)\b/i;

const MAGNITUDE_FACTOR: Readonly<Record<string, number>> = {
  k: 1_000, thousand: 1_000,
  m: 1_000_000, mm: 1_000_000, million: 1_000_000,
  b: 1_000_000_000, bn: 1_000_000_000, billion: 1_000_000_000,
};

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
  const suffix = trimmed.slice(match.index! + token.length).trim().match(MAGNITUDE);
  return suffix ? base * (MAGNITUDE_FACTOR[suffix[1].toLowerCase()] ?? 1) : base;
}

export interface TriggerInput {
  comparator?: unknown;
  threshold?: unknown;
  state?: unknown;
  /** Latest value of the watched metric, if a metric was resolved. */
  metricValue?: unknown;
  /** Previous observation, for `changes-by`. */
  previousValue?: unknown;
  /** False when no metric object on the board matched `watches`. */
  metricFound: boolean;
}

export function evaluateTrigger(input: TriggerInput): TriggerEvaluation {
  if (input.state === 'muted') return { state: 'muted', observed: null, reason: 'muted' };
  if (!input.metricFound) return { state: 'unbound', observed: null, reason: 'no-metric' };

  const observed = numericValue(input.metricValue);
  if (observed == null) return { state: 'unbound', observed: null, reason: 'metric-has-no-value' };

  const threshold = numericValue(input.threshold);
  if (threshold == null) return { state: 'unbound', observed, reason: 'no-threshold' };

  const comparator = TRIGGER_COMPARATORS.includes(input.comparator as TriggerComparator)
    ? input.comparator as TriggerComparator
    : 'below';

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
