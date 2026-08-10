/**
 * The SQL the generic entity layer actually emits (PRD 20 §5 step 5).
 *
 * `EntityService.test.ts` proves the refusals; this proves the queries. One
 * service builds statements for 245 tables from reflected metadata, so the
 * failure mode is not a bad branch — it is a statement that is subtly wrong on
 * every table at once: an unbounded list, an ORDER BY that never made it in, a
 * tenant predicate that silently vanished for a table whose column is named
 * something else, a `RETURNING` that hands back a column redaction removed.
 *
 * Drizzle's pg-proxy driver is a real `Db` whose transport is a callback, so the
 * emitted SQL and its parameters can be asserted WITHOUT a database — which is
 * the only way this can run in CI beside the other guards.
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { createRow, getRow, listRows, requireEntity, updateRow } from './EntityService';

const env = {} as Env;
const TENANT = 42;

/** A Db that records every statement and answers with one empty row. */
function recorder() {
  const seen: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(async (sql, params) => {
    seen.push({ sql, params });
    return { rows: [] };
  }) as unknown as Db;
  return { db, seen, last: () => seen[seen.length - 1] };
}

describe('list', () => {
  it('scopes to the tenant, bounds the page and orders deterministically', async () => {
    const { db, seen } = recorder();
    await listRows(db, env, TENANT, requireEntity('hiring', 'job_applications'), { limit: 10 });

    const select = seen.find((s) => s.sql.startsWith('select'));
    expect(select, 'no select was emitted').toBeDefined();
    expect(select!.sql).toContain('"job_applications"');
    expect(select!.sql).toMatch(/"tenant_id" = \$\d/);
    expect(select!.sql).toMatch(/order by/i);
    expect(select!.sql).toMatch(/limit \$\d/i);
    expect(select!.params).toContain(TENANT);
  });

  it('never selects a column redaction removed', async () => {
    const { db, seen } = recorder();
    await listRows(db, env, TENANT, requireEntity('kernel', 'credentials'), {});
    const select = seen.find((s) => s.sql.startsWith('select'))!;
    expect(select.sql).not.toContain('secret_enc');
    expect(select.sql).not.toContain('secret_iv');
  });

  it('hides retired rows unless they are asked for', async () => {
    const shares = requireEntity('kernel', 'share_links');
    expect(shares.archiveKey, 'share_links declares no retirement column').not.toBeNull();

    const live = recorder();
    await listRows(live.db, env, TENANT, shares, {});
    expect(live.seen[0]!.sql).toMatch(/is null/i);

    const all = recorder();
    await listRows(all.db, env, TENANT, shares, { includeArchived: true });
    expect(all.seen[0]!.sql).not.toMatch(/is null/i);
  });

  it('searches the title column rather than every column', async () => {
    const { db, seen } = recorder();
    await listRows(db, env, TENANT, requireEntity('growth', 'email_campaigns'), { q: 'launch' });
    const select = seen.find((s) => s.sql.startsWith('select'))!;
    expect(select.sql).toMatch(/ilike/i);
    expect(select.params).toContain('%launch%');
  });

  it('clamps a limit a caller inflates', async () => {
    const { db, seen } = recorder();
    await listRows(db, env, TENANT, requireEntity('growth', 'email_campaigns'), { limit: 100_000 });
    // 200 is MAX_LIMIT. An unbounded result set is the anti-pattern a generic
    // reader arrives at fastest.
    expect(seen[0]!.params).toContain(200);
  });
});

describe('get', () => {
  it('addresses the row by key AND tenant, so another tenant’s id resolves to nothing', async () => {
    const { db, seen } = recorder();
    await getRow(db, env, TENANT, requireEntity('revenue', 'deals'), '17');
    expect(seen[0]!.sql).toMatch(/"id" = \$\d/);
    expect(seen[0]!.sql).toMatch(/"tenant_id" = \$\d/);
    expect(seen[0]!.params).toEqual(expect.arrayContaining([17, TENANT]));
  });
});

describe('write', () => {
  it('stamps tenancy from the session on create', async () => {
    const { db, seen } = recorder();
    // The insert returns no row, so the use case throws AFTER emitting the
    // statement — which is the statement under test.
    await createRow(db, env, TENANT, requireEntity('hiring', 'job_applications'), {
      candidate_ref: 'cand-1',
    }).catch(() => undefined);

    const insert = seen.find((s) => s.sql.startsWith('insert'));
    expect(insert, 'no insert was emitted').toBeDefined();
    expect(insert!.sql).toContain('"job_applications"');
    expect(insert!.sql).toMatch(/returning/i);
    expect(insert!.params).toEqual(expect.arrayContaining([TENANT, 'cand-1']));
  });

  it('scopes an update to the tenant as well as the key', async () => {
    const { db, seen } = recorder();
    await updateRow(db, env, TENANT, requireEntity('hiring', 'job_applications'), '3', {
      status: 'screening',
    }).catch(() => undefined);

    const update = seen.find((s) => s.sql.startsWith('update'))!;
    expect(update.sql).toMatch(/"tenant_id" = \$\d/);
    expect(update.params).toEqual(expect.arrayContaining(['screening', 3, TENANT]));
  });
});
