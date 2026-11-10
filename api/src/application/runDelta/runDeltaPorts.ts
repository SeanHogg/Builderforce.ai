/**
 * Run-delta persistence ports (PRD 41 §C14). The importer and the read use cases depend on these; the
 * Drizzle store (`runDeltaStore`) and the R2 evidence store (`runDeltaEvidence`) implement them.
 */

import type { RunDelta, RunDeltaSummary } from '@builderforce/run-delta';
import type { ImportedRunDelta } from '../../domain/runDelta/runDeltaRecord';

/** The write side, bound to the sync push's transaction. */
export interface RunDeltaWriter {
  /**
   * Insert the delta and its dimension and finding rows, once per (tenant, run, repo key), inside a nested
   * SAVEPOINT: a statement the database refuses rolls back to it and THROWS, leaving the push's transaction usable.
   * `exists` (with the stored digest) when a delta is already stored under that key: nothing is written.
   */
  insert(tenantId: number, projectId: number | null, imported: ImportedRunDelta): Promise<{ status: 'inserted' } | { status: 'exists'; digest: string }>;
  /**
   * A REVISION of the delta of (tenant, run, repo key) — the final delta of a run whose L3 analyzers settled after its
   * static delta was stored (PRD 41 §6): the row's pointer (digest, headline, summary, blast radius, blocking) moves to
   * the new digest and its dimension and finding rows are replaced, in the same nested SAVEPOINT discipline as `insert`.
   * The evidence of each digest stays as written (content-addressed, write-once). `missing` when no row exists yet.
   * Optional: a writer without it refuses revisions (`run_delta_immutable`).
   */
  revise?(tenantId: number, projectId: number | null, imported: ImportedRunDelta): Promise<{ status: 'revised' } | { status: 'missing' }>;
}

/** The full delta (evidence included), as a blob keyed by its digest. */
export interface RunDeltaEvidenceStore {
  /** Idempotent (content-addressed). THROWS when the write fails, so the import is retried. */
  put(tenantId: number, delta: RunDelta): Promise<void>;
  get(tenantId: number, digest: string): Promise<RunDelta | null>;
}

/** What the run-delta branch of the mirror importer is handed. */
export interface RunDeltaImportPorts {
  writer: RunDeltaWriter;
  evidence: RunDeltaEvidenceStore;
  /** Bump the tenant's run-delta read caches (run after commit). */
  invalidate(tenantId: number): Promise<unknown>;
}

/** One page of a project's history, newest first. */
export interface RunDeltaPage {
  items: RunDeltaSummary[];
  nextCursor?: string;
}
