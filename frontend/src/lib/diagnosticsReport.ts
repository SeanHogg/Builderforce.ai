/**
 * diagnosticsReport — the shared spine of every pasteable "Copy diagnostics" report.
 *
 * The ticket lifecycle report ({@link ./lifecycleDiagnostics}) and the AI Manager report
 * ({@link ./managerDiagnostics}) answer different questions but have the SAME failure
 * modes, and every one of them was solved once already:
 *
 *  • a report that does not FIT is truncated by whatever it is pasted into, and what it
 *    loses is the tail — the most recent, most relevant rows;
 *  • a report that elides SILENTLY reads as complete, which is worse than a long one;
 *  • a report with no build stamp is unfalsifiable: a capture taken minutes before a
 *    deploy is indistinguishable from one taken after, so a fixed bug reads as unfixed;
 *  • an absent value DROPPED is indistinguishable from a value that is genuinely empty.
 *
 * So the environment block, the `key: value` convention, the consecutive-run collapse,
 * the head+tail window and the budget-aware JSON appendix live here once. A new report
 * gets all of it by composing these, and can never disagree with the others about what
 * "(none)" means or where the version block goes.
 *
 * PURE — no clipboard, no DOM, no clock, no i18n. Report bodies are deliberately
 * locale-independent English: they are technical artefacts for diagnosis (the BUTTON
 * around them is localized). {@link ./diagnosticsCapture} owns the impure capture.
 */

/** Build + capture provenance every report carries, ABOVE its payload. */
export interface DiagnosticsContext {
  /** Frontend build that rendered this (APP_VERSION). */
  uiVersion?: string | null;
  /** API build that served the data, when the page knows it. */
  apiVersion?: string | null;
  /** ISO timestamp of the capture. Passed in rather than read from the clock so every
   *  builder stays pure and testable — and so "now" is one instant for the whole report. */
  capturedAt: string;
  /** Absolute URL of the surface the capture was taken from, when available. */
  sourceUrl?: string | null;
}

/**
 * Per-row cap on free-form server text (an error message, a skip explanation).
 *
 * Row COUNT is bounded by the window; row LENGTH is not — one stack trace or one 4 KB
 * provider error would blow the budget on its own. The cap keeps a whole error sentence,
 * and the overflow is always announced with the count of characters dropped so nobody
 * mistakes it for the full text.
 */
export const MAX_DETAIL_CHARS = 300;

/**
 * Total size a report aims to stay under, in characters.
 *
 * When a report would exceed it, the appended raw JSON drops its unbounded array(s) —
 * already rendered (collapsed and windowed) above. Every computed block survives, so the
 * JSON stays re-parseable and the whole diagnosis still fits in a paste. 50 000 is the
 * smallest limit these reports actually meet in practice, so the budget sits below it
 * with room for the JSON that replaces the elided rows.
 */
export const REPORT_BUDGET_CHARS = 45_000;

/** `key: value` with absent values written explicitly, never silently dropped. */
export function line(label: string, value: unknown): string {
  const v = value === null || value === undefined || value === ''
    ? '(none)'
    : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  return `${label}: ${v}`;
}

/** Cap free-form text, ANNOUNCING the overflow — an unannounced truncation of an error
 *  message is exactly the kind of quiet loss these reports exist to avoid.
 *
 *  Coerced rather than trusted: these bodies come from a server row or a restored local
 *  snapshot, and one legacy entry with a missing/non-string body used to throw here and
 *  take the WHOLE report down — the report that exists to explain what went wrong being
 *  the thing that cannot be produced. A wrong-shaped body degrades to its own text. */
export function capText(text: string, max: number = MAX_DETAIL_CHARS): string {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text);
  return value.length > max ? `${value.slice(0, max)}… (+${value.length - max} chars)` : value;
}

/**
 * The environment block. FIRST in every report, deliberately: it is the block most
 * likely to be lost when a long report is cut short, and every number below it is
 * meaningless without knowing which build produced them.
 *
 * `extra` appends report-specific identity pairs (a project id, a tenant) to the same
 * block rather than inventing a second one.
 */
export function environmentLines(
  ctx: DiagnosticsContext,
  extra: ReadonlyArray<[string, unknown]> = [],
): string[] {
  return [
    '-- Environment --',
    line('capturedAt', ctx.capturedAt),
    line('uiVersion', ctx.uiVersion),
    line('apiVersion', ctx.apiVersion),
    line('sourceUrl', ctx.sourceUrl),
    ...extra.map(([label, value]) => line(label, value)),
  ];
}

/** One run of strictly-consecutive identical rows, collapsed. */
export interface CollapsedRun<T> {
  item: T;
  /** How many identical rows this stands for (1 = not collapsed). */
  repeats: number;
  /** Stamp of the LAST row in the run, so a collapse still bounds its time span. */
  lastStamp: string;
}

/**
 * Collapse strictly-consecutive identical rows.
 *
 * `signature` must ignore the fields that VARY between two occurrences of one repeated
 * fact (the timestamp, the row id) — including them would defeat the collapse entirely.
 * Only CONSECUTIVE rows merge: a collapse must never reorder history or hide that a
 * different event happened in between.
 */
export function collapseRuns<T>(
  items: readonly T[],
  signature: (item: T) => string,
  stamp: (item: T) => string,
): Array<CollapsedRun<T>> {
  const out: Array<CollapsedRun<T>> = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && signature(prev.item) === signature(item)) {
      prev.repeats += 1;
      prev.lastStamp = stamp(item);
      continue;
    }
    out.push({ item, repeats: 1, lastStamp: stamp(item) });
  }
  return out;
}

/**
 * Bound an already-rendered row list to a head + tail window.
 *
 * A window rather than a plain truncation because BOTH ends are load-bearing: the head
 * says how things started, the tail says where they are now — and a tail-truncated report
 * is the specific failure this module exists to fix. Rows are rendered BEFORE windowing
 * so their numbering reflects their true position in the full list.
 *
 * The elision is always REPORTED via `note`, never silent.
 */
export function windowRows(
  rendered: readonly string[],
  opts: { head: number; tail: number; note: (elided: number) => string[] },
): string[] {
  if (rendered.length <= opts.head + opts.tail) return [...rendered];
  const head = rendered.slice(0, opts.head);
  const tail = rendered.slice(rendered.length - opts.tail);
  return [...head, ...opts.note(rendered.length - head.length - tail.length), ...tail];
}

/**
 * The raw JSON appendix — so the payload can be re-parsed without anyone re-deriving it
 * from prose.
 *
 * Dropped to `compact()` whenever keeping the full payload would push the WHOLE report
 * past {@link REPORT_BUDGET_CHARS}: the size that matters is the total, not the prose,
 * since it is the total that gets truncated. `compact` is a thunk so the (potentially
 * large) reduced copy is only built when it is actually needed.
 */
export function jsonAppendix(
  bodyChars: number,
  payload: unknown,
  opts: { compact: () => unknown; note: string },
): string[] {
  const full = JSON.stringify(payload, null, 2);
  if (bodyChars + full.length <= REPORT_BUDGET_CHARS) return ['-- Raw payload (JSON) --', full];
  return ['-- Raw payload (JSON) --', opts.note, JSON.stringify(opts.compact(), null, 2)];
}
