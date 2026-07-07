/**
 * Tests for epic completion metrics in the planning spine.
 *
 * AC.1: 0 linked items → 0%
 * AC.2: N linked, all Done → 100%
 * AC.3: N linked, M Done (0 < M < N) → (M/N * 100)%, rounded
 */

import { describe, expect, it } from 'vitest';

import { buildSpine } from './planningSpine';

describe('epic completion percent', () => {
  it('AC.1: epic with 0 linked tasks shows 0% complete', () => {
    const skeleton = {
      portfolios: [],
      objectives: [],
      initiatives: [],
      projects: [],
      tasks: [{ id: 1001, taskIdType: 'task', taskType: 'epic', title: 'Q1 Core Epic', status: 'inactive', startDate: null, dueDate: null, createdAt: new Date(), completedAt: null, parentTaskId: null, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null }],
      taskLlm: [],
      memberRates: [],
      links: [],
      loggedMinutesByTask: new Map(),
      roadmapItems: [],
    };

    const spine = buildSpine(skeleton);
    const epic = spine.nodes.find((n) => n.key === 'epic:1001');
    expect(epic).toBeDefined();
    expect(epic?.kind).toBe('epic');
    expect(epic?.completionPercent).toBe(0);
    expect(epic?.totalItems).toBe(0);
    expect(epic?.completedItems).toBe(0);
  });

  it('AC.2: epic with multiple done tasks shows 100% complete', () => {
    const skeleton = {
      portfolios: [],
      objectives: [],
      initiatives: [],
      projects: [],
      tasks: [
        { id: 1, taskIdType: 'task', taskType: 'epic', title: 'Epic One', status: 'done', startDate: null, dueDate: null, createdAt: new Date(), completedAt: new Date(), parentTaskId: null, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 2, taskIdType: 'task', taskType: 'task', title: 'Task A', status: 'done', startDate: null, dueDate: null, createdAt: new Date(), completedAt: new Date(), parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 3, taskIdType: 'task', taskType: 'task', title: 'Task B', status: 'done', startDate: null, dueDate: null, createdAt: new Date(), completedAt: new Date(), parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 4, taskIdType: 'task', taskType: 'task', title: 'Task C', status: 'done', startDate: null, dueDate: null, createdAt: new Date(), completedAt: new Date(), parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
      ],
      taskLlm: [],
      memberRates: [],
      links: [],
      loggedMinutesByTask: new Map(),
      roadmapItems: [],
    };

    const spine = buildSpine(skeleton);
    const epic = spine.nodes.find((n) => n.key === 'epic:1');
    expect(epic).toBeDefined();
    expect(epic?.kind).toBe('epic');
    expect(epic?.completionPercent).toBe(100);
    expect(epic?.totalItems).toBe(3);
    expect(epic?.completedItems).toBe(3);
  });

  it('AC.3: epic with partial completion shows correct percent (rounded)', () => {
    // (1 / 5) * 100 = 20; should round to nearest whole number
    const skeleton = {
      portfolios: [],
      objectives: [],
      initiatives: [],
      projects: [],
      tasks: [
        { id: 1, taskIdType: 'task', taskType: 'epic', title: 'Epic One', status: 'active', startDate: null, dueDate: null, createdAt: new Date(), completedAt: null, parentTaskId: null, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 2, taskIdType: 'task', taskType: 'task', title: 'Task A', status: 'done', startDate: null, dueDate: null, createdAt: new Date(), completedAt: new Date(), parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 3, taskIdType: 'task', taskType: 'task', title: 'Task B', status: 'done', startDate: null, dueDate: null, createdAt: new Date(), completedAt: new Date(), parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 4, taskIdType: 'task', taskType: 'task', title: 'Task C', status: 'in-progress', startDate: null, dueDate: null, createdAt: new Date(), completedAt: null, parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 5, taskIdType: 'task', taskType: 'task', title: 'Task D', status: 'backlog', startDate: null, dueDate: null, createdAt: new Date(), completedAt: null, parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
        { id: 6, taskIdType: 'task', taskType: 'task', title: 'Task E', status: 'backlog', startDate: null, dueDate: null, createdAt: new Date(), completedAt: null, parentTaskId: 1, initiativeId: null, projectId: null, assignedUserId: null, costClass: null, costClassSource: 'inherited', costClassVerified: false, actionType: null, source: null, allocationCategory: null },
      ],
      taskLlm: [],
      memberRates: [],
      links: [],
      loggedMinutesByTask: new Map(),
      roadmapItems: [],
    };

    const spine = buildSpine(skeleton);
    const epic = spine.nodes.find((n) => n.key === 'epic:1');
    expect(epic).toBeDefined();
    expect(epic?.kind).toBe('epic');
    expect(epic?.completionPercent).toBe(20);
    expect(epic?.totalItems).toBe(5);
    expect(epic?.completedItems).toBe(2);
  });
});