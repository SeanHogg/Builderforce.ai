import { describe, expect, it, vi } from 'vitest';
import { buildTaskCensus, MAX_CENSUS_GROUPS, TASK_CENSUS_TOOLS } from './taskCensusToolCatalog';
import type { BuiltinCtx } from './builtinToolContext';

const tool = TASK_CENSUS_TOOLS.find((t) => t.tool === 'tasks.census')!;

const ROWS = [
  { id: 1, status: 'backlog', taskType: 'task', parentTaskId: 9, assignedUserId: 'u1' },
  { id: 2, status: 'backlog', taskType: 'bug', parentTaskId: null, assignedAgentRef: 'bob' },
  { id: 3, status: 'in_review', taskType: 'task', parentTaskId: 9 },
  { id: 4, status: 'done', taskType: 'task', parentTaskId: null },
  { id: 5, status: 'cancelled', taskType: 'bug', parentTaskId: null },
  { id: 6, status: 'in_progress', taskType: 'task', parentTaskId: null, archived: true },
];

function ctxFor(rows = ROWS) {
  const listTasks = vi.fn(async () => rows.map((r) => ({ toPlain: () => r })));
  return { ctx: { tenantId: 7, tasks: { listTasks }, db: {} } as unknown as BuiltinCtx, listTasks };
}

describe('tasks.census', () => {
  // regression: chat #273 — 13 `tasks.list { limit: 1 }` calls, one per GUESSED status.
  it('counts open tickets by the statuses and types that actually occur, in one call', async () => {
    const { ctx, listTasks } = ctxFor();
    const res = await tool.run(ctx, { projectId: 11 });
    expect(listTasks).toHaveBeenCalledWith(7, 11, false);
    expect(res).toEqual({
      projectId: 11, scope: 'open', total: 3,
      byStatus: { backlog: 2, in_review: 1 },
      byType: { task: 2, bug: 1 },
    });
  });

  it('honours tasks.list scope semantics (closed = done, cancelled or archived)', async () => {
    const { ctx, listTasks } = ctxFor();
    const closed = await tool.run(ctx, { projectId: 11, scope: 'closed' }) as { total: number; byStatus: Record<string, number> };
    expect(listTasks).toHaveBeenLastCalledWith(7, 11, true);
    expect(closed.total).toBe(3);
    expect(closed.byStatus).toEqual({ cancelled: 1, done: 1, in_progress: 1 });
    const all = await tool.run(ctx, { scope: 'all' }) as { total: number };
    expect(listTasks).toHaveBeenLastCalledWith(7, undefined, true);
    expect(all.total).toBe(6);
  });

  it('groups by parent / assignee', async () => {
    const { ctx } = ctxFor();
    expect(await tool.run(ctx, { groupBy: 'parent' })).toMatchObject({ groupBy: 'parent', groups: [{ key: '9', count: 2 }, { key: '(none)', count: 1 }] });
    expect(await tool.run(ctx, { groupBy: 'assignee' })).toMatchObject({
      groups: [{ key: '(unassigned)', count: 1 }, { key: 'agent:bob', count: 1 }, { key: 'user:u1', count: 1 }],
    });
  });

  it('keeps integer-like parent keys ranked largest first after serialization', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ status: 'todo', taskType: 'task', parentTaskId: 900 })),
      { status: 'todo', taskType: 'task', parentTaskId: 5 },
    ];
    const census = JSON.parse(JSON.stringify(buildTaskCensus(rows, 'open', 'parent'))) as { groups: Array<{ key: string }> };
    expect(census.groups.map((g) => g.key)).toEqual(['900', '5']);
  });

  it('rejects an unknown groupBy', async () => {
    const { ctx } = ctxFor();
    await expect(tool.run(ctx, { groupBy: 'colour' })).rejects.toThrow(/groupBy must be one of/);
  });

  it('is read-only and counts a masked ticket\'s assignee as restricted', () => {
    expect(tool.mutates).toBe(false);
    const census = buildTaskCensus([{ status: 'todo', taskType: 'security', restricted: true }], 'open', 'assignee');
    expect(census.groups).toEqual([{ key: '(restricted)', count: 1 }]);
  });

  it('caps the group breakdown and sums the rest into otherGroups', () => {
    const rows = Array.from({ length: MAX_CENSUS_GROUPS + 5 }, (_, i) => ({ status: 'todo', taskType: 'task', parentTaskId: i + 1 }));
    const census = buildTaskCensus(rows, 'open', 'parent');
    expect(census.groups).toHaveLength(MAX_CENSUS_GROUPS);
    expect(census.otherGroups).toBe(5);
  });
});
