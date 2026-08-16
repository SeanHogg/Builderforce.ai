/**
 * The rollup that turns a console's own recorded call into the realization's
 * trusted verdict — and the invariants that make it safe to trust at all: it
 * is scoped to the realization's own project, it never overwrites a person's
 * own call to abandon, and it writes nothing when there is nothing new to say.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import { syncRealizationVerdict } from './realizationVerdict';
import type { Row } from './realizationStore';
import type { Db } from '../../infrastructure/database/connection';

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'r1',
    tenantId: 1,
    challengeId: null,
    projectId: 42,
    targetKey: 'smoke-test',
    title: 'Acme Concierge',
    strategy: 'declarative',
    spec: {},
    plan: {},
    result: {},
    liveUrl: 'https://acme.example',
    status: 'built',
    error: null,
    verdict: null,
    verdictMetric: null,
    decidedAt: null,
    createdByUserId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  } as Row;
}

const submittedAt = new Date('2026-02-01T12:00:00Z');

describe('syncRealizationVerdict', () => {
  it('does nothing for a proof with no project — it never got a console', async () => {
    const db = fakeDb([]);
    const result = await syncRealizationVerdict(db as unknown as Db, 1, row({ projectId: null }));
    expect(result.verdict).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('does nothing when the verdict collection was never created', async () => {
    const db = fakeDb([[]]); // siteCollections lookup: no row
    const result = await syncRealizationVerdict(db as unknown as Db, 1, row());
    expect(result.verdict).toBeNull();
    expect(db.calls.map((c) => c.kind)).toEqual(['select']);
  });

  it('does nothing when the collection exists but nothing has been recorded yet', async () => {
    const db = fakeDb([[{ id: 9 }], []]);
    const result = await syncRealizationVerdict(db as unknown as Db, 1, row());
    expect(result.verdict).toBeNull();
  });

  it('ignores a submission whose payload does not carry a verdict this platform recognises', async () => {
    const db = fakeDb([
      [{ id: 9 }],
      [{ payload: { count: 31 }, createdAt: submittedAt }], // no `verdict` key — e.g. a stray write
    ]);
    const result = await syncRealizationVerdict(db as unknown as Db, 1, row());
    expect(result.verdict).toBeNull();
  });

  it('rolls a decisive console call onto the row, with its own recorded date', async () => {
    const db = fakeDb([
      [{ id: 9 }], // siteCollections
      [{ payload: { verdict: 'met', metricLabel: 'Signups', metricValue: 31, target: 25 }, createdAt: submittedAt }],
      [row({ verdict: 'met', decidedAt: submittedAt })], // update … returning
    ]);
    const result = await syncRealizationVerdict(db as unknown as Db, 1, row());
    expect(result.verdict).toBe('met');
    expect(result.decidedAt).toEqual(submittedAt);

    const update = db.calls.find((c) => c.kind === 'update')!;
    expect(update.payload).toMatchObject({ verdict: 'met', verdictMetric: { metricLabel: 'Signups', metricValue: 31 } });
  });

  it('is a no-op once the row already matches the console record — no wasted write', async () => {
    const db = fakeDb([
      [{ id: 9 }],
      [{ payload: { verdict: 'met', metricValue: 31 }, createdAt: submittedAt }],
    ]);
    const already = row({ verdict: 'met', decidedAt: submittedAt });
    const result = await syncRealizationVerdict(db as unknown as Db, 1, already);
    expect(result).toBe(already);
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'select']); // no update issued
  });

  it('never lets a console resurrect an idea a person has already parked', async () => {
    const db = fakeDb([]);
    const abandoned = row({ verdict: 'abandoned', decidedAt: new Date('2026-03-01') });
    const result = await syncRealizationVerdict(db as unknown as Db, 1, abandoned);
    expect(result).toBe(abandoned);
    expect(db.calls).toHaveLength(0);
  });
});
