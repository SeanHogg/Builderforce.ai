/**
 * `analyze_codebase` on a cloud run: the full snapshot is saved on the run's open audit
 * row, bound to the run's own tenant / project / execution, and the model reads a
 * bounded summary. Moved from the retired image `audit_analysis` op.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { saveAuditAnalysis, withSavedAnalysis } from './auditAnalysis';

const snapshot = { version: 1, id: '7568a9b0-2cb0-4a1a-8e42-97c26bf63e19', capturedAt: '2026-10-18T12:00:00.000Z',
  source: { commit: null, branch: 'main', dirty: false }, tools: ['dependency-cruiser', 'jscpd', 'knip'].map((name) => ({ name, version: '1', status: 'complete' })), nodes: ['src/a.ts'], edges: [], issues: [] };
const run = { tenantId: 7, projectId: 42, executionId: 123 };

/** A db whose update binds a WHERE we can read back, answering `rows`. */
function dbReturning(rows: unknown[]) {
  const seen: { params: unknown[] } = { params: [] };
  const db = { update: vi.fn(() => ({ set: () => ({ where: (condition: unknown) => {
    seen.params = new PgDialect().sqlToQuery(condition as never).params;
    return { returning: async () => rows };
  } }) })) };
  return { db: db as never, seen, update: db.update };
}

describe('saveAuditAnalysis', () => {
  it('rejects a malformed snapshot before touching the database', async () => {
    const { db, update } = dbReturning([]);
    expect(await saveAuditAnalysis(db, run, {})).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('binds the write to the run\'s tenant, project, execution and an unfinished audit', async () => {
    const { db, seen } = dbReturning([{ id: 'run' }]);
    expect(await saveAuditAnalysis(db, run, snapshot)).toBe(true);
    expect(seen.params).toEqual([7, 42, 123, 'completed']);
  });

  it('is false when no audit is open for the run', async () => {
    expect(await saveAuditAnalysis(dbReturning([]).db, run, snapshot)).toBe(false);
  });
});

describe('withSavedAnalysis', () => {
  it('hands the model a bounded summary once the snapshot is saved', async () => {
    const out = await withSavedAnalysis(dbReturning([{ id: 'run' }]).db, run, { snapshot });
    expect(out).toMatchObject({ ok: true, artifactSaved: true, snapshotId: snapshot.id, files: 1, dependencies: 0, findings: 0 });
    expect(out).not.toHaveProperty('snapshot');
  });

  it('says the analysis was not saved instead of claiming it was', async () => {
    const out = await withSavedAnalysis(dbReturning([]).db, run, { snapshot });
    expect(out).toMatchObject({ ok: false });
    expect(String(out.error)).toMatch(/could not be saved/);
  });

  it('passes a result with no snapshot through untouched (a failed analysis)', async () => {
    const failed = { ok: false, error: 'scan a smaller project' };
    expect(await withSavedAnalysis(dbReturning([]).db, run, failed)).toBe(failed);
  });
});
