import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import {
  absorbDuplicate, applyDispositions, type ApplyDeps, type PendingDisposition, type TaskSnapshot,
} from './backlogDispositionApply';

interface Harness { deps: ApplyDeps; tasks: Map<number, TaskSnapshot>; stamped: number[]; updates: Array<{ id: number; patch: Record<string, unknown> }> }

function harness(pending: PendingDisposition[], snapshots: TaskSnapshot[], blocking: number[] = []): Harness {
  const tasks = new Map(snapshots.map((s) => [s.id, { ...s }]));
  const stamped: number[] = [];
  const updates: Harness['updates'] = [];
  const deps: ApplyDeps = {
    pending: async () => pending.filter((p) => !stamped.includes(p.taskId)),
    tasks: async (_t, ids) => new Map(ids.filter((i) => tasks.has(i)).map((i) => [i, { ...tasks.get(i)! }])),
    prsThatBlock: async () => new Set(blocking),
    update: async (id, patch) => { updates.push({ id, patch }); Object.assign(tasks.get(id)!, patch); },
    stamp: async (_t, id) => { stamped.push(id); },
  };
  return { deps, tasks, stamped, updates };
}

const snap = (id: number, over: Partial<TaskSnapshot> = {}): TaskSnapshot => ({ id, title: `T${id}`, description: `desc ${id}`, status: 'backlog', ...over });
const row = (taskId: number, disposition: PendingDisposition['disposition'], over: Partial<PendingDisposition> = {}): PendingDisposition =>
  ({ taskId, disposition, duplicateOf: null, supersededBy: null, evidence: { rule: 'r' }, ...over });
const db = {} as Db;
const args = { tenantId: 1, actor: 'superadmin:u' };

describe('applyDispositions', () => {
  it('closes as CANCELLED (never done) with the evidence quoted, and stamps applied', async () => {
    const h = harness([row(1, 'close', { supersededBy: 9, evidence: { rule: 'superseded' } })], [snap(1), snap(9)]);
    const r = await applyDispositions(db, args, h.deps);
    expect(r.applied).toBe(1);
    expect(h.tasks.get(1)!.status).toBe('cancelled');
    expect(h.tasks.get(1)!.description).toContain('Superseded by #9');
    expect(h.stamped).toEqual([1]);
  });

  it('does not quote a superseded_by target outside the tenant snapshot (cross-tenant id)', async () => {
    const h = harness([row(1, 'close', { supersededBy: 9, evidence: { rule: 'superseded' } })], [snap(1)]);
    await applyDispositions(db, args, h.deps);
    expect(h.tasks.get(1)!.status).toBe('cancelled');
    expect(h.tasks.get(1)!.description).not.toContain('#9');
  });

  it('consolidates: absorbs the duplicate into the canonical ticket FIRST, then cancels it', async () => {
    const h = harness([row(2, 'consolidate', { duplicateOf: 1 })], [snap(1), snap(2, { title: 'Dup', description: 'unique requirement' })]);
    const r = await applyDispositions(db, args, h.deps);
    expect(r.applied).toBe(1);
    expect(h.updates[0]!.id).toBe(1); // canonical first
    expect(h.tasks.get(1)!.description).toContain('[Consolidated #2] Dup');
    expect(h.tasks.get(1)!.description).toContain('unique requirement');
    expect(h.tasks.get(2)!.status).toBe('cancelled');
  });

  it('quarantines as blocked with a note', async () => {
    const h = harness([row(3, 'quarantine', { evidence: { rule: 'closed_unmerged_only' } })], [snap(3)]);
    await applyDispositions(db, args, h.deps);
    expect(h.tasks.get(3)!.status).toBe('blocked');
    expect(h.tasks.get(3)!.description).toContain('[Quarantined: closed_unmerged_only');
  });

  it('keep mutates nothing but is stamped', async () => {
    const h = harness([row(4, 'keep')], [snap(4)]);
    const r = await applyDispositions(db, args, h.deps);
    expect(h.updates).toEqual([]);
    expect(r.applied).toBe(1);
  });

  it('skips a row whose ticket left the board, or that grew an open/merged PR since the dry run', async () => {
    const h = harness([row(5, 'close'), row(6, 'close')], [snap(5, { status: 'done' }), snap(6)], [6]);
    const r = await applyDispositions(db, args, h.deps);
    expect(r.applied).toBe(0);
    expect(r.outcomes.map((o) => o.reason)).toEqual(['ticket_not_open', 'pr_appeared_since_dry_run']);
    expect(h.stamped).toEqual([]);
  });

  it('skips a consolidation whose canonical ticket is gone', async () => {
    const h = harness([row(7, 'consolidate', { duplicateOf: 99 })], [snap(7)]);
    const r = await applyDispositions(db, args, h.deps);
    expect(r.outcomes[0]).toMatchObject({ result: 'skipped', reason: 'canonical_not_open' });
    expect(h.tasks.get(7)!.status).toBe('backlog');
  });

  it('honours the disposition filter and is idempotent on a second run', async () => {
    const h = harness([row(1, 'close'), row(2, 'quarantine')], [snap(1), snap(2)]);
    const first = await applyDispositions(db, { ...args, dispositions: ['close'] }, h.deps);
    expect(first.applied).toBe(1);
    expect(h.tasks.get(2)!.status).toBe('backlog');
    const again = await applyDispositions(db, { ...args, dispositions: ['close'] }, h.deps);
    expect(again.applied).toBe(0);
  });
});

describe('absorbDuplicate', () => {
  it('does not append the same duplicate twice', () => {
    const dup = snap(2, { title: 'Dup', description: 'x' });
    const once = absorbDuplicate('canon', dup);
    expect(absorbDuplicate(once, dup)).toBe(once);
  });
});

describe('applyDispositions consolidation chains and tenant scope', () => {
  it('resolves a chain A -> B -> C to the live ticket, so B\'s requirement text is not lost', async () => {
    // B (2) is consolidated into C (3) first; A (1) names B, which is now cancelled.
    const h = harness(
      [row(2, 'consolidate', { duplicateOf: 3 }), row(1, 'consolidate', { duplicateOf: 2 })],
      [snap(1, { title: 'A', description: 'a text' }), snap(2, { title: 'B', description: 'b text' }), snap(3, { title: 'C', description: 'c text' })],
    );
    const r = await applyDispositions(db, args, h.deps);
    expect(r.applied).toBe(2);
    expect(h.tasks.get(2)!.status).toBe('cancelled');
    expect(h.tasks.get(1)!.status).toBe('cancelled');
    const c = h.tasks.get(3)!.description!;
    expect(c).toContain('b text');
    expect(c).toContain('a text');
    expect(h.tasks.get(2)!.description).not.toContain('a text'); // never absorbed into the cancelled B
  });

  it('skips when the canonical was closed and no live target exists', async () => {
    const h = harness(
      [row(2, 'close'), row(1, 'consolidate', { duplicateOf: 2 })],
      [snap(1), snap(2)],
    );
    const r = await applyDispositions(db, args, h.deps);
    expect(r.outcomes.find((o) => o.taskId === 1)).toMatchObject({ result: 'skipped', reason: 'canonical_not_open' });
  });

  it('skips a consolidate whose duplicate_of is not in this tenant (never loaded by the scoped read)', async () => {
    const h = harness([row(1, 'consolidate', { duplicateOf: 999 })], [snap(1)]);
    const r = await applyDispositions(db, args, h.deps);
    expect(r.outcomes[0]).toMatchObject({ result: 'skipped', reason: 'canonical_not_open' });
    expect(h.updates).toEqual([]);
  });

  it('does not quote a superseded_by id that is not in this tenant', async () => {
    const h = harness([row(1, 'close', { supersededBy: 999 })], [snap(1)]);
    await applyDispositions(db, args, h.deps);
    expect(h.tasks.get(1)!.description).not.toContain('#999');
  });
});
