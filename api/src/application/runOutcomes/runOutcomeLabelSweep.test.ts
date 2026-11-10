import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { finalizeDueCensoredLabels, runRunOutcomeLabelSweep } from './runOutcomeLabelSweep';

/** With no sibling endpoint bound, the operational handle IS the core handle: one FIFO serves both. */
const now = new Date('2026-10-18T00:00:00.000Z');

const censoredRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1, tenantId: 7, runId: 'run-1', repository: 'https://github.com/acme/app', kind: 'ci-red-after-merge',
  value: null, status: 'censored', eventAt: null, windowEndsAt: new Date('2026-10-09T00:00:00Z'),
  evidence: {}, labellerVersion: 1, computedAt: new Date('2026-10-05T00:00:00Z'),
  ...overrides,
});

type Inserted = Array<Record<string, unknown>>;
const insertedLabels = (db: ReturnType<typeof fakeDb>): Inserted =>
  db.calls.filter((c) => c.kind === 'insert').flatMap((c) => c.payload as Inserted);

describe('censoring finalization', () => {
  it('finalizes a censored label whose window ended with nothing observed: false, final', async () => {
    const row = censoredRow();
    const db = fakeDb([[row], [row], []]);
    const written = await finalizeDueCensoredLabels(db as unknown as Db, now);
    expect(written).toBe(1);
    expect(insertedLabels(db)).toEqual([expect.objectContaining({ tenantId: 7, runId: 'run-1', kind: 'ci-red-after-merge', value: false, status: 'final' })]);
  });

  it('keeps an observed event true when it finalizes', async () => {
    const row = censoredRow({ value: true, eventAt: new Date('2026-10-04T00:00:00Z') });
    const db = fakeDb([[row], [row], []]);
    await finalizeDueCensoredLabels(db as unknown as Db, now);
    expect(insertedLabels(db)).toEqual([expect.objectContaining({ value: true, status: 'final' })]);
  });

  it('writes nothing when no window has ended', async () => {
    const db = fakeDb([[]]);
    expect(await finalizeDueCensoredLabels(db as unknown as Db, now)).toBe(0);
    expect(db.calls.filter((c) => c.kind === 'insert')).toHaveLength(0);
  });
});

describe('the daily pass', () => {
  it('labels a recent run from the pull request its branch landed through', async () => {
    const db = fakeDb([
      [],                                                       // no censored labels due
      [{ tenantId: 7 }],                                        // tenants with recent runs
      [{ runId: 'run-1', repository: 'git@github.com:acme/app.git' }], // the tenant's candidate keys (rotated window)
      [{ runId: 'run-1', repository: 'git@github.com:acme/app.git', lastCommittedAt: '2026-09-30T00:00:00Z',
         branches: ['feature/x'], paths: ['src/a.ts'], finalKinds: [] }],
      [{ id: 'pr-1', number: 42, taskId: 11, status: 'merged', branchName: 'feature/x',
         createdAt: new Date('2026-09-29T00:00:00Z'), updatedAt: new Date('2026-10-03T00:00:00Z'),
         mergedAt: new Date('2026-10-02T00:00:00Z'), mergeSha: 'beef1234', buildStatus: 'failure',
         host: 'github.com', owner: 'acme', repo: 'app' }],
      [{ ref: 'pr-1', isFailure: true, deployedAt: new Date('2026-10-02T00:05:00Z') }], // its deployment failed after merge
      [{ taskId: 11, verdict: 'changes_requested', createdAt: new Date('2026-10-01T00:00:00Z') }],
      [],                                                       // no stored labels yet
      [],                                                       // the insert
    ]);
    const result = await runRunOutcomeLabelSweep(db as unknown as Db, now);
    expect(result).toMatchObject({ finalized: 0, tenants: 1, runs: 1 });
    const labels = insertedLabels(db);
    expect(labels.map((l) => l.kind).sort()).toEqual(['ci-red-after-merge', 'review-rejected']);
    for (const l of labels) expect(l).toMatchObject({ tenantId: 7, runId: 'run-1', repository: 'git@github.com:acme/app.git' });
    expect(labels.find((l) => l.kind === 'review-rejected')).toMatchObject({ value: true });
  });

  it('writes no CI label when no concluded CI run was ever observed on the merge', async () => {
    const db = fakeDb([
      [],
      [{ tenantId: 7 }],
      [{ runId: 'run-1', repository: 'https://github.com/acme/app' }],
      [{ runId: 'run-1', repository: 'https://github.com/acme/app', lastCommittedAt: '2026-09-30T00:00:00Z',
         branches: ['feature/x'], paths: ['src/a.ts'], finalKinds: [] }],
      [{ id: 'pr-1', number: 42, taskId: 11, status: 'merged', branchName: 'feature/x',
         createdAt: new Date('2026-09-29T00:00:00Z'), updatedAt: new Date('2026-10-03T00:00:00Z'),
         mergedAt: new Date('2026-10-02T00:00:00Z'), mergeSha: 'beef1234', buildStatus: 'success',
         host: 'github.com', owner: 'acme', repo: 'app' }],
      [],                                                       // no merge deployment recorded
      [{ taskId: 11, verdict: 'approved', createdAt: new Date('2026-10-01T00:00:00Z') }],
      [],
      [],
    ]);
    await runRunOutcomeLabelSweep(db as unknown as Db, now);
    expect(insertedLabels(db).map((l) => l.kind)).toEqual(['review-rejected']);
  });

  it('skips a run whose PR is on another repository', async () => {
    const db = fakeDb([
      [],
      [{ tenantId: 7 }],
      [{ runId: 'run-1', repository: 'https://github.com/acme/app' }],
      [{ runId: 'run-1', repository: 'https://github.com/acme/app', lastCommittedAt: '2026-09-30T00:00:00Z',
         branches: ['main-feature'], paths: ['a.ts'], finalKinds: [] }],
      [{ id: 'pr-9', number: 9, taskId: null, status: 'merged', branchName: 'main-feature',
         createdAt: new Date('2026-09-29T00:00:00Z'), updatedAt: new Date('2026-10-03T00:00:00Z'),
         mergedAt: new Date('2026-10-02T00:00:00Z'), mergeSha: 'cafe1234', buildStatus: 'failure',
         host: 'github.com', owner: 'other', repo: 'app' }],
      [],
    ]);
    const result = await runRunOutcomeLabelSweep(db as unknown as Db, now);
    expect(result.labelled).toBe(0);
    expect(insertedLabels(db)).toHaveLength(0);
  });
});
