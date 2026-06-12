import { describe, expect, it } from 'vitest';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { tasks, projectRepositories } from '../../infrastructure/database/schema';

type TableRef = typeof tasks | typeof projectRepositories;

/**
 * Minimal chainable fake Db: select().from(table)…resolves to the rows queued for
 * that table. resolveDefaultRepoForTask issues two selects (the task, then the
 * project's repos), each keyed by its leading table — enough to exercise the
 * explicit-pin / inferred / default precedence wiring.
 */
function makeFakeDb(rowsByTable: Map<TableRef, unknown[]>) {
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    const pass = () => c;
    c.from = pass; c.where = pass; c.orderBy = pass; c.limit = pass;
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return c;
  }
  return {
    select() {
      return { from: (table: TableRef) => chain(rowsByTable.get(table) ?? []) };
    },
  } as never;
}

const TASK = (over: Record<string, unknown> = {}) => ({
  projectId: 1, title: 'Website audit', description: 'benefit-driven CTAs', explicitRepoId: null, ...over,
});
const REPO = (id: string, over: Record<string, unknown> = {}) => ({
  id, isDefault: false, provider: 'github', owner: 'acme', repo: id, defaultBranch: 'main', matchHints: null, ...over,
});

describe('resolveDefaultRepoForTask — run-time repo selection wiring', () => {
  it('honors an explicit pin (tasks.explicit_repo_id) over the project default', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [TASK({ explicitRepoId: 'site' })]],
      [projectRepositories, [REPO('api', { isDefault: true }), REPO('site')]],
    ]));
    const res = await resolveDefaultRepoForTask(db, 7, 23);
    expect(res?.repoId).toBe('site');
  });

  it('falls back to the single default when nothing is pinned or inferred', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [TASK()]],
      [projectRepositories, [REPO('api'), REPO('site', { isDefault: true })]],
    ]));
    const res = await resolveDefaultRepoForTask(db, 7, 23);
    expect(res?.repoId).toBe('site');
  });

  it('infers the repo from its matchHints vs the task text', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [TASK({ description: 'redesign the website landing copy' })]],
      [projectRepositories, [
        REPO('api', { matchHints: JSON.stringify({ keywords: ['backend'] }) }),
        REPO('site', { matchHints: JSON.stringify({ keywords: ['website'] }) }),
      ]],
    ]));
    const res = await resolveDefaultRepoForTask(db, 7, 23);
    expect(res?.repoId).toBe('site');
  });

  it('returns null when the project has no repos', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [TASK()]],
      [projectRepositories, []],
    ]));
    expect(await resolveDefaultRepoForTask(db, 7, 23)).toBeNull();
  });
});
