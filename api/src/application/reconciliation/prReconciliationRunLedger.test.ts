import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prReconciliationErrors, prReconciliationItems, prReconciliationRuns } from '../../infrastructure/database/schema';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { ReconciliationRunLedger } from './prReconciliationRunLedger';
import { ReconciliationError } from './reconciliationError';

/** Fake Db recording every INSERT by table. */
function fakeDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const db = {
    insert: (table: unknown) => ({ values: async (values: unknown) => { inserts.push({ table, values }); } }),
  };
  return { db: db as never, inserts };
}

const BASE = {
  tenantId: 1, projectId: 2, repoId: 'repo-1', agentRef: null,
  mode: 'apply' as const, requestedBy: null, approvedPrNumbers: [],
};
const item = (prNumber: number) => ({
  runId: 'x', tenantId: 1, repoId: 'repo-1', prNumber, prUrl: `https://gh/pr/${prNumber}`, title: 't',
  classification: 'keep', recommendedAction: 'wait', confidence: 'high',
}) as never;

let fake: ReturnType<typeof fakeDb>;
beforeEach(() => { fake = fakeDb(); });

describe('ReconciliationRunLedger — idle-silent scheduled runs', () => {
  it('an on_change run that changed nothing writes NOTHING (no run row, no items)', async () => {
    const ledger = new ReconciliationRunLedger(fake.db, BASE, 'on_change');
    ledger.addItems([item(1), item(2)]);
    const persisted = await ledger.finish({ status: 'completed', summary: { total: 2 }, changed: false });
    expect(persisted).toBe(false);
    expect(fake.inserts).toHaveLength(0);
  });

  it('an on_change run that changed something writes the run row with its id, then its items', async () => {
    const ledger = new ReconciliationRunLedger(fake.db, BASE, 'on_change');
    ledger.addItems([item(1)]);
    expect(await ledger.finish({ status: 'completed', summary: { total: 1 }, approvedPrNumbers: [1], changed: true })).toBe(true);
    expect(fake.inserts.map((i) => i.table)).toEqual([prReconciliationRuns, prReconciliationItems]);
    expect(fake.inserts[0]!.values).toMatchObject({ id: ledger.runId, status: 'completed', approvedPrNumbers: [1], errorCount: 0 });
  });

  it('an on_change run with an error is always recorded, errors included', async () => {
    const ledger = new ReconciliationRunLedger(fake.db, BASE, 'on_change');
    ledger.recordError({ phase: 'collection' }, new ReconciliationError('GITHUB_HTTP_ERROR', 'nope', { status: 403 }), { report: false });
    expect(await ledger.finish({ status: 'failed', changed: false })).toBe(true);
    expect(fake.inserts.map((i) => i.table)).toEqual([prReconciliationRuns, prReconciliationErrors]);
    expect(fake.inserts[0]!.values).toMatchObject({ errorCount: 1, status: 'failed' });
  });

  it('an operator (always) run is recorded even when it changed nothing', async () => {
    const ledger = new ReconciliationRunLedger(fake.db, { ...BASE, mode: 'dry_run' }, 'always');
    expect(await ledger.finish({ status: 'completed', changed: false })).toBe(true);
    expect(fake.inserts).toHaveLength(1);
  });

  it('marks a closed PR on the buffered item instead of a second UPDATE', async () => {
    const ledger = new ReconciliationRunLedger(fake.db, BASE, 'on_change');
    ledger.addItems([item(7)]);
    ledger.markClosed(7);
    await ledger.finish({ status: 'completed', changed: true });
    const [written] = fake.inserts[1]!.values as Array<{ appliedAction: string | null }>;
    expect(written!.appliedAction).toBe('close');
  });
});
