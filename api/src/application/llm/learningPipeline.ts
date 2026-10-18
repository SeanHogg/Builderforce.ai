/**
 * Pure half of the Evermind learning pipeline.
 *
 * A text learn is a run. A run produces a candidate when the text contains one
 * statement that is not already in the baseline. A candidate contradicts the
 * baseline when the same fact key already holds different content. Metrics are
 * computed from the ledger rows, never invented.
 */

export interface BaselineFact {
  key: string;
  content: string;
}

export interface LearningCandidate {
  statement: string;
  factKey: string;
  baselineContent: string | null;
  contradicts: boolean;
}

const MIN_STATEMENT = 24;
const MAX_STATEMENT = 500;

export function normalizeLearningText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function slugKey(raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return slug || 'learning';
}

function hash8(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= MIN_STATEMENT && part.length <= MAX_STATEMENT);
}

/**
 * Pull one candidate out of a learn-text body, or null when the text carries
 * nothing new. An explicit `key: statement` line wins; otherwise the first
 * sentence that is not already baseline content.
 */
export function extractCandidate(text: string, baseline: readonly BaselineFact[]): LearningCandidate | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const byKey = new Map(baseline.map((fact) => [normalizeLearningText(fact.key), fact]));
  const contents = new Set(baseline.map((fact) => normalizeLearningText(fact.content)));

  const explicit = raw
    .split(/\n/)
    .map((line) => line.trim())
    .find((line) => /^[A-Za-z][A-Za-z0-9 _-]{0,60}:\s+\S/.test(line) && line.length <= MAX_STATEMENT + 80);

  let factKey: string;
  let statement: string;
  if (explicit) {
    const splitAt = explicit.indexOf(':');
    const keyPart = explicit.slice(0, splitAt).trim();
    statement = explicit.slice(splitAt + 1).trim();
    if (statement.length < MIN_STATEMENT || statement.length > MAX_STATEMENT) return null;
    factKey = /^learn$/i.test(keyPart) ? `learn-${hash8(normalizeLearningText(statement))}` : slugKey(keyPart);
  } else {
    const sentence = sentences(raw).find((part) => !contents.has(normalizeLearningText(part)));
    if (!sentence) return null;
    statement = sentence;
    factKey = `learn-${hash8(normalizeLearningText(statement))}`;
  }

  if (contents.has(normalizeLearningText(statement))) return null;
  const prior = byKey.get(normalizeLearningText(factKey)) ?? null;
  return {
    statement,
    factKey: factKey.slice(0, 120),
    baselineContent: prior?.content ?? null,
    contradicts: prior != null && normalizeLearningText(prior.content) !== normalizeLearningText(statement),
  };
}

export interface PipelineRunRow {
  kind: 'run';
  produced: boolean;
}

export interface PipelineCandidateRow {
  kind: 'candidate';
  contradicts: boolean;
  createdAt: string;
  reviewedAt: string | null;
  benchBefore: number | null;
  benchAfter: number | null;
  transferred: boolean;
}

export interface PipelineMetrics {
  runs: number;
  produced: number;
  candidates: number;
  extractionRate: number;
  reviewHours: number | null;
  contradictionRate: number;
  transferUplift: number | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Median of a non-empty ascending list. Even counts average the two middle values. */
export function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function pipelineMetrics(rows: readonly (PipelineRunRow | PipelineCandidateRow)[]): PipelineMetrics {
  const runs = rows.filter((row): row is PipelineRunRow => row.kind === 'run');
  const candidates = rows.filter((row): row is PipelineCandidateRow => row.kind === 'candidate');
  const produced = runs.filter((row) => row.produced).length;
  const reviews = candidates
    .map((row) => (row.reviewedAt ? (Date.parse(row.reviewedAt) - Date.parse(row.createdAt)) / 3_600_000 : NaN))
    .filter((hours) => Number.isFinite(hours) && hours >= 0)
    .sort((a, b) => a - b);
  const reviewMedian = median(reviews);
  const contradictions = candidates.filter((row) => row.contradicts).length;
  const uplifts = candidates
    .filter((row) => row.transferred && row.benchBefore != null && row.benchAfter != null && row.benchBefore > 0)
    .map((row) => ((row.benchAfter! - row.benchBefore!) / row.benchBefore!) * 100);
  return {
    runs: runs.length,
    produced,
    candidates: candidates.length,
    extractionRate: runs.length === 0 ? 0 : round1((produced / runs.length) * 100),
    reviewHours: reviewMedian == null ? null : round1(reviewMedian),
    contradictionRate: candidates.length === 0 ? 0 : round1((contradictions / candidates.length) * 100),
    transferUplift: uplifts.length === 0 ? null : round1(uplifts.reduce((sum, value) => sum + value, 0) / uplifts.length),
  };
}
