import { describe, expect, it } from 'vitest';
import { planBatchIngest, type BatchIngestItem } from './batchIngestPlan';

function item(
  clientRef: string,
  dependsOn: string[] = [],
  entityType = 'ticket',
  operation = 'create',
): BatchIngestItem {
  return { clientRef, entityType, operation, dependsOn };
}

describe('planBatchIngest', () => {
  it('orders a batch so each item follows the client refs it depends on', () => {
    const input = [
      item('link', ['chat', 'task'], 'link'),
      item('task', ['project']),
      item('chat', [], 'chat'),
      item('project', [], 'project'),
    ];
    const before = input.map((entry) => entry.clientRef);

    const plan = planBatchIngest(input);

    expect(input.map((entry) => entry.clientRef)).toEqual(before);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.items.map((entry) => entry.clientRef)).toEqual(['chat', 'project', 'task', 'link']);
    expect(plan.items.map((entry) => entry.entityType)).toEqual(['chat', 'project', 'ticket', 'link']);
    expect(plan.acknowledgements).toEqual([
      { clientRef: 'chat', status: 'planned' },
      { clientRef: 'project', status: 'planned' },
      { clientRef: 'task', status: 'planned' },
      { clientRef: 'link', status: 'planned' },
    ]);
    const position = new Map(plan.items.map((entry, index) => [entry.clientRef, index]));
    for (const entry of plan.items) {
      for (const dependency of entry.dependsOn) {
        expect(position.get(dependency)).toBeLessThan(position.get(entry.clientRef) ?? -1);
      }
    }
  });

  it('keeps input order when items do not depend on each other', () => {
    const plan = planBatchIngest([item('task-b'), item('task-a')]);
    expect(plan).toEqual({
      ok: true,
      items: [item('task-b'), item('task-a')],
      acknowledgements: [
        { clientRef: 'task-b', status: 'planned' },
        { clientRef: 'task-a', status: 'planned' },
      ],
    });
  });

  it('plans nothing when a dependency is not in the batch', () => {
    const plan = planBatchIngest([
      item('chat', [], 'chat'),
      item('task', ['project-missing']),
    ]);
    expect(plan).toEqual({
      ok: false,
      reason: 'missing_dependency',
      clientRef: 'task',
      missing: 'project-missing',
    });
    expect(plan).not.toHaveProperty('items');
    expect(plan).not.toHaveProperty('acknowledgements');
  });

  it('plans nothing when dependsOn forms a cycle', () => {
    const plan = planBatchIngest([
      item('chat', ['task'], 'chat'),
      item('task', ['chat']),
    ]);
    expect(plan).toEqual({ ok: false, reason: 'cycle' });
    expect(plan).not.toHaveProperty('items');
    expect(plan).not.toHaveProperty('acknowledgements');
  });

  it('treats a self-dependency as a cycle and plans nothing', () => {
    expect(planBatchIngest([item('task', ['task'])])).toEqual({ ok: false, reason: 'cycle' });
  });
});
