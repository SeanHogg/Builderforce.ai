import { describe, expect, it } from 'vitest';
import { buildSpine, classifyCostClass, type RawTask } from './planningSpine';

describe('classifyCostClass (rides the shared allocation taxonomy)', () => {
  it('treats net-new development as CAPEX', () => {
    expect(classifyCostClass({ title: 'Export builder', actionType: 'backend_api' }).costClass).toBe('capex');
    expect(classifyCostClass({ title: 'Settings page', actionType: 'frontend_ui' }).costClass).toBe('capex');
  });

  it('treats fixing/maintaining existing behaviour as OPEX', () => {
    expect(classifyCostClass({ title: 'Crash on logout', actionType: 'bugfix' }).costClass).toBe('opex');
    expect(classifyCostClass({ title: 'Refactor billing module', actionType: 'refactor' }).costClass).toBe('opex');
    expect(classifyCostClass({ title: 'Update dependencies', actionType: 'devops_ci' }).costClass).toBe('opex');
  });

  it('a new capability delivered through a bug fix is still CAPEX (innovation hint wins)', () => {
    const r = classifyCostClass({ title: 'Bug fix that ships a new feature prototype', actionType: 'bugfix' });
    expect(r.costClass).toBe('capex');
  });

  it('honours a stored allocation_category override with higher confidence', () => {
    const r = classifyCostClass({ title: 'anything', actionType: 'bugfix', allocationCategory: 'innovation' });
    expect(r.costClass).toBe('capex');
    expect(r.confidence).toBeGreaterThan(0.8);
  });
});

const baseTask = (over: Partial<RawTask>): RawTask => ({
  id: 0, projectId: 1, parentTaskId: null, initiativeId: null, taskType: 'task',
  title: 'task', description: null, status: 'backlog', startDate: null, dueDate: null,
  createdAt: new Date('2026-01-01'), completedAt: null, assignedUserId: null,
  costClass: null, costClassSource: 'inherited', costClassVerified: false,
  actionType: null, source: null, allocationCategory: null, ...over,
});

describe('buildSpine', () => {
  it('rolls LLM cost from tasks up to the initiative and bucket by CAPEX/OPEX', () => {
    const r = buildSpine({
      portfolios: [],
      objectives: [],
      initiatives: [{ id: 'i1', name: 'Init', status: 'active', startDate: null, targetDate: null, portfolioId: null, costClass: 'capex', costClassSource: 'manual' }],
      projects: [{ id: 1, initiativeId: 'i1' }],
      tasks: [
        baseTask({ id: 10, projectId: 1 }), // inherits capex from initiative
        baseTask({ id: 11, projectId: 1, costClass: 'opex', costClassSource: 'manual' }), // override → opex + anomaly
      ],
      links: [],
      taskLlm: [{ taskId: 10, millicents: 200_000 }, { taskId: 11, millicents: 100_000 }], // $2 + $1
      memberRates: [],
    });
    const init = r.nodes.find((n) => n.key === 'initiative:i1')!;
    expect(init.cost.totalUsd).toBeCloseTo(3, 5);
    expect(init.cost.capexUsd).toBeCloseTo(2, 5); // task 10 inherited capex
    expect(init.cost.opexUsd).toBeCloseTo(1, 5);  // task 11 overridden to opex
    expect(init.hasDescendantAnomaly).toBe(true);
    const t11 = r.nodes.find((n) => n.key === 'task:11')!;
    expect(t11.anomaly).toBe(true); // declared opex contradicts inherited capex
    expect(r.anomalyCount).toBe(1);
  });

  it('inherits cost class from an objective through an objective link', () => {
    const r = buildSpine({
      portfolios: [],
      objectives: [{ id: 'o1', title: 'Goal', status: 'active', startDate: null, endDate: null, portfolioId: null, initiativeId: null, costClass: 'capex', costClassSource: 'manual' }],
      initiatives: [],
      projects: [{ id: 1, initiativeId: null }],
      tasks: [baseTask({ id: 20, projectId: 1 })],
      links: [{ objectiveId: 'o1', linkKind: 'task', initiativeId: null, taskId: 20 }],
      taskLlm: [{ taskId: 20, millicents: 100_000 }],
      memberRates: [],
    });
    const task = r.nodes.find((n) => n.key === 'task:20')!;
    expect(task.parentKey).toBe('objective:o1');
    expect(task.effectiveCostClass).toBe('capex'); // flowed from the objective
    const obj = r.nodes.find((n) => n.key === 'objective:o1')!;
    expect(obj.cost.capexUsd).toBeCloseTo(1, 5);
  });

  it('estimates human labour cost from cycle time and member rate', () => {
    const r = buildSpine({
      portfolios: [], objectives: [], initiatives: [], projects: [{ id: 1, initiativeId: null }],
      tasks: [baseTask({
        id: 30, projectId: 1, assignedUserId: 'u1',
        createdAt: new Date('2026-01-01T00:00:00Z'), completedAt: new Date('2026-01-01T02:00:00Z'), // 2h
      })],
      links: [],
      taskLlm: [],
      memberRates: [{ memberRef: 'u1', costRateUsdCents: 5000 }], // $50/h
    });
    const task = r.nodes.find((n) => n.key === 'task:30')!;
    expect(task.cost.humanUsd).toBeCloseTo(100, 5); // 2h * $50
  });
});
