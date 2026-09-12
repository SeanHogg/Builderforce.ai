import { describe, expect, it } from 'vitest';
import { evaluateGate, pendingApprovals, readProvenance, type Actor, type ProvenanceEntry } from '@/lib/canvasApprovalGate';
import { actsUnblockedBy, approvalInboxOf, pendingChangeCount, reviewPendingChanges } from './approvalInbox';

const BRAIN: Actor = { kind: 'brain', ref: 'brain', name: 'Brain' };
const ANA: Actor = { kind: 'human', ref: 'u-ana', name: 'Ana' };
const BEN: Actor = { kind: 'human', ref: 'u-ben', name: 'Ben' };

function entry(field: string, at: string, by: Actor = BRAIN): ProvenanceEntry {
  return { id: `${field}:${at}`, field, from: '100', to: '150', at, by };
}

const budget = {
  kind: 'budget',
  title: 'Q3 budget',
  provenance: [entry('plannedTotal', '2026-09-10T10:00:00Z'), entry('lines', '2026-09-10T10:01:00Z')],
};

describe('approvalInboxOf', () => {
  it('lists only objects with waiting changes, longest-waiting first, with the acts they gate', () => {
    const items = approvalInboxOf([
      { id: 'late', data: { kind: 'invoice', title: 'INV-7', provenance: [entry('amount', '2026-09-11T09:00:00Z')] } },
      { id: 'clean', data: { kind: 'budget', title: 'Signed', provenance: [{ ...entry('plannedTotal', '2026-09-01T00:00:00Z'), approvedBy: ANA, approvedAt: '2026-09-02T00:00:00Z' }] } },
      { id: 'early', data: budget },
    ]);
    expect(items.map((item) => item.objectId)).toEqual(['early', 'late']);
    expect(items[0]!.gatedActions).toEqual(['approve']);
    expect(items[1]!.gatedActions).toEqual(['issue', 'record-payment', 'chase']);
    expect(pendingChangeCount(items)).toBe(3);
  });
});

describe('reviewPendingChanges', () => {
  it('stamps every waiting change with the approver, on the same entries the change created', () => {
    const outcome = reviewPendingChanges(budget, BEN, '2026-09-12T08:00:00Z', 'approve');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.count).toBe(2);
    const trail = readProvenance(outcome.patch);
    expect(trail).toHaveLength(2);
    expect(trail.every((item) => item.approvedBy?.ref === 'u-ben' && item.approvedAt === '2026-09-12T08:00:00Z')).toBe(true);
    expect(pendingApprovals(outcome.patch)).toEqual([]);
  });

  it('refuses self-approval with the gate\'s own rule', () => {
    const mine = { kind: 'budget', provenance: [entry('plannedTotal', '2026-09-10T10:00:00Z', ANA)] };
    const outcome = reviewPendingChanges(mine, ANA, '2026-09-12T08:00:00Z', 'approve');
    expect(outcome).toMatchObject({ ok: false, reason: 'self-approval' });
  });

  it('lets the author withdraw their own change by refusing it', () => {
    const mine = { kind: 'budget', provenance: [entry('plannedTotal', '2026-09-10T10:00:00Z', ANA)] };
    const outcome = reviewPendingChanges(mine, ANA, '2026-09-12T08:00:00Z', 'refuse');
    expect(outcome.ok).toBe(true);
  });

  it('never lets an agent review, and says so when nothing is waiting', () => {
    expect(reviewPendingChanges(budget, BRAIN, 'now', 'approve')).toMatchObject({ ok: false, reason: 'not-a-person' });
    expect(reviewPendingChanges({ kind: 'budget' }, BEN, 'now', 'approve')).toMatchObject({ ok: false, reason: 'nothing-pending' });
  });

  it('a refused change stops waiting but is not approved, so the gated act stays blocked', () => {
    const outcome = reviewPendingChanges(budget, BEN, '2026-09-12T08:00:00Z', 'refuse');
    if (!outcome.ok) throw new Error('expected a refusal patch');
    const trail = readProvenance(outcome.patch);
    expect(trail.every((item) => item.refusedBy?.ref === 'u-ben' && !item.approvedBy)).toBe(true);
    expect(pendingApprovals(outcome.patch)).toEqual([]);
    const verdict = evaluateGate({ kind: 'budget', action: 'approve', actor: BEN, provenance: trail });
    expect(verdict).toMatchObject({ allowed: false, reason: 'awaiting-approval' });
  });
});

describe('actsUnblockedBy', () => {
  it('names the acts a reviewer\'s signature would let go ahead — and none for the author or an open object', () => {
    expect(actsUnblockedBy(budget, BEN)).toEqual(['approve']);
    const mine = { kind: 'invoice', provenance: [entry('amount', 'x', ANA)] };
    expect(actsUnblockedBy(mine, ANA)).toEqual([]);
    expect(actsUnblockedBy({ ...budget, approvalMode: 'open' }, BEN)).toEqual([]);
  });
});
