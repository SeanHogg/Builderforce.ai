/**
 * Plain-text cuts. Three shapes, each owned once:
 *
 *   • {@link keepTail}    — a capture BUFFER for a live process (the verdict prints last);
 *   • {@link cutHead}     — a result whose beginning is what matters, snapped to a line;
 *   • {@link cutHeadTail} — a log: the command's start AND its end (where test/build
 *                           summaries live), with an explicit elision marker between.
 */

/** Keep the last `max` chars — a rolling capture buffer. */
export function keepTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

export interface CutHeadOptions {
  /** Appended after the kept head so the model knows content was cut. */
  suffix?: string;
  /** Floor on the kept head, even when `maxChars` is smaller. */
  minKeep?: number;
  /** Snap the cut back to a newline when one lies within this fraction of the budget. */
  snap?: number;
  /** Returned when the budget cannot hold even the suffix. Defaults to the trimmed suffix. */
  emptyNotice?: string;
}

export const DEFAULT_TRUNCATION_SUFFIX =
  "\n\n⚠️ [Content truncated — original was too large for the model's context window. " +
  'The content above is a partial view. If you need more, request specific sections or use ' +
  'offset/limit parameters to read smaller chunks.]';

/** Keep the head of `text` within `maxChars` (suffix included), cut at a line boundary when one is near. */
export function cutHead(text: string, maxChars: number, opts: CutHeadOptions = {}): string {
  if (text.length <= maxChars) return text;
  const suffix = opts.suffix ?? DEFAULT_TRUNCATION_SUFFIX;
  const snap = opts.snap ?? 0.8;
  const keep = Math.max(opts.minKeep ?? 0, maxChars - suffix.length);
  if (keep <= 0) return opts.emptyNotice ?? suffix.trim();
  let cutPoint = keep;
  const lastNewline = text.lastIndexOf('\n', keep);
  if (lastNewline > keep * snap) cutPoint = lastNewline;
  return text.slice(0, cutPoint) + suffix;
}

export interface CutHeadTailOptions {
  /** Share of the budget given to the head; the rest goes to the tail. */
  headShare?: number;
}

/** Room reserved for the elision marker. */
const MARKER_RESERVE = 160;

function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Keep the head and the tail of `text` within `maxChars`, both snapped to line
 * boundaries, with a marker that says exactly how much was elided. The tail gets the
 * larger share by default: a build or test run prints its verdict at the end.
 */
export function cutHeadTail(text: string, maxChars: number, opts: CutHeadTailOptions = {}): string {
  if (text.length <= maxChars) return text;
  const budget = maxChars - MARKER_RESERVE;
  if (budget <= 0) return keepTail(text, Math.max(0, maxChars));
  const headShare = Math.min(1, Math.max(0, opts.headShare ?? 0.25));
  const headBudget = Math.floor(budget * headShare);
  const tailBudget = budget - headBudget;

  let headEnd = headBudget;
  const nl = text.lastIndexOf('\n', headBudget);
  if (nl > headBudget * 0.8) headEnd = nl;

  let tailStart = text.length - tailBudget;
  const nextNl = text.indexOf('\n', tailStart);
  if (nextNl >= 0 && nextNl - tailStart < tailBudget * 0.2) tailStart = nextNl + 1;

  const head = text.slice(0, headEnd);
  const tail = text.slice(tailStart);
  const elided = text.slice(headEnd, tailStart);
  const marker = `\n…[${elided.length.toLocaleString('en-US')} chars (${countLines(elided).toLocaleString('en-US')} lines) elided — showing the first ${head.length.toLocaleString('en-US')} and the last ${tail.length.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} chars]…\n`;
  return `${head}${marker}${tail}`;
}
