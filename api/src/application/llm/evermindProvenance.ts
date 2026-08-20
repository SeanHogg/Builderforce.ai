/**
 * Legacy learned-memory provenance — the ONE inference rule, and the only place it
 * is written.
 *
 * A learned memory merged before `distilled` / `skipReason` existed carries no
 * provenance at all, and a Durable-Object ring row is never rewritten. Every reader
 * was therefore left inferring, on every read, from the one thing a bare row can
 * actually prove: text identical to its prompt is the echo a failed teacher leaves
 * behind on a teach-a-task. Correct, but permanently invisible — a legacy refine-mode
 * row whose teacher silently failed renders as ordinary self-learning, and nothing
 * distinguishes it from a row that genuinely never had a teacher.
 *
 * This module materialises that inference so the reader stops guessing. It is
 * deliberately verdict-preserving: the rules below produce exactly the state that
 * brain-ui's `evermindLearnedStatus` (packages/brain-ui/src/evermind/learnedStatus.ts)
 * already derived from the bare row, so migrating a row can never re-grade history.
 * The two are kept in lockstep by `evermindProvenance.test.ts`, which encodes that
 * reader's grading table and asserts the backfilled row grades identically — the
 * strongest tie available across a package boundary (the API Worker does not, and
 * should not, depend on the UI package).
 *
 * Nothing here fabricates a measurement. A row with no teacher evidence either way is
 * marked `legacy`, NOT `not_pinned`: claiming a manager never pinned a teacher would
 * be inventing a fact from an absence.
 */
import type { RecordedSkipReason } from './evermindTeacher';

/** The subset of a stored ring row the backfill reads and writes (structural, so both
 *  the coordinator's `RecentEntry` and the application-layer projection satisfy it). */
export interface ProvenanceRow {
  kind: 'text' | 'delta';
  prompt?: string;
  text?: string;
  distilled?: boolean;
  skipReason?: RecordedSkipReason;
}

/** True when a row already states its own provenance and must be left alone. */
export function hasRecordedProvenance(row: ProvenanceRow): boolean {
  return row.distilled !== undefined || row.skipReason !== undefined;
}

/**
 * The provenance a LEGACY row should carry, or null when the row needs no rewrite
 * (a pre-diffed delta, which has no text provenance to report, or a row that already
 * records its own outcome).
 *
 * - text identical to the prompt → a provable fault whose cause is not nameable.
 * - anything else                → learned without teacher evidence either way.
 */
export function inferLegacyProvenance(
  row: ProvenanceRow,
): { distilled: false; skipReason: RecordedSkipReason } | null {
  if (row.kind === 'delta') return null;
  if (hasRecordedProvenance(row)) return null;
  const prompt = row.prompt?.trim();
  const text = row.text?.trim();
  const echoed = !!prompt && !!text && prompt === text;
  return { distilled: false, skipReason: echoed ? 'unknown' : 'legacy' };
}

/**
 * Apply {@link inferLegacyProvenance} to a row, returning the rewritten row — or null
 * when nothing changes, so a caller can batch only what it actually has to write.
 * Generic over the concrete row type so the coordinator keeps its own `RecentEntry`
 * (embedding, version, weight and all) rather than being narrowed to this projection.
 */
export function backfillEntryProvenance<T extends ProvenanceRow>(row: T): T | null {
  const inferred = inferLegacyProvenance(row);
  return inferred ? { ...row, ...inferred } : null;
}
