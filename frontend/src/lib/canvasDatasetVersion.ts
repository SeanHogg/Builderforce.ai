/**
 * Dataset IDENTITY and row-basis provenance — what makes a number on the board
 * recomputable, and what stops a truncated one from looking whole.
 *
 * ── TWO DEFECTS, ONE MODULE, BECAUSE THEY ARE THE SAME DEFECT ────────────────────
 * 1. NO REPRODUCIBILITY ENVELOPE. `producedAt`, `lineage` and `sourceDatasetId` were a
 *    real start and stopped short: there was no dataset version, no content hash and no
 *    immutable snapshot, and re-importing a `dataset` overwrote it in place. Lineage
 *    could say WHICH object a number came from and never WHICH VERSION of it, so every
 *    chart was a claim about a frame that no longer existed and "recompute last month's
 *    number" was not a request the board could honour.
 *
 * 2. SILENT TRUNCATION. `MAX_MATERIALIZED_ROWS` is 500, so any real file is cut on
 *    import and every chart, KPI and metric downstream is computed on the cut frame.
 *    `TabularQueryResult` carried `truncated` and `totalRows` and NOTHING RENDERED
 *    THEM: a KPI reading 4.2 looked identical whether it summarised 500 rows or five
 *    million. That is the `emptyShellProblem()` defect moved from cards to numbers, and
 *    it is worse there — a quietly blank card asks a question, a quietly wrong number
 *    answers one.
 *
 * They belong together because they are one question: WHAT EXACTLY was this number
 * computed from? A hash answers "which rows", a row basis answers "how many of them",
 * and a derived artifact carrying neither is a number without a denominator.
 */

import { MAX_MATERIALIZED_ROWS, type TabularRow, type TabularSource } from './canvasTabularData';

/**
 * Content hash of a frame — FNV-1a over a canonical serialisation.
 *
 * ── WHY NOT SHA-256 ──────────────────────────────────────────────────────────────
 * WebCrypto's digest is async, and this is called from `createData`, from patch
 * builders and from render paths that are all synchronous; threading a promise through
 * them to gain cryptographic strength would buy nothing, because the threat model here
 * is ACCIDENT, not forgery. Nobody is attacking a canvas board with a chosen-prefix
 * collision — the question is whether these are the same rows as last week, and a 32-bit
 * FNV-1a over an order-sensitive serialisation answers that.
 *
 * Column ORDER is part of the identity on purpose: a re-export that moved a column is a
 * different frame for the purpose of "does this chart still mean what it meant", even
 * though every cell is unchanged.
 */
export function hashFrame(source: TabularSource): string {
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      // The FNV prime, as shifts — `Math.imul` keeps it a 32-bit multiply rather than
      // silently losing precision through a float.
      hash = Math.imul(hash, 0x01000193);
    }
  };
  feed(source.columns.join(''));
  for (const row of source.rows) {
    feed('');
    for (const column of source.columns) {
      const value = row[column];
      feed(typeof value === 'number' ? String(value) : (value ?? '').toString());
      feed('');
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * What a derived artifact records about the rows it was computed from.
 *
 * Every field is on the artifact rather than resolved from the dataset at read time,
 * and that denormalisation is deliberate with a single writer: the whole point is to
 * survive the dataset CHANGING. A chart that resolved its row count from its source
 * would report the new count against the old numbers — which is precisely the lie the
 * module exists to prevent.
 */
export interface RowBasis {
  /** Rows the artifact was actually computed over. */
  basisRows: number;
  /** Rows the source really has, when that is more than were materialized. */
  sourceRows: number;
  /** True when `basisRows < sourceRows` — the flag every card must surface. */
  truncated: boolean;
  /** Content hash of the frame at the moment of computation. */
  datasetHash?: string;
  /** Monotonic version of the dataset object this came from. */
  datasetVersion?: number;
}

/** The row basis for a frame, given what the source claims its full size is. */
export function rowBasis(source: TabularSource, sourceRows?: number | null): RowBasis {
  const basisRows = source.rows.length;
  const total = Number.isFinite(sourceRows) && (sourceRows as number) > basisRows ? Math.trunc(sourceRows as number) : basisRows;
  return { basisRows, sourceRows: total, truncated: total > basisRows, datasetHash: hashFrame(source) };
}

/**
 * The next version of a dataset object being re-imported.
 *
 * Re-import used to overwrite in place, which is what made "which version produced this
 * chart" unanswerable. Versions start at 1 so a dataset that has never been re-imported
 * still HAS a version — `undefined` and "the first one" are different statements, and
 * only one of them can be cited by an artifact.
 */
export function nextDatasetVersion(current: unknown): number {
  const parsed = typeof current === 'number' ? current : Number(current);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) + 1 : 1;
}

/**
 * Is this artifact's basis still the dataset's current content?
 *
 * The comparison is on the HASH, not the version: a dataset re-imported with identical
 * rows should not mark every chart stale, and a dataset edited in place without a
 * version bump absolutely should. Hash-first is what makes the answer about the DATA
 * rather than about the bookkeeping.
 */
export function basisIsStale(basis: RowBasis | null | undefined, currentHash: string | null | undefined): boolean {
  if (!basis?.datasetHash || !currentHash) return false;
  return basis.datasetHash !== currentHash;
}

/**
 * The provenance sentence a card shows under a derived number.
 *
 * Returns null when there is nothing worth saying — a complete frame with a known hash
 * needs no caveat, and a caveat on every card is a caveat nobody reads. It returns a
 * KEY plus values rather than a sentence, because the consumer is a localized component
 * and this module must not hold English (see the i18n rule).
 */
export interface BasisNotice {
  key: 'truncated' | 'stale';
  values: Record<string, string | number>;
}

export function basisNotice(basis: RowBasis | null | undefined, currentHash?: string | null): BasisNotice | null {
  if (!basis) return null;
  if (basis.truncated) {
    return { key: 'truncated', values: { basisRows: basis.basisRows, sourceRows: basis.sourceRows } };
  }
  if (basisIsStale(basis, currentHash)) return { key: 'stale', values: { basisRows: basis.basisRows } };
  return null;
}

/**
 * Materialize rows for the board, recording what was left behind.
 *
 * The ONE place the 500-row ceiling is applied, so a caller cannot slice the rows and
 * forget to record that it did — which is exactly how the ceiling became invisible.
 */
export function materialize(columns: string[], rows: TabularRow[]): { source: TabularSource; basis: RowBasis } {
  const kept = rows.slice(0, MAX_MATERIALIZED_ROWS);
  const source: TabularSource = { columns, rows: kept };
  return { source, basis: { ...rowBasis(source, rows.length) } };
}
