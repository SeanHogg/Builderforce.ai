/**
 * The SHAPE a tool run is stored in — and why a stored result is not simply the
 * result.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * `tool_runs.result` is persisted JSON. A run saved by a German manager was
 * therefore German forever: an English teammate opening the same workspace
 * history read a scorecard in a language they may not have. Storing five
 * renderings would be five times the row and still wrong the day a sixth locale
 * ships, so the run has to carry something a reader can re-render FROM.
 *
 * ── TWO KINDS, TWO ANSWERS ──────────────────────────────────────────────────
 * `kind='self'` needs nothing from this module. Its `input` (the answers, the
 * calculator values) is already stored and is sufficient to re-score on read, so
 * `ToolService.listRuns` recomputes it in the reader's locale and the stored
 * result is only a fallback.
 *
 * `kind='data'` cannot be re-scored: it was computed from a telemetry WINDOW that
 * has since passed, and re-querying today would silently answer a different
 * question. So its chrome is separated from its figures at WRITE time — the
 * numbers go in as data (`figures`), and the labels, bands and plan are rendered
 * from the catalogs at READ time.
 *
 * ── WHY THE ENVELOPE IS A SUPERSET, NOT A WRAPPER ───────────────────────────
 * The obvious design is `{ v: 2, figures, result }`. It was rejected because
 * three other readers already `SELECT tool_runs.result` and cast it to
 * `ToolResult` — the ticket-audit ledger, the audit deep pass, and the project /
 * tenant rollups. A wrapper turns every one of those into a row that renders as
 * `undefined`, which is the "an old row must still render" failure pointed the
 * other way in time.
 *
 * So the envelope EXTENDS the result rather than containing it: the stored JSON
 * is still a complete, valid `ToolResult` (rendered in the default locale) with
 * two extra properties beside it. Every existing reader keeps working untouched,
 * a row written before this change has no `v` and renders exactly as it always
 * did, and the upgrade is lazy — a reader that understands `v` re-renders, one
 * that does not reads the result that is already there. No backfill, no
 * migration.
 */

import type { ToolResult } from './toolTypes';

/** Bump when `figures` changes shape in a way a reader cannot tolerate. Old rows
 *  keep their old `v` and fall back to their stored rendering, which is the whole
 *  point of writing that rendering down. */
export const TOOL_RESULT_ENVELOPE_VERSION = 2;

/**
 * What actually sits in `tool_runs.result`.
 *
 * `figures` is deliberately `unknown`: the payload's shape belongs to the data
 * provider that produced it, and this module must not become a place where every
 * provider's telemetry type is re-declared. The provider narrows it on the way
 * back out, and a payload it cannot narrow degrades to the stored rendering.
 */
export interface StoredToolResult extends ToolResult {
  /** Envelope version. ABSENT on every row written before this shipped. */
  v?: number;
  /** The numbers the chrome was rendered from — the half that is locale-free. */
  figures?: unknown;
}

/**
 * Pair a rendered result with the figures behind it, for storage.
 *
 * The rendering is kept because it is the only thing that can be shown when the
 * figures stop being re-renderable — a provider deleted, a payload whose shape
 * moved on. That is a fallback, never the normal path.
 */
export function withFigures(result: ToolResult, figures: unknown): StoredToolResult {
  return { ...result, v: TOOL_RESULT_ENVELOPE_VERSION, figures };
}

/**
 * The result to render when nothing better can be produced.
 *
 * Tolerant on purpose — it is handed a `jsonb` column, so it can be handed
 * anything, and a saved-history page must not 500 on one malformed row from an
 * old write path. A row that carries no usable result renders as an empty
 * scorecard, which reads as "nothing was recorded" rather than as an outage.
 */
export function storedResult(stored: unknown): ToolResult {
  if (!stored || typeof stored !== 'object') return EMPTY_RESULT;
  const { v: _v, figures: _figures, ...result } = stored as StoredToolResult;
  return {
    headline: typeof result.headline === 'string' ? result.headline : '',
    summary: typeof result.summary === 'string' ? result.summary : undefined,
    score: typeof result.score === 'number' ? result.score : null,
    scoreLabel: typeof result.scoreLabel === 'string' ? result.scoreLabel : null,
    metrics: Array.isArray(result.metrics) ? result.metrics : [],
    recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
  };
}

/**
 * The figures a row carries, or undefined for a row that predates the envelope
 * (or whose version this build does not understand). Undefined is the signal to
 * fall back to {@link storedResult} — never to throw, and never to re-query the
 * telemetry window, which has moved.
 */
export function storedFigures(stored: unknown): unknown {
  if (!stored || typeof stored !== 'object') return undefined;
  const envelope = stored as StoredToolResult;
  return envelope.v === TOOL_RESULT_ENVELOPE_VERSION ? envelope.figures : undefined;
}

const EMPTY_RESULT: ToolResult = {
  headline: '',
  summary: undefined,
  score: null,
  scoreLabel: null,
  metrics: [],
  recommendations: [],
};
