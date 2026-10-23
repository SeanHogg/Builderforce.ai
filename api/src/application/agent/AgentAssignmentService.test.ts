/**
 * AgentAssignmentService — the ONE agent-assignment use case (project staffing and the
 * workspace identity included since migration 1265). Pins the cache contract (one
 * per-tenant version token, bumped on every write; lane staffing read uncached), the
 * project-scope write shape, the staffing side-effect's "keep what is there" rule, and
 * the capability cleanup order on unassign, the expected-target guard, and scopeId
 * normalisation (workspace forced tenant-wide, project ids canonical).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheKeys: string[] = [];
const getOrSetCached = vi.fn(async (_env: unknown, key: string, load: () => Promise<unknown>) => {
  cacheKeys.push(key);
  return load();
});
const bumpVersion = vi.fn(async (_key: string, _op: string, _env?: unknown) => undefined);
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: (...a: Parameters<typeof getOrSetCached>) => getOrSetCached(...a),
}));
vi.mock('../../infrastructure/cache/versionToken', () => ({
  versionToken: async () => 'v7',
  ambientEnv: () => undefined,
  bumpVersion: (...a: Parameters<typeof bumpVersion>) => bumpVersion(...a),
}));

const { AgentAssignmentService } = await import('./AgentAssignmentService');
const { agentAssignments, artifactAssignments, cronJobs } = await import('../../infrastructure/database/schema');

type Op = { kind: 'select' | 'insert' | 'update' | 'delete'; table: unknown; values?: Record<string, unknown>; set?: Record<string, unknown> };

/** A Drizzle-shaped fake: each select consumes the next queued result; insert/update
 *  `returning()` consume the next queued returning result. Every op is recorded. */
function fakeDb(selects: unknown[][], returning: unknown[][] = []) {
  const ops: Op[] = [];
  const rowsOf = (rows: unknown[]) => {
    const p = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
    p.limit = () => Promise.resolve(rows);
    return p;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        ops.push({ kind: 'select', table });
        return { where: () => rowsOf(selects.shift() ?? []) };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        ops.push({ kind: 'insert', table, values });
        const out = returning.shift() ?? [];
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve(out) }) };
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          ops.push({ kind: 'update', table, set });
          return { returning: () => Promise.resolve(returning.shift() ?? []) };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        ops.push({ kind: 'delete', table });
        return Promise.resolve([]);
      },
    }),
  };
  return { db: db as never, ops };
}

function row(over: Partial<typeof agentAssignments.$inferSelect> = {}): typeof agentAssignments.$inferSelect {
  const at = new Date('2026-10-01T00:00:00.000Z');
  return {
    id: 'a-1', tenantId: 3, segmentId: null, agentKind: 'workforce', agentRef: 'agent-1',
    scope: 'project', scopeId: '12', executionScope: 'project', role: 'default', name: 'Ada',
    runtime: null, target: null, taskTemplate: null, requiredCapabilities: null, model: null,
    position: 0, agentHandle: 41, projectId: 12, governance: null, addedBy: null,
    createdAt: at, updatedAt: at,
    ...over,
  };
}

const env = {} as never;

describe('AgentAssignmentService', () => {
  beforeEach(() => {
    cacheKeys.length = 0;
    getOrSetCached.mockClear();
    bumpVersion.mockClear();
  });

  it('serves a project list through the per-tenant version token, mapped to the wire shape', async () => {
    const { db } = fakeDb([[row()]]);
    const out = await new AgentAssignmentService(db, env).listForProject(3, 12);
    expect(cacheKeys).toEqual(['agent-assign:3:v7:project:12']);
    expect(out).toEqual([expect.objectContaining({
      id: 'a-1', agentHandle: 41, projectId: 12, name: 'Ada', createdAt: '2026-10-01T00:00:00.000Z',
    })]);
  });

  it('reads lane staffing uncached — its writers never bump the token', async () => {
    const { db } = fakeDb([[row({ scope: 'swimlane', scopeId: 'lane-1', projectId: null })]]);
    const out = await new AgentAssignmentService(db, env).list(3, 'swimlane', 'lane-1');
    expect(getOrSetCached).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  it('goes straight to the database without an Env', async () => {
    const { db } = fakeDb([[row()]]);
    await new AgentAssignmentService(db).list(3, 'project', '12');
    expect(getOrSetCached).not.toHaveBeenCalled();
  });

  it('staffs a project with the real project FK beside scopeId and bumps the token', async () => {
    const created = row({ id: 'a-2', agentHandle: 99 });
    const { db, ops } = fakeDb([[]], [[created]]);
    const out = await new AgentAssignmentService(db, env).assign(3, {
      agentKind: 'workforce', agentRef: 'agent-1', scope: 'project', scopeId: '12', name: ' Ada ', addedBy: 'u-1',
    });
    const insert = ops.find((o) => o.kind === 'insert');
    expect(insert?.table).toBe(agentAssignments);
    expect(insert?.values).toMatchObject({
      tenantId: 3, scope: 'project', scopeId: '12', projectId: 12, executionScope: 'project',
      role: 'default', name: 'Ada', addedBy: 'u-1',
    });
    expect(out.agentHandle).toBe(99);
    expect(bumpVersion).toHaveBeenCalledWith('agent-assignments:3', 'bumpAgentAssignmentsVersion', env);
  });

  it("leaves an existing assignment untouched with onExisting 'keep'", async () => {
    const { db, ops } = fakeDb([[row({ role: 'architect' })]]);
    const out = await new AgentAssignmentService(db, env).assign(3, {
      agentKind: 'workforce', agentRef: 'agent-1', scope: 'project', scopeId: '12', role: 'reviewer', onExisting: 'keep',
    });
    expect(out.role).toBe('architect');
    expect(ops.some((o) => o.kind === 'insert' || o.kind === 'update')).toBe(false);
    expect(bumpVersion).not.toHaveBeenCalled();
  });

  it('updates only the fields provided on an existing assignment', async () => {
    const existing = row({ executionScope: 'global', role: 'architect' });
    const { db, ops } = fakeDb([[existing]], [[{ ...existing, role: 'reviewer' }]]);
    await new AgentAssignmentService(db, env).assign(3, {
      agentKind: 'workforce', agentRef: 'agent-1', scope: 'project', scopeId: '12', role: 'reviewer',
    });
    const update = ops.find((o) => o.kind === 'update');
    expect(update?.set).toMatchObject({ executionScope: 'global', role: 'reviewer' });
    expect(update?.set).not.toHaveProperty('name');
  });

  it('ensures a workspace identity (tenant-wide, executionScope global) and returns its handle', async () => {
    const identity = row({ id: 'w-1', scope: 'workspace', scopeId: null, projectId: null, executionScope: 'global', agentHandle: 7 });
    const { db, ops } = fakeDb([[]], [[identity]]);
    const handle = await new AgentAssignmentService(db, env).ensureIdentity(3, { agentRef: 'agent-1', name: 'Ada', addedBy: null });
    expect(handle).toBe(7);
    expect(ops.find((o) => o.kind === 'insert')?.values).toMatchObject({
      scope: 'workspace', scopeId: null, projectId: null, executionScope: 'global', agentKind: 'workforce',
    });
  });

  it('removes capabilities and schedules BEFORE the assignment on unassign, then bumps', async () => {
    const { db, ops } = fakeDb([[row()]]);
    const ok = await new AgentAssignmentService(db, env).unassign(3, '5b2f6a3e-0000-4000-8000-000000000001', { scope: 'project', scopeId: '12' });
    expect(ok).toBe(true);
    const deletes = ops.filter((o) => o.kind === 'delete').map((o) => o.table);
    expect(deletes).toEqual([artifactAssignments, cronJobs, agentAssignments]);
    expect(bumpVersion).toHaveBeenCalledTimes(1);
  });

  it('refuses to unassign a row that is not the target the caller named', async () => {
    // A chat route handed an id that belongs to ANOTHER chat (or to a project staffing).
    const otherChat = row({ scope: 'chat', scopeId: '99', projectId: null });
    const { db, ops } = fakeDb([[otherChat], [row()]]);
    const svc = new AgentAssignmentService(db, env);
    expect(await svc.unassign(3, '5b2f6a3e-0000-4000-8000-000000000001', { scope: 'chat', scopeId: '7' })).toBe(false);
    expect(await svc.unassign(3, '5b2f6a3e-0000-4000-8000-000000000001', { scope: 'chat', scopeId: '7' })).toBe(false);
    expect(ops.some((o) => o.kind === 'delete')).toBe(false);
    expect(bumpVersion).not.toHaveBeenCalled();
  });

  it('forces a workspace identity tenant-wide and normalises a project scopeId', async () => {
    const { db, ops } = fakeDb([[], []], [[row({ scope: 'workspace', scopeId: null, projectId: null })], [row()]]);
    const svc = new AgentAssignmentService(db, env);
    await svc.assign(3, { agentKind: 'workforce', agentRef: 'agent-1', scope: 'workspace', scopeId: '42' });
    await svc.assign(3, { agentKind: 'workforce', agentRef: 'agent-1', scope: 'project', scopeId: '012' });
    const inserts = ops.filter((o) => o.kind === 'insert').map((o) => o.values);
    expect(inserts[0]).toMatchObject({ scope: 'workspace', scopeId: null, projectId: null });
    expect(inserts[1]).toMatchObject({ scope: 'project', scopeId: '12', projectId: 12 });
  });

  it('answers null for an id that is neither a handle nor a uuid, without querying', async () => {
    const { db, ops } = fakeDb([]);
    expect(await new AgentAssignmentService(db, env).find(3, 'not-an-id')).toBeNull();
    expect(ops).toHaveLength(0);
  });

  it('answers false and writes nothing when the assignment is not in the tenant', async () => {
    const { db, ops } = fakeDb([[]]);
    expect(await new AgentAssignmentService(db, env).unassign(3, '41', { scope: 'project' })).toBe(false);
    expect(ops.some((o) => o.kind === 'delete')).toBe(false);
  });

  it('maps workspace identities of one kind to their handles, first per ref', async () => {
    const { db } = fakeDb([[
      row({ scope: 'workspace', agentRef: 'a', agentHandle: 1 }),
      row({ scope: 'workspace', agentRef: 'b', agentHandle: 2 }),
      row({ scope: 'workspace', agentRef: 'c', agentHandle: 3, agentKind: 'registered' }),
    ]]);
    const handles = await new AgentAssignmentService(db, env).identityHandles(3, 'workforce', ['a', 'c']);
    expect([...handles]).toEqual([['a', 1]]);
  });
});
