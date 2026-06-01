import { describe, expect, it, vi } from 'vitest';
import { RepoService, normalizePrStatus, type ClawDispatcher } from './RepoService';
import {
  projectRepositories,
  pullRequests,
  repoBranches,
  tasks,
  specs,
} from '../../infrastructure/database/schema';

/**
 * Minimal chainable fake of the Drizzle Db surface used by RepoService.
 *
 * - select().from(table)... resolves to a queued result keyed by table.
 * - insert(table).values(v).returning() records the insert and echoes the row.
 * - update(table).set(v).where(..).returning() records and echoes.
 *
 * The thenable chain ignores .innerJoin/.where/.orderBy/.limit and just resolves
 * to the queued rows for the leading table, which is enough to exercise the
 * service's branching.
 */
type TableRef = typeof tasks | typeof projectRepositories | typeof pullRequests | typeof specs | typeof repoBranches;

function makeFakeDb(opts: {
  selectByTable: Map<TableRef, unknown[]>;
}) {
  const inserts: Array<{ table: TableRef; values: Record<string, unknown> }> = [];

  function selectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    chain.from = passthrough;
    chain.innerJoin = passthrough;
    chain.leftJoin = passthrough;
    chain.where = passthrough;
    chain.orderBy = passthrough;
    chain.limit = passthrough;
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return chain;
  }

  const db = {
    select(_proj?: unknown) {
      return {
        from(table: TableRef) {
          const rows = opts.selectByTable.get(table) ?? [];
          return selectChain(rows);
        },
      };
    },
    insert(table: TableRef) {
      return {
        values(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return {
            returning() {
              return Promise.resolve([{ id: `inserted-${inserts.length}`, ...values }]);
            },
          };
        },
      };
    },
    update(table: TableRef) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                returning() {
                  return Promise.resolve([{ id: 'updated', _table: table, ...values }]);
                },
              };
            },
          };
        },
      };
    },
  };

  return { db: db as never, inserts };
}

const TENANT = 1;

describe('normalizePrStatus', () => {
  it('accepts known statuses case-insensitively', () => {
    expect(normalizePrStatus('OPEN')).toBe('open');
    expect(normalizePrStatus('merged')).toBe('merged');
  });
  it('rejects unknown / empty', () => {
    expect(normalizePrStatus('weird')).toBeNull();
    expect(normalizePrStatus(null)).toBeNull();
    expect(normalizePrStatus(undefined)).toBeNull();
  });
});

describe('RepoService.dispatchPrCreation', () => {
  it('returns task_not_found when no task row', () => {
    const { db } = makeFakeDb({ selectByTable: new Map([[tasks, []]]) });
    const dispatcher: ClawDispatcher = vi.fn(async () => true);
    const svc = new RepoService(db, dispatcher);
    return svc.dispatchPrCreation(99, TENANT).then((res) => {
      expect(res).toEqual({ ok: false, code: 'task_not_found', reason: 'Task not found' });
      expect(dispatcher).not.toHaveBeenCalled();
    });
  });

  it('returns no_claw (409 mapping) when task has no assigned claw', async () => {
    const { db } = makeFakeDb({
      selectByTable: new Map([
        [tasks, [{ id: 5, projectId: 10, title: 'T', description: null, status: 'ready', specId: null, source: null, assignedClawId: null }]],
      ]),
    });
    const dispatcher: ClawDispatcher = vi.fn(async () => true);
    const svc = new RepoService(db, dispatcher);
    const res = await svc.dispatchPrCreation(5, TENANT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('no_claw');
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('returns no_repo when no repo resolves (no repos at all)', async () => {
    const { db } = makeFakeDb({
      selectByTable: new Map<TableRef, unknown[]>([
        [tasks, [{ id: 5, projectId: 10, title: 'T', description: 'desc', status: 'ready', specId: null, source: null, assignedClawId: 7 }]],
        [projectRepositories, []],
      ]),
    });
    const dispatcher: ClawDispatcher = vi.fn(async () => true);
    const svc = new RepoService(db, dispatcher);
    const res = await svc.dispatchPrCreation(5, TENANT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('no_repo');
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('dispatches, records branch + PR, and returns ok when a default repo resolves', async () => {
    const repoRow = {
      id: 'repo-1',
      tenantId: TENANT,
      segmentId: null,
      projectId: 10,
      provider: 'github',
      host: 'github.com',
      owner: 'acme',
      repo: 'web',
      defaultBranch: 'main',
      isDefault: true,
      matchHints: null,
    };
    const { db, inserts } = makeFakeDb({
      selectByTable: new Map<TableRef, unknown[]>([
        [tasks, [{ id: 5, projectId: 10, title: 'Add feature', description: 'unrelated', status: 'ready', specId: null, source: 'JIRA-1', assignedClawId: 7 }]],
        [projectRepositories, [repoRow]],
      ]),
    });
    const dispatcher: ClawDispatcher = vi.fn(async () => true);
    const svc = new RepoService(db, dispatcher);

    const res = await svc.dispatchPrCreation(5, TENANT);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.clawId).toBe(7);
      expect(res.message.type).toBe('create_pr');
      expect(res.message.branchName).toBe('task/jira-1-add-feature');
      expect(res.message.base).toBe('main');
    }
    // dispatcher called with the resolved claw id and the create_pr message.
    expect(dispatcher).toHaveBeenCalledTimes(1);
    const [clawId, message] = (dispatcher as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(clawId).toBe(7);
    expect((message as { type: string }).type).toBe('create_pr');

    // both a repoBranches and a pullRequests row were inserted.
    const branchInsert = inserts.find((i) => i.table === repoBranches);
    const prInsert = inserts.find((i) => i.table === pullRequests);
    expect(branchInsert).toBeTruthy();
    expect(prInsert).toBeTruthy();
    expect(prInsert?.values.status).toBe('open');
    expect(prInsert?.values.tenantId).toBe(TENANT);
    expect(branchInsert?.values.name).toBe('task/jira-1-add-feature');
  });

  it('returns dispatch_failed when the claw does not acknowledge (but still records the PR)', async () => {
    const repoRow = {
      id: 'repo-1', tenantId: TENANT, segmentId: null, projectId: 10,
      provider: 'github', host: 'github.com', owner: 'acme', repo: 'web',
      defaultBranch: 'main', isDefault: true, matchHints: null,
    };
    const { db, inserts } = makeFakeDb({
      selectByTable: new Map<TableRef, unknown[]>([
        [tasks, [{ id: 5, projectId: 10, title: 'T', description: 'd', status: 'ready', specId: null, source: null, assignedClawId: 7 }]],
        [projectRepositories, [repoRow]],
      ]),
    });
    const dispatcher: ClawDispatcher = vi.fn(async () => false);
    const svc = new RepoService(db, dispatcher);
    const res = await svc.dispatchPrCreation(5, TENANT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('dispatch_failed');
    // PR row still recorded.
    expect(inserts.find((i) => i.table === pullRequests)).toBeTruthy();
  });
});

describe('RepoService.recordPrResult', () => {
  it('updates and returns the row', async () => {
    const { db } = makeFakeDb({ selectByTable: new Map() });
    const svc = new RepoService(db, vi.fn(async () => true));
    const row = await svc.recordPrResult('pr-1', TENANT, { number: 42, url: 'https://x/pr/42', status: 'open' });
    expect(row).toBeTruthy();
    expect((row as Record<string, unknown>).number).toBe(42);
    expect((row as Record<string, unknown>).status).toBe('open');
  });

  it('drops an invalid status (does not set it)', async () => {
    const { db } = makeFakeDb({ selectByTable: new Map() });
    const svc = new RepoService(db, vi.fn(async () => true));
    const row = (await svc.recordPrResult('pr-1', TENANT, { status: 'bogus' })) as Record<string, unknown>;
    expect(row.status).toBeUndefined();
  });
});
