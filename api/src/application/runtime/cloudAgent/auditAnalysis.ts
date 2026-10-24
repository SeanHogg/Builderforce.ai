/**
 * `analyze_codebase` on a cloud run: the full analyzer snapshot is saved on the run's
 * audit row for the visualizer, and the model reads a bounded summary instead of the
 * whole graph (`savedCodeAnalysisSummary`). Moved here from the image's `audit_analysis`
 * op, which the container used to call from its own loop — the one engine now runs the
 * tool (over the sandbox's shell) and saves the snapshot itself.
 */
import { and, eq, ne } from 'drizzle-orm';
import { savedCodeAnalysisSummary, type CodeAnalysisSnapshot } from '@builderforce/agent-tools';
import { CodeAnalysisSchema } from '../../tools/codeAnalysisSchema';
import { systemAuditRuns } from '../../../infrastructure/database/schema';
import type { Db } from '../../../infrastructure/database/connection';

export const ANALYZE_CODEBASE_TOOL = 'analyze_codebase';

/** Save `snapshot` on the run's open audit row; false when it is invalid or no row is open. */
export async function saveAuditAnalysis(
  db: Db,
  run: { tenantId: number; projectId: number; executionId: number },
  snapshot: unknown,
): Promise<boolean> {
  const parsed = CodeAnalysisSchema.safeParse(snapshot);
  if (!parsed.success) return false;
  const rows = await db.update(systemAuditRuns).set({ analysis: parsed.data, updatedAt: new Date() }).where(and(
    eq(systemAuditRuns.tenantId, run.tenantId), eq(systemAuditRuns.projectId, run.projectId),
    eq(systemAuditRuns.executionId, run.executionId), ne(systemAuditRuns.status, 'completed'),
  )).returning({ id: systemAuditRuns.id });
  return rows.length > 0;
}

/**
 * The tool result the model reads for an `analyze_codebase` call: the snapshot saved and
 * summarised, or the result as it was when there is no snapshot to save.
 */
export async function withSavedAnalysis(
  db: Db,
  run: { tenantId: number; projectId: number; executionId: number },
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const snapshot = data.snapshot as CodeAnalysisSnapshot | undefined;
  if (!snapshot) return data;
  if (!(await saveAuditAnalysis(db, run, snapshot))) {
    return { ok: false, error: 'The analysis ran but its snapshot could not be saved (no open audit for this run, or the snapshot was invalid).' };
  }
  return savedCodeAnalysisSummary(snapshot);
}
