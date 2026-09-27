import { describe, expect, it } from 'vitest';
import { resolveRepoLink, resolveRepoLinks } from './activityIngest';
import { projectRepositories, projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

// A thenable drizzle-ish builder: the awaited value is whatever `rows(table)` yields
// for the table passed to .from() — the same fake `githubAlerts.test.ts` uses.
function fakeDb(rows: (table: unknown) => unknown[]): Db {
  const builder: Record<string, unknown> = {};
  let current: unknown = null;
  Object.assign(builder, {
    select: () => builder,
    from: (t: unknown) => { current = t; return builder; },
    where: () => builder,
    limit: () => builder,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows(current)).then(res, rej),
  });
  return builder as unknown as Db;
}

describe('resolveRepoLinks', () => {
  it('returns every tenant that links the repo, de-duplicated, repo links first', async () => {
    const db = fakeDb((table) => {
      if (table === projectRepositories) return [{ tenantId: 1, projectId: 10 }, { tenantId: 2, projectId: 20 }];
      if (table === projects) return [{ tenantId: 2, id: 20 }, { tenantId: 3, id: 30 }];
      return [];
    });
    expect(await resolveRepoLinks(db, 'acme/app')).toEqual([
      { tenantId: 1, projectId: 10 },
      { tenantId: 2, projectId: 20 },
      { tenantId: 3, projectId: 30 },
    ]);
    expect(await resolveRepoLink(db, 'acme/app')).toEqual({ tenantId: 1, projectId: 10 });
  });

  it('is empty (and resolveRepoLink null) when nothing links the repo', async () => {
    const db = fakeDb(() => []);
    expect(await resolveRepoLinks(db, 'acme/app')).toEqual([]);
    expect(await resolveRepoLink(db, 'acme/app')).toBeNull();
  });
});
