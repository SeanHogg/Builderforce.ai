/**
 * The ONE reader/writer of `run_deltas`, `run_delta_dimensions` and `run_delta_findings` (PRD 41 §C14,
 * migration 1344). Writes ride the sync push's transaction (`runDeltaWriter(tx)`, in a savepoint of their own);
 * reads are the summary projections the read use cases (`runDeltaReads`) cache.
 */

import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { DimensionId, HeadlineModel, RunDeltaSummary, RunDeltaSurface, Verdict } from '@builderforce/run-delta';
import type { Db, Tx } from '../../infrastructure/database/connection';
import { runDeltaDimensions, runDeltaFindings, runDeltas } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { ImportedRunDelta } from '../../domain/runDelta/runDeltaRecord';
import type { RunDeltaWriter } from './runDeltaPorts';

/** Rows per multi-row insert: well under Postgres' 65535 bind parameters (13 columns × 1000). */
const INSERT_CHUNK = 1000;

export function runDeltaWriter(outer: Tx): RunDeltaWriter {
  return {
    // `outer` is the push's INTERACTIVE transaction (never the HTTP handle), so its `transaction()` is a SAVEPOINT —
    // the same form `SyncRepository` uses per event: a refused statement rolls back to it and rethrows, so the push's
    // own transaction stays usable and the importer can answer the event instead of losing the whole batch.
    insert: (tenantId, projectId, imported) => outer.transaction((tx) => insertDelta(tx, tenantId, projectId, imported)),
    revise: (tenantId, projectId, imported) => outer.transaction((tx) => reviseDelta(tx, tenantId, projectId, imported)),
  };
}

/** The (tenant, run, repo key) row moved to the revision's digest; its dimension and finding rows replaced. */
async function reviseDelta(tx: Tx, tenantId: number, projectId: number | null, imported: ImportedRunDelta): Promise<{ status: 'revised' } | { status: 'missing' }> {
  const s = imported.summary;
  const [row] = await tx.update(runDeltas).set({
    ...(projectId !== null ? { projectId } : {}),
    surface: s.surface,
    mode: s.mode,
    deltaVersion: imported.deltaVersion,
    digest: s.digest,
    headline: s.headline,
    blastScore: s.blastRadius.score,
    blastBand: s.blastRadius.band,
    summary: s.summary,
    blocking: s.blocking,
    computedAt: new Date(s.computedAt),
  }).where(scopedToTenant(runDeltas, tenantId, eq(runDeltas.runId, s.runId), eq(runDeltas.repoKey, s.repoKey))).returning({ id: runDeltas.id });
  if (!row) return { status: 'missing' };
  await tx.delete(runDeltaFindings).where(scopedToTenant(runDeltaFindings, tenantId, eq(runDeltaFindings.runDeltaId, row.id)));
  await tx.delete(runDeltaDimensions).where(scopedToTenant(runDeltaDimensions, tenantId, eq(runDeltaDimensions.runDeltaId, row.id)));
  if (imported.dimensions.length > 0) {
    await tx.insert(runDeltaDimensions).values(imported.dimensions.map((d) => ({ runDeltaId: row.id, tenantId, ...d })));
  }
  for (let i = 0; i < imported.findings.length; i += INSERT_CHUNK) {
    await tx.insert(runDeltaFindings).values(imported.findings.slice(i, i + INSERT_CHUNK).map((f) => ({ runDeltaId: row.id, tenantId, ...f })));
  }
  return { status: 'revised' };
}

type Inserted = Awaited<ReturnType<RunDeltaWriter['insert']>>;

/** The delta row, then its dimension and finding rows; `exists` (with the stored digest) when the key is taken. */
async function insertDelta(tx: Tx, tenantId: number, projectId: number | null, imported: ImportedRunDelta): Promise<Inserted> {
  const s = imported.summary;
  const [row] = await tx.insert(runDeltas).values({
    tenantId,
    projectId,
    runId: s.runId,
    repoKey: s.repoKey,
    repository: imported.repository,
    surface: s.surface,
    mode: s.mode,
    deltaVersion: imported.deltaVersion,
    digest: s.digest,
    headline: s.headline,
    blastScore: s.blastRadius.score,
    blastBand: s.blastRadius.band,
    summary: s.summary,
    blocking: s.blocking,
    computedAt: new Date(s.computedAt),
  }).onConflictDoNothing({ target: [runDeltas.tenantId, runDeltas.runId, runDeltas.repoKey] }).returning({ id: runDeltas.id });
  if (!row) {
    const [stored] = await tx.select({ digest: runDeltas.digest }).from(runDeltas)
      .where(scopedToTenant(runDeltas, tenantId, eq(runDeltas.runId, s.runId), eq(runDeltas.repoKey, s.repoKey))).limit(1);
    return { status: 'exists', digest: stored?.digest ?? '' };
  }
  if (imported.dimensions.length > 0) {
    await tx.insert(runDeltaDimensions).values(imported.dimensions.map((d) => ({ runDeltaId: row.id, tenantId, ...d })));
  }
  for (let i = 0; i < imported.findings.length; i += INSERT_CHUNK) {
    await tx.insert(runDeltaFindings).values(imported.findings.slice(i, i + INSERT_CHUNK).map((f) => ({ runDeltaId: row.id, tenantId, ...f })));
  }
  return { status: 'inserted' };
}

const SUMMARY_COLUMNS = {
  id: runDeltas.id,
  runId: runDeltas.runId,
  repoKey: runDeltas.repoKey,
  surface: runDeltas.surface,
  mode: runDeltas.mode,
  computedAt: runDeltas.computedAt,
  headline: runDeltas.headline,
  summary: runDeltas.summary,
  blastScore: runDeltas.blastScore,
  blastBand: runDeltas.blastBand,
  blocking: runDeltas.blocking,
  digest: runDeltas.digest,
};

interface SummaryRow {
  id: string;
  runId: string;
  repoKey: string;
  surface: string;
  mode: string;
  computedAt: Date;
  headline: string;
  summary: unknown;
  blastScore: number;
  blastBand: string;
  blocking: string[];
  digest: string;
}

/** A delta row with its dimension rows folded into the summary contract. */
async function summariesOf(db: Db, tenantId: number, rows: SummaryRow[]): Promise<Array<RunDeltaSummary & { id: string }>> {
  if (rows.length === 0) return [];
  const dims = await db.select({
    runDeltaId: runDeltaDimensions.runDeltaId,
    dimensionId: runDeltaDimensions.dimensionId,
    verdict: runDeltaDimensions.verdict,
    introduced: runDeltaDimensions.introduced,
    resolved: runDeltaDimensions.resolved,
  }).from(runDeltaDimensions)
    .where(scopedToTenant(runDeltaDimensions, tenantId, inArray(runDeltaDimensions.runDeltaId, rows.map((r) => r.id))));
  return rows.map((r) => {
    const verdicts: Partial<Record<DimensionId, Verdict>> = {};
    let introduced = 0;
    let resolved = 0;
    for (const d of dims) {
      if (d.runDeltaId !== r.id) continue;
      verdicts[d.dimensionId as DimensionId] = d.verdict as Verdict;
      introduced += d.introduced;
      resolved += d.resolved;
    }
    return {
      id: r.id,
      runId: r.runId,
      repoKey: r.repoKey,
      surface: r.surface as RunDeltaSurface,
      mode: r.mode as 'interactive' | 'autonomous',
      computedAt: r.computedAt.toISOString(),
      headline: r.headline as Verdict,
      summary: r.summary as HeadlineModel,
      verdicts,
      counts: { introduced, resolved },
      blastRadius: { score: r.blastScore, band: r.blastBand as 'low' | 'medium' | 'high' },
      blocking: [...r.blocking],
      digest: r.digest,
    };
  });
}

/** Keyset cursor over (computed_at desc, id desc). */
export interface RunDeltaCursor {
  computedAt: string;
  id: string;
}

/** A project's deltas, newest first: `limit + 1` rows are read so the caller knows whether a next page exists. */
export async function listProjectRunDeltas(
  db: Db,
  tenantId: number,
  projectId: number,
  limit: number,
  after: RunDeltaCursor | null,
): Promise<Array<RunDeltaSummary & { id: string }>> {
  const before: SQL | undefined = after
    ? or(lt(runDeltas.computedAt, new Date(after.computedAt)), and(eq(runDeltas.computedAt, new Date(after.computedAt)), lt(runDeltas.id, after.id)))
    : undefined;
  const rows = await db.select(SUMMARY_COLUMNS).from(runDeltas)
    .where(scopedToTenant(runDeltas, tenantId, eq(runDeltas.projectId, projectId), before))
    .orderBy(desc(runDeltas.computedAt), desc(runDeltas.id))
    .limit(limit + 1);
  return summariesOf(db, tenantId, rows);
}

/** Every stored delta of one run (one per repo key), sorted by repo key. */
export async function runDeltasOfRun(db: Db, tenantId: number, runId: string): Promise<Array<RunDeltaSummary & { id: string }>> {
  const rows = await db.select(SUMMARY_COLUMNS).from(runDeltas)
    .where(scopedToTenant(runDeltas, tenantId, eq(runDeltas.runId, runId)))
    .orderBy(runDeltas.repoKey);
  return summariesOf(db, tenantId, rows);
}
