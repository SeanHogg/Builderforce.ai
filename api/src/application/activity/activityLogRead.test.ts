import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getActivityLog } from './activityLog';
import { objects } from '../../infrastructure/database/schema';

const dialect = new PgDialect();

interface Captured { joined?: unknown; where?: string; limit?: number; offset?: number; from: unknown[] }

/** A db double that records the statements the read builds. The terminal call
 *  (`offset` for the log query, `where` for a bare objects lookup) answers `rows`. */
function fakeDb(rows: Array<Record<string, unknown>>, objectRows: Array<Record<string, unknown>> = []) {
  const seen: Captured = { from: [] };
  let table: unknown;
  const chain: Record<string, unknown> = {
    from: (t: unknown) => { table = t; seen.from.push(t); return chain; },
    leftJoin: (t: unknown) => { seen.joined = t; return chain; },
    where: (predicate: SQL) => {
      if (table === objects) return Promise.resolve(objectRows);
      seen.where = dialect.sqlToQuery(predicate).sql;
      return chain;
    },
    orderBy: () => chain,
    limit: (n: number) => { seen.limit = n; return chain; },
    offset: (n: number) => { seen.offset = n; return Promise.resolve(rows); },
  };
  return { db: { select: () => chain } as never, seen };
}

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, actorType: 'human', actorRef: 'u1', actorName: 'Ann', engagementId: null, verb: 'task.created',
  targetType: 'task', targetId: String(id), targetLabel: `T${id}`, summary: null, projectId: 3,
  occurredAt: new Date('2026-10-17T00:00:00.000Z'), metadata: null, objectId: null,
  ...extra,
});

/** No cache bindings — the read-through helpers fall through to the loader. Each
 *  case uses its OWN tenant id: the in-process L1 still memoises by key, and the
 *  version token is per tenant, so distinct tenants can never share a cached page. */
const ENV = {} as never;

describe('getActivityLog — THE activity read every feed filters', () => {
  it('scopes to the tenant and names each row\'s object WITHOUT a cross-database join', async () => {
    const { db, seen } = fakeDb([row(2, { objectId: 'o1' })], [{ id: 'o1', kind: 'task', title: 'Ship it' }]);
    const page = await getActivityLog(ENV, db, 101, {});
    expect(seen.where).toContain('"activity_log"."tenant_id" = $1');
    // `objects` is on the core database and `activity_log` on the operational one: a join 500s.
    expect(seen.joined).toBeUndefined();
    expect(page.events[0]).toMatchObject({ id: 2, objectId: 'o1', objectKind: 'task', objectTitle: 'Ship it', occurredAt: '2026-10-17T00:00:00.000Z' });
  });

  it('does not touch objects at all when no row carries an object id', async () => {
    const { db, seen } = fakeDb([row(3)]);
    const page = await getActivityLog(ENV, db, 108, {});
    expect(seen.from).not.toContain(objects);
    expect(page.events[0]).toMatchObject({ objectId: null, objectKind: null, objectTitle: null });
  });

  it('serves the object trail (objectId) and the seat timeline (domain) as filters on the same query', async () => {
    const obj = fakeDb([]);
    await getActivityLog(ENV, obj.db, 102, { objectId: 'o1' });
    expect(obj.seen.where).toContain('"activity_log"."object_id"');

    const seat = fakeDb([row(9, { objectId: 'o9' })], [{ id: 'o9', kind: 'deal', title: 'Acme' }]);
    const page = await getActivityLog(ENV, seat.db, 103, { domain: 'finance' });
    expect(seat.seen.from).toContain(objects);
    expect(seat.seen.where).toContain('"activity_log"."object_id" in');
    expect(page.events[0]).toMatchObject({ objectKind: 'deal' });
  });

  it('answers an empty page for a domain with no objects', async () => {
    const { db } = fakeDb([row(1, { objectId: 'x' })], []);
    const page = await getActivityLog(ENV, db, 109, { domain: 'nowhere' });
    expect(page).toEqual({ events: [], nextCursor: null });
  });

  it('matches the legacy audit event type against the verb with dots underscored', async () => {
    const { db, seen } = fakeDb([]);
    await getActivityLog(ENV, db, 104, { eventType: 'user_login', targetType: 'session', actorRef: 'u1' });
    expect(seen.where).toContain('replace("activity_log"."verb"');
    expect(seen.where).toContain('"activity_log"."target_type"');
    expect(seen.where).toContain('"activity_log"."actor_ref"');
  });

  it('pages by keyset cursor or by offset, reading one extra row to know there is more', async () => {
    const { db, seen } = fakeDb([row(5), row(4), row(3)]);
    const page = await getActivityLog(ENV, db, 105, { limit: 2, offset: 40 });
    expect(seen.limit).toBe(3);
    expect(seen.offset).toBe(40);
    expect(page.events.map((e) => e.id)).toEqual([5, 4]);
    expect(page.nextCursor).toBe(4);
  });

  it('clamps the page to the largest contract any feed served (500) and defaults junk to 50', async () => {
    const big = fakeDb([]);
    await getActivityLog(ENV, big.db, 106, { limit: 10_000 });
    expect(big.seen.limit).toBe(501);
    const junk = fakeDb([]);
    await getActivityLog(ENV, junk.db, 107, { limit: Number.NaN });
    expect(junk.seen.limit).toBe(51);
  });
});
