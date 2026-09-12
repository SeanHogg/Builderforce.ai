/**
 * The shared shaping every career analyzer uses — meters, grades, input readers and
 * the recommendation fragments that recur across tools.
 *
 * Pure and copy-parameterised: every function that produces reader-facing text is
 * handed the `c` lookup rather than reaching for a locale, so an analyzer stays a
 * pure function of its input (see the header of `../careerTools.ts`).
 */
import { enumSlug, pluralSlug, type ToolCopy } from '../analyzerCopy';
import type { ToolMetric, ToolRecommendation, ToolResult } from '../toolTypes';

/** 0..100 → the 1..5 tier the shared meter colours by. */
export const tier = (pct: number): number =>
  pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= 60 ? 3 : pct >= 40 ? 2 : 1;

/** The letter people recognise from an ATS score, not an invented scale. Left
 *  untranslated on purpose: A/B/C grading is read as the American academic scale
 *  it borrows, and a localized letter would be a different measurement. */
export const grade = (pct: number): string =>
  pct >= 93 ? 'A' : pct >= 90 ? 'A−' : pct >= 87 ? 'B+' : pct >= 83 ? 'B'
    : pct >= 80 ? 'B−' : pct >= 77 ? 'C+' : pct >= 73 ? 'C' : pct >= 70 ? 'C−'
      : pct >= 60 ? 'D' : 'F';

/** A percentage renders in the reader's numbering, which is not always Latin. */
export const pctMetric = (c: ToolCopy, label: string, pct: number, hint?: string): ToolMetric =>
  ({ label, value: `${Math.round(pct).toLocaleString(c.locale)}%`, hint, tier: tier(pct) });

export const countMetric = (label: string, value: number | string, hint?: string): ToolMetric =>
  ({ label, value: String(value), hint });

/** A list rendered into one metric, or an honest "none" rather than an empty row. */
export const listMetric = (c: ToolCopy, label: string, items: readonly string[], empty: string): ToolMetric =>
  ({ label, value: items.length ? items.slice(0, 12).join(', ') : empty, hint: items.length > 12 ? c('andMore', { n: items.length - 12 }) : undefined });

export const text = (values: Record<string, string>, id: string): string => (values[id] ?? '').trim();

export const num = (values: Record<string, string>, id: string): number | undefined => {
  const raw = text(values, id).replace(/[^0-9.]/g, '');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Every analyzer answers the same way when handed nothing.
 *
 * The headline is shared; the sentence under it is the analyzer's OWN
 * `needsInput` slug rather than a shared template with a "what to paste"
 * fragment spliced in. That split is the placeholder rule applied honestly: "a
 * résumé and a job description" is a noun phrase that has to agree with the verb
 * around it, so the whole sentence belongs to the analyzer that says it.
 */
export const needsInput = (c: ToolCopy): ToolResult => ({
  headline: c('nothingToRead'),
  summary: c('needsInput'),
  score: null,
  scoreLabel: null,
  metrics: [],
  recommendations: [],
});

/** The instruction every career reading carries — the caller's next move. */
export const instructionRec = (c: ToolCopy, instruction: string): ToolRecommendation[] =>
  instruction ? [{ title: c('howToUseThis'), detail: instruction, priority: 'low' }] : [];

/** The four match verdicts, in the reader's language. Shared by the tailor and
 *  the job–résumé match, which both surface the same domain value. */
export const verdictText = (c: ToolCopy, verdict: string): string => c(enumSlug('verdict', verdict));

/** A counted phrase: `{n} skill` / `{n} skills`, chosen by the count. */
export const counted = (c: ToolCopy, slug: string, n: number, vars?: Record<string, string | number>): string =>
  c(pluralSlug(slug, n), { n, ...vars });

/** One quoted excerpt, elided at the length a title can carry. */
export const excerpt = (value: string, max = 70): string => `${value.slice(0, max)}${value.length > max ? '…' : ''}`;
