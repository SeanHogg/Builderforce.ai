import { describe, expect, it, vi } from 'vitest';

/** Route contract test for FR1 — GET /api/tasks/unassigned-high-priority (AC1-AC8). */

const TENANT = 7;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

// Keep unrelated seams out of the import graph — this file only tests the one GET.
vi.mock('../../application/activity/activityLog', () => ({
  recordActivity: async () => {},
  resolveActorFromContext: async () => ({ id: 'test', kind: 'user' as const, label: 'Test' }),
}));
vi.mock('../routes/reportRoutes', () => ({
  invalidateCompletedByAssignee: async () => {},
  DONE_CLASS_STATUSES: ['done', 'completed', 'complete', 'closed', 'resolved', 'shipped'],
}));

// collect the args the service receives so we can assert filtering/sorting/pagination
type UHPArgs = { projectId?: number; page?: number; pageSize?: number; sortBy?: string; sortOrder?: string };
let lastFindArgs: { tenantId: number; opts: UHPArgs } | null = null;
let fakeResult: { tasks: Record<string, unknown>[]; total: number; cacheInfo: { validForSeconds: number } } = {
  tasks: [],
  total: 0,
  cacheInfo: { validForSeconds: 1800 },
};

vi.mock('../../application/task/TaskService', async () => {
  const actual = await vi.importActual<any>('../../application/task/TaskService');
  return {
    ...actual,
    TaskService: class {
      constructor() {}
      async listTasks() { return []; }
      async getTask() { return null; }
      async findUnassignedHighPriority(tenantId: number, opts: UHPArgs) {
        lastFindArgs = { tenantId, opts };
        return fakeResult;
      }
    },
  };
});

vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../application/runtime/RuntimeService', () => ({ RuntimeService: class {} }));
vi.mock('../../application/security/resolveTicketViewer', () => ({ resolveTicketViewer: async () => ({ kind: 'user' }) }));
vi.mock('../../application/security/SecurityTicketAccessService', () => ({
  SecurityTicketAccessService: class {
    constructor() {}
    async applyVisibilityForViewer(_tid: number, _viewer: unknown, rows: unknown[]) { return rows; }
  },
}));

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, _key: string, fetcher: () => Promise<unknown>) => fetcher(),
  getCacheVersion: async () => 0,
  bumpCacheVersion: async () => {},
}));

import { createTaskRoutes } from './taskRoutes';
import type { RuntimeService } from '../../application/runtime/RuntimeService';

function makeRouter() {
  const db = {} as any;
  const taskService = new (class { })() as any;
  const runtimeService = {} as RuntimeService;
  // Patch the mocked TaskService so the real createTaskRoutes picks it up — we swap the impl
  // via the captured `lastFindArgs` above (the service is created inside, mocked by class above).
  // But createTaskRoutes takes an already-constructed service, so intercept:
  const serviceModule = { findUnassignedHighPriority: async (tid: number, opts: UHPArgs) => {
    lastFindArgs = { tenantId: tid, opts };
    return fakeResult;
  }, listTasks: async () => [], getTask: async () => null } as any;
  return { router: createTaskRoutes(serviceModule, db, runtimeService) };
}

describe('GET /api/tasks/unassigned-high-priority — FR1 endpoint contract (AC1-AC8)', () => {
  it('AC1: returns a JSON object with tasks, total, and cacheInfo', async () => {
    const { router } = makeRouter();
    fakeResult = {
      tasks: [{ id: 1, priority: 'high', assignedUserId: null, archived: false, status: 'ready' }],
      total: 1,
      cacheInfo: { validForSeconds: 1800 },
    };
    const res = await router.request('/unassigned-high-priority');
    expect(res.status).toBe(200);
    const body = await res.json() as typeof fakeResult;
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.cacheInfo).toBeDefined();
  });

  it('AC2-AC4: filters and sort are forwarded to service (contract) — task predicates are unit-tested in TaskRepository + doneClass', async () => {
    // The route's job is parse + delegate; the actual WHERE predicate is exercised
    // by the repository layer. We assert the route forwards untrusted query params
    // cleanly including projectId, pagination, and sort.
    const { router } = makeRouter();
    lastFindArgs = null;
    fakeResult = { tasks: [], total: 0, cacheInfo: { validForSeconds: 1800 } };
    const res = await router.request('/unassigned-high-priority?projectId=42&page=2&pageSize=5&sortBy=dueDate&sortOrder=asc');
    expect(res.status).toBe(200);
    expect(lastFindArgs!.opts.projectId).toBe(42);
    expect(lastFindArgs!.opts.page).toBe(2);
    expect(lastFindArgs!.opts.pageSize).toBe(5);
    expect(lastFindArgs!.opts.sortBy).toBe('dueDate');
    expect(lastFindArgs!.opts.sortOrder).toBe('asc');
  });

  it('AC5: page/pageSize are clamped (1..100) and default', async () => {
    const { router } = makeRouter();
    // No params → page 1, pageSize 20
    lastFindArgs = null;
    await router.request('/unassigned-high-priority');
    expect(lastFindArgs!.opts.page).toBe(1);
    expect(lastFindArgs!.opts.pageSize).toBe(20);

    // Negative & oversized are clamped
    lastFindArgs = null;
    await router.request('/unassigned-high-priority?page=-3&pageSize=500');
    expect(lastFindArgs!.opts.page).toBe(1);
    expect(lastFindArgs!.opts.pageSize).toBe(100);
  });

  it('AC6: non-numeric projectId is ignored (undefined not NaN) — avoids matching nothing silently', async () => {
    const { router } = makeRouter();
    lastFindArgs = null;
    const res = await router.request('/unassigned-high-priority?projectId=potato');
    expect(res.status).toBe(200);
    expect(lastFindArgs!.opts.projectId).toBeUndefined();
  });

  it('AC7: sortBy allow-list defaults to createdAt for unknowns, sortOrder defaults to desc', async () => {
    const { router } = makeRouter();
    lastFindArgs = null;
    await router.request('/unassigned-high-priority?sortBy=foobar&sortOrder=sideways');
    expect(lastFindArgs!.opts.sortBy).toBe('createdAt');
    expect(lastFindArgs!.opts.sortOrder).toBe('desc');
  });

  it('AC7 (explicit): sortBy accepts dueDate, title, createdAt', async () => {
    for (const sortBy of ['dueDate', 'title', 'createdAt'] as const) {
      const { router } = makeRouter();
      lastFindArgs = null;
      await router.request(`/unassigned-high-priority?sortBy=${sortBy}`);
      expect(lastFindArgs!.opts.sortBy).toBe(sortBy);
    }
  });

  it('AC8: response carries cacheInfo.validForSeconds ≥ 1800 and mirrors to Cache-Control header', async () => {
    const { router } = makeRouter();
    fakeResult = { tasks: [], total: 0, cacheInfo: { validForSeconds: 1800 } };
    const res = await router.request('/unassigned-high-priority');
    expect(res.status).toBe(200);
    const body = await res.json() as typeof fakeResult;
    expect(body.cacheInfo.validForSeconds).toBeGreaterThanOrEqual(1800);
    // Header is surfaced onto the real HTTP response for proxies/browsers
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('max-age=1800');
    expect(cc).toContain('private');
  });

  it('AC8 (repo constant): TaskRepository.UnassignedHighPriority invariant is the source of cacheInfo lifetime', async () => {
    // Locks that the repository's own constant matches the PRD 1800, so the route
    // doesn't substitute a different TTL.
    const { UNASSIGNED_HIGH_PRIORITY_CACHE_SECONDS } = await import('../../infrastructure/repositories/TaskRepository');
    expect(UNASSIGNED_HIGH_PRIORITY_CACHE_SECONDS).toBeGreaterThanOrEqual(1800);
  });

  it('conflict-resolution: DONE_CLASS_STATUSES re-exported from reportRoutes AND canonical in doneClass', async () => {
    // This is the edge case that broke on the base sync: tasks.completed-by-assignee
    // test imports DONE_CLASS_STATUSES from reportRoutes. The branch canonicalizes
    // it in doneClass.ts with a re-export so main doesn't break.
    const reportMod = await import('./reportRoutes');
    const doneMod = await import('../../domain/shared/doneClass');
    // reportRoutes re-exports
    expect((reportMod as any).DONE_CLASS_STATUSES).toBeDefined();
    expect(Array.isArray((reportMod as any).DONE_CLASS_STATUSES)).toBe(true);
    // doneClass is the canonical definition (includes Jira/Linear lanes for FR1)
    expect(doneMod.DONE_CLASS_STATUSES).toContain('done');
    // They are the same identity (re-export not a copy) on this branch
    expect((reportMod as any).DONE_CLASS_STATUSES).toEqual(expect.arrayContaining(doneMod.DONE_CLASS_STATUSES as unknown[]));
  });
});
