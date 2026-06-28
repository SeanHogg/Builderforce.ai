import { describe, expect, it } from 'vitest';
import {
  summarizeAllocation,
  taskEffortHours,
  effectiveCategory,
  effectiveCostClass,
  type AllocationTaskRow,
} from './allocationInsights';
import {
  deriveAllocationCategory,
  normalizeAllocationCategory,
  defaultCostClassFor,
} from '../llm/allocationCategories';

const NOW = Date.UTC(2026, 5, 27, 12, 0, 0);
const H = 3_600_000;

const noAssignee = {
  assignedUserId: null, assignedUserName: null,
  assignedAgentHostId: null, assignedHostName: null, assignedAgentRef: null,
};

function row(over: Partial<AllocationTaskRow>): AllocationTaskRow {
  return {
    taskId: 1, title: null, description: null, source: null,
    actionType: null, allocationCategory: null, costClass: null,
    createdAt: new Date(NOW - 10 * H), completedAt: null, updatedAt: new Date(NOW),
    ...noAssignee, ...over,
  };
}

describe('deriveAllocationCategory', () => {
  it('maps action types to investment categories', () => {
    expect(deriveAllocationCategory({ actionType: 'frontend_ui' })).toBe('innovation');
    expect(deriveAllocationCategory({ actionType: 'backend_api' })).toBe('innovation');
    expect(deriveAllocationCategory({ actionType: 'bugfix' })).toBe('ktlo');
    expect(deriveAllocationCategory({ actionType: 'tests' })).toBe('ktlo');
    expect(deriveAllocationCategory({ actionType: 'refactor' })).toBe('tech_debt');
    expect(deriveAllocationCategory({ actionType: 'other' })).toBe('other');
  });
  it('lets keyword hints override the action-type default', () => {
    // A "feature"-looking ticket flagged as an incident lands in support.
    expect(deriveAllocationCategory({ actionType: 'backend_api', title: 'Sev-1 outage hotfix' })).toBe('support');
    expect(deriveAllocationCategory({ actionType: 'backend_api', description: 'pay down tech debt' })).toBe('tech_debt');
  });
  it('normalizes unknown/garbage to other', () => {
    expect(normalizeAllocationCategory('nope')).toBe('other');
    expect(normalizeAllocationCategory(null)).toBe('other');
  });
});

describe('defaultCostClassFor', () => {
  it('capitalizes only net-new innovation by default', () => {
    expect(defaultCostClassFor('innovation')).toBe('capex');
    expect(defaultCostClassFor('ktlo')).toBe('opex');
    expect(defaultCostClassFor('support')).toBe('opex');
    expect(defaultCostClassFor('tech_debt')).toBe('opex');
  });
});

describe('taskEffortHours', () => {
  it('uses cycle time for completed tasks', () => {
    const r = row({ createdAt: new Date(NOW - 5 * H), completedAt: new Date(NOW - 2 * H) });
    expect(taskEffortHours(r, NOW)).toBeCloseTo(3);
  });
  it('uses age-to-now for in-flight tasks', () => {
    const r = row({ createdAt: new Date(NOW - 4 * H), completedAt: null, updatedAt: new Date(NOW) });
    expect(taskEffortHours(r, NOW)).toBeCloseTo(4);
  });
  it('clamps a stale long-lived task to the 30-day cap', () => {
    const r = row({ createdAt: new Date(NOW - 1000 * 24 * H), completedAt: null, updatedAt: new Date(NOW) });
    expect(taskEffortHours(r, NOW)).toBe(24 * 30);
  });
});

describe('effectiveCategory / effectiveCostClass', () => {
  it('prefers the stored override, else derives', () => {
    expect(effectiveCategory(row({ allocationCategory: 'support', actionType: 'backend_api' }))).toBe('support');
    expect(effectiveCategory(row({ allocationCategory: null, actionType: 'refactor' }))).toBe('tech_debt');
  });
  it('prefers stored cost_class, else the category default', () => {
    expect(effectiveCostClass(row({ costClass: 'opex', actionType: 'frontend_ui' }))).toBe('opex'); // override wins
    expect(effectiveCostClass(row({ costClass: null, actionType: 'frontend_ui' }))).toBe('capex');  // innovation → capex
    expect(effectiveCostClass(row({ costClass: null, actionType: 'bugfix' }))).toBe('opex');        // ktlo → opex
  });
});

describe('summarizeAllocation', () => {
  const rows: AllocationTaskRow[] = [
    // 4h innovation, $1 (capex)
    row({ taskId: 1, actionType: 'frontend_ui', createdAt: new Date(NOW - 4 * H), completedAt: new Date(NOW) }),
    // 2h innovation
    row({ taskId: 2, actionType: 'backend_api', createdAt: new Date(NOW - 2 * H), completedAt: new Date(NOW) }),
    // 6h ktlo, $2 (opex)
    row({ taskId: 3, actionType: 'bugfix', createdAt: new Date(NOW - 6 * H), completedAt: new Date(NOW) }),
  ];
  const cost = new Map<number, number>([[1, 100_000], [3, 200_000]]); // $1 capex, $2 opex

  it('attributes effort hours and pct per category', () => {
    const r = summarizeAllocation(rows, cost, 30, NOW);
    expect(r.totals.hours).toBeCloseTo(12);
    const innov = r.byCategory.find((b) => b.category === 'innovation')!;
    const ktlo = r.byCategory.find((b) => b.category === 'ktlo')!;
    expect(innov.hours).toBeCloseTo(6);
    expect(innov.pct).toBeCloseTo(50);
    expect(innov.taskCount).toBe(2);
    expect(ktlo.hours).toBeCloseTo(6);
    expect(ktlo.pct).toBeCloseTo(50);
  });

  it('splits cost into capex/opex and computes capitalizable share', () => {
    const r = summarizeAllocation(rows, cost, 30, NOW);
    expect(r.totals.costUsd).toBeCloseTo(3);
    expect(r.totals.capexUsd).toBeCloseTo(1);
    expect(r.totals.opexUsd).toBeCloseTo(2);
    expect(r.totals.capitalizablePct).toBeCloseTo((1 / 3) * 100);
  });

  it('merges goal targets and computes variance', () => {
    const goals = new Map([['innovation', 70] as [import('../llm/allocationCategories').AllocationCategory, number]]);
    const r = summarizeAllocation(rows, cost, 30, NOW, goals);
    const innov = r.byCategory.find((b) => b.category === 'innovation')!;
    expect(innov.targetPct).toBe(70);
    expect(innov.variancePct).toBeCloseTo(50 - 70); // under target by 20
  });

  it('rolls up per-member with category spread', () => {
    const withMember = rows.map((r) => ({ ...r, assignedUserId: 'u1', assignedUserName: 'Dev One' }));
    const r = summarizeAllocation(withMember, cost, 30, NOW);
    expect(r.byMember).toHaveLength(1);
    expect(r.byMember[0]!.memberName).toBe('Dev One');
    expect(r.byMember[0]!.totalHours).toBeCloseTo(12);
    expect(r.byMember[0]!.categorySpread).toBe(2); // innovation + ktlo
  });

  it('handles an empty window without dividing by zero', () => {
    const r = summarizeAllocation([], new Map(), 30, NOW);
    expect(r.totals.hours).toBe(0);
    expect(r.totals.capitalizablePct).toBe(0);
    expect(r.byCategory.every((b) => b.pct === 0)).toBe(true);
  });
});
