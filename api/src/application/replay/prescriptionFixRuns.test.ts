/**
 * `holdBuildPreviewWhileRunning`: one read for a list of fixes, none when no fix offers a
 * preview, scoped to the workspace and to runs that have not finished.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import { holdBuildPreviewWhileRunning, unfinishedRunsOf } from './prescriptionFixRuns';

const dialect = new PgDialect();

function fakeDb(runningTaskIds: number[]) {
  const where = vi.fn(async (_predicate: unknown) => runningTaskIds.map((taskId) => ({ taskId })));
  const selectDistinct = vi.fn(() => ({ from: () => ({ where }) }));
  return { db: { selectDistinct } as never, selectDistinct, where };
}

const dto = (taskId: number | null, buildPreview: ReplayPrescriptionDto['buildPreview']) =>
  ({ id: `rx-${taskId}`, buildPreview, refs: { taskId } }) as unknown as ReplayPrescriptionDto;

describe('unfinishedRunsOf', () => {
  it('is this workspace\'s runs of these tickets that are not completed, failed or cancelled', () => {
    const { sql, params } = dialect.sqlToQuery(unfinishedRunsOf(7, [77, 78]));
    expect(sql).toContain('"tenant_id" = $1');
    expect(sql).toContain('"task_id" in ($2, $3)');
    expect(sql).toContain('"status" not in ($4, $5, $6)');
    expect(params).toEqual([7, 77, 78, 'completed', 'failed', 'cancelled']);
  });
});

describe('holdBuildPreviewWhileRunning', () => {
  it('withdraws buildPreview from a fix whose run is going, leaves the others, and never mutates its input', async () => {
    const offer = { projectId: 42, rebuild: false };
    const cached = [dto(77, offer), dto(78, offer), dto(79, null)];
    const { db } = fakeDb([77]);
    const result = await holdBuildPreviewWhileRunning(db, 7, cached);
    expect(result.map((r) => r.buildPreview)).toEqual([null, offer, null]);
    expect(cached[0]!.buildPreview).toEqual(offer);
  });

  it('asks one question about exactly the tickets of the fixes that offer a preview', async () => {
    const offer = { projectId: 42, rebuild: false };
    const { db, selectDistinct, where } = fakeDb([]);
    await holdBuildPreviewWhileRunning(db, 7, [dto(77, offer), dto(78, offer), dto(79, null), dto(null, offer)]);
    expect(selectDistinct).toHaveBeenCalledTimes(1);
    expect(dialect.sqlToQuery(where.mock.calls[0]![0] as never).params).toEqual([7, 77, 78, 'completed', 'failed', 'cancelled']);
  });

  it('reads nothing when no row offers a preview', async () => {
    const { db, selectDistinct } = fakeDb([]);
    await holdBuildPreviewWhileRunning(db, 7, [dto(1, null)]);
    expect(selectDistinct).not.toHaveBeenCalled();
  });
});
