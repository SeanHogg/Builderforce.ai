import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  findPage: vi.fn(), findIndexRows: vi.fn(), countMatching: vi.fn(), findTypesByIds: vi.fn(),
}));
const after = vi.hoisted(() => ({ afterTaskBulkWrite: vi.fn(async () => undefined) }));
const clearance = vi.hoisted(() => ({ cleared: false }));
vi.mock('../../infrastructure/repositories/TaskRepository', () => ({ TaskRepository: function () { return repo; } }));
vi.mock('../task/afterTaskBulkWrite', () => after);
// The clearance gate: a SECURITY row comes back masked for an uncleared caller.
vi.mock('./builtinTaskVisibility', () => ({
  hasSecurityClearance: vi.fn(async () => clearance.cleared),
  maskSecurityTasks: vi.fn(async (_ctx: unknown, rows: Array<Record<string, unknown>>) =>
    (clearance.cleared ? rows : rows.map((r) => (r.taskType === 'security' ? { ...r, title: '', restricted: true } : r)))),
}));

import type { BuiltinCtx } from './builtinToolContext';
import { TASK_BULK_TOOLS } from './taskBulkToolCatalog';

const archiveMany = vi.fn();
const projectRows = vi.fn(async () => [] as unknown[]);
const db = { select: () => ({ from: () => ({ where: () => ({ limit: projectRows }) }) }) };
const ctx = { tenantId: 7, db, env: {}, tasks: { archiveMany } } as unknown as BuiltinCtx;
const run = (name: string, args: Record<string, unknown>, c: BuiltinCtx = ctx) => {
  const entry = TASK_BULK_TOOLS.find((t) => t.tool === name);
  if (!entry) throw new Error(`missing ${name}`);
  return entry.run(c, args);
};

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, projectId: 3, status: 'backlog', taskType: 'task', parentTaskId: 100, title: `[QA Engineer] Ticket ${id}`, archived: false, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearance.cleared = false;
  repo.countMatching.mockResolvedValue(10_000);
});

describe('tasks.archive_where', () => {
  it('refuses a missing filter and one with no SELECTIVE field', async () => {
    await expect(run('tasks.archive_where', {})).rejects.toThrow(/filter is required/);
    await expect(run('tasks.archive_where', { filter: {} })).rejects.toThrow(/at least one selective field/);
    for (const filter of [{ scope: 'closed' }, { assigned: 'none' }, { topLevelOnly: true }, { isFanoutCopy: false }, { createdBefore: '2026-11-01' }, { parentTaskId: null }]) {
      await expect(run('tasks.archive_where', { filter, dryRun: false })).rejects.toThrow(/refusing to archive a whole workspace/);
    }
    expect(repo.findIndexRows).not.toHaveBeenCalled();
    expect(archiveMany).not.toHaveBeenCalled();
  });

  it('refuses a restore with scope "open"', async () => {
    await expect(run('tasks.archive_where', { filter: { scope: 'open', isFanoutCopy: true }, archived: false }))
      .rejects.toThrow(/scope "open" excludes archived tickets/);
  });

  it('is a dry run by default: counts and samples, writes nothing', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(i + 1));
    repo.findIndexRows.mockResolvedValue({ rows, total: 25 });

    const res = await run('tasks.archive_where', { filter: { isFanoutCopy: true, titlePrefix: '[QA Engineer]' } }) as {
      dryRun: boolean; count: number; matched: number; sample: string[];
    };

    expect(res).toMatchObject({ dryRun: true, count: 25, matched: 25 });
    expect(res.sample).toHaveLength(20);
    expect(res.sample[0]).toBe('1|backlog|task|100|[QA Engineer] Ticket 1');
    // Archiving reads only not-yet-archived rows under the default `all` scope, never hidden SECURITY ones.
    expect(repo.findIndexRows).toHaveBeenCalledWith(7, expect.objectContaining({ scope: 'all', isFanoutCopy: true, titlePrefix: '[QA Engineer]' }), { limit: 500 }, { archived: false, excludeTaskTypes: ['security'] });
    expect(archiveMany).not.toHaveBeenCalled();
    expect(after.afterTaskBulkWrite).not.toHaveBeenCalled();
  });

  it('a cleared caller matches SECURITY tickets too', async () => {
    clearance.cleared = true;
    repo.findIndexRows.mockResolvedValue({ rows: [], total: 0 });
    await run('tasks.archive_where', { filter: { taskType: 'security' } });
    expect(repo.findIndexRows).toHaveBeenCalledWith(7, expect.anything(), { limit: 500 }, { archived: false });
  });

  it('dryRun:false archives the page through TaskService.archiveMany ONCE and invalidates once', async () => {
    repo.findIndexRows.mockResolvedValue({ rows: [row(1), row(2)], total: 5 });
    archiveMany.mockResolvedValue([{ id: 1, projectId: 3 }, { id: 2, projectId: 3 }]);

    const res = await run('tasks.archive_where', { filter: { parentTaskId: 100 }, dryRun: false, limit: 2.9 });

    // The fractional limit is floored before it reaches SQL.
    expect(repo.findIndexRows).toHaveBeenCalledWith(7, expect.anything(), { limit: 2 }, expect.anything());
    expect(archiveMany).toHaveBeenCalledTimes(1);
    expect(archiveMany).toHaveBeenCalledWith(7, [1, 2], true);
    expect(res).toEqual({ archived: 2, ids: [1, 2], remaining: 3 });
    expect(after.afterTaskBulkWrite).toHaveBeenCalledWith(ctx.env, 7, [3, 3]);
  });

  it('refuses a write that would hit every ticket in the workspace', async () => {
    repo.findIndexRows.mockResolvedValue({ rows: [row(1), row(2)], total: 2 });
    repo.countMatching.mockResolvedValue(2);

    await expect(run('tasks.archive_where', { filter: { createdAfter: '2020-01-01' }, dryRun: false }))
      .rejects.toThrow(/matches every non-archived ticket in this workspace \(2\)/);
    expect(repo.countMatching).toHaveBeenCalledWith(7, { scope: 'all' }, { archived: false, excludeTaskTypes: ['security'] });
    expect(archiveMany).not.toHaveBeenCalled();
  });

  it('restores with archived:false, reading only archived rows', async () => {
    repo.findIndexRows.mockResolvedValue({ rows: [row(4, { archived: true })], total: 1 });
    archiveMany.mockResolvedValue([{ id: 4, projectId: 3 }]);

    const res = await run('tasks.archive_where', { filter: { titleMatch: 'ticket' }, archived: false, dryRun: false, limit: 99999 });

    expect(repo.findIndexRows).toHaveBeenCalledWith(7, expect.anything(), { limit: 2000 }, { archived: true, excludeTaskTypes: ['security'] });
    expect(archiveMany).toHaveBeenCalledWith(7, [4], false);
    expect(res).toEqual({ restored: 1, ids: [4] });
  });

  it('hands the invalidation to waitUntil when the invocation has one', async () => {
    const waitUntil = vi.fn();
    repo.findIndexRows.mockResolvedValue({ rows: [row(1)], total: 1 });
    archiveMany.mockResolvedValue([{ id: 1, projectId: 3 }]);
    await run('tasks.archive_where', { filter: { status: 'backlog' }, dryRun: false }, { ...ctx, executionCtx: { waitUntil } } as unknown as BuiltinCtx);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});

describe('tasks.list (SQL-filtered)', () => {
  it('passes the filter params to the repository page and keeps the envelope', async () => {
    clearance.cleared = true;
    repo.findPage.mockResolvedValue({ tasks: [{ toPlain: () => row(10) }], total: 3 });

    const res = await run('tasks.list', { titlePrefix: '[QA Engineer]', isFanoutCopy: true, assigned: 'any', limit: 1, offset: 1, fields: 'slim' });

    expect(repo.findPage).toHaveBeenCalledWith(7, expect.objectContaining({ scope: 'open', titlePrefix: '[QA Engineer]', isFanoutCopy: true, assigned: 'any' }), { limit: 1, offset: 1 }, {});
    expect(res).toMatchObject({ total: 3, returned: 1, offset: 1, truncated: true, nextOffset: 2, scope: 'open' });
  });

  // regression: a title/assignee filter counted hidden SECURITY tickets — `total` was an oracle.
  it('excludes SECURITY tickets in SQL when an uncleared caller filters on a masked field', async () => {
    repo.findPage.mockResolvedValue({ tasks: [], total: 0 });
    await run('tasks.list', { titleMatch: 'CVE', fields: 'slim' });
    expect(repo.findPage).toHaveBeenLastCalledWith(7, expect.anything(), { limit: 50, offset: 0 }, { excludeTaskTypes: ['security'] });
    await run('tasks.list', { assigned: 'none', fields: 'slim' });
    expect(repo.findPage).toHaveBeenLastCalledWith(7, expect.anything(), expect.anything(), { excludeTaskTypes: ['security'] });
    // A filter on unmasked fields keeps them (surfaced, masked).
    await run('tasks.list', { status: 'todo', fields: 'slim' });
    expect(repo.findPage).toHaveBeenLastCalledWith(7, expect.anything(), expect.anything(), {});
  });

  it('index mode reads light rows with the full total', async () => {
    repo.findIndexRows.mockResolvedValue({ rows: [row(10), row(11)], total: 5 });

    const res = await run('tasks.list', { scope: 'all', fields: 'index', limit: 2, offset: 2 });

    expect(repo.findIndexRows).toHaveBeenCalledWith(7, expect.objectContaining({ scope: 'all' }), { limit: 2, offset: 2 }, {});
    expect(repo.findPage).not.toHaveBeenCalled();
    expect(res).toMatchObject({ total: 5, returned: 2, offset: 2, truncated: true, nextOffset: 4, format: 'id|status|type|parent|title' });
  });

  it('a non-numeric offset/limit never reaches SQL', async () => {
    repo.findPage.mockResolvedValue({ tasks: [], total: 0 });
    await run('tasks.list', { limit: 'abc', offset: 'NaN' });
    expect(repo.findPage).toHaveBeenCalledWith(7, expect.anything(), { limit: 50, offset: 0 }, {});
  });

  it('an empty page for a project outside the workspace is NotFound', async () => {
    repo.findPage.mockResolvedValue({ tasks: [], total: 0 });
    projectRows.mockResolvedValueOnce([]);
    await expect(run('tasks.list', { projectId: 99 })).rejects.toThrow(/Project '99' not found/);
    projectRows.mockResolvedValueOnce([{ id: 99 }]);
    await expect(run('tasks.list', { projectId: 99 })).resolves.toMatchObject({ total: 0, tasks: [] });
  });
});

describe('tasks.archive_many', () => {
  it('reports invalid, unknown and restricted ids as failed; writes the rest once', async () => {
    repo.findTypesByIds.mockResolvedValue([{ id: 7, projectId: 4, taskType: 'task' }, { id: 9, projectId: 4, taskType: 'security' }]);
    archiveMany.mockResolvedValue([{ id: 7, projectId: 4 }]);

    const res = await run('tasks.archive_many', { ids: [7, 'not-an-id', 8, 9] });

    expect(repo.findTypesByIds).toHaveBeenCalledWith(7, [7, 8, 9]);
    expect(archiveMany).toHaveBeenCalledWith(7, [7], true);
    expect(res).toMatchObject({ archived: [7], count: 1 });
    expect((res as { failed: Array<{ id: unknown; error: string }> }).failed).toEqual([
      { id: 'not-an-id', error: expect.stringMatching(/id must be a server id/) },
      { id: 8, error: 'Task not found' },
      { id: 9, error: 'restricted: a security ticket you are not cleared for' },
    ]);
    expect(after.afterTaskBulkWrite).toHaveBeenCalledWith(ctx.env, 7, [4]);
  });
});
