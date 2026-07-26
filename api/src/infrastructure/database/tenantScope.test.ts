import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildDatabase } from './connection';
import { scopedToTenant, scopedToSegment } from './tenantScope';
import { timecards, freelancerInvoices, activityEvents } from './schema';

/**
 * `.toSQL()` renders a query without executing it, so no database is needed —
 * the connection string is never dialled. Built through `buildDatabase` (not a
 * raw `neon()` client) because `npm run check:db-access` bans the driver import
 * everywhere but `connection.ts` — tests included.
 */
const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);

const render = (where: ReturnType<typeof scopedToTenant>, table: Parameters<typeof db.select>[0] extends never ? never : typeof timecards) =>
  db.select().from(table).where(where).toSQL().sql;

/**
 * These assert the property that makes the primitive worth having: the tenant
 * predicate is ALWAYS in the emitted SQL, including when every optional condition
 * the caller passed dropped out. A bare `and(...)` returns `undefined` in that
 * case — which `.where()` accepts, silently producing an unfiltered query. That
 * is the exact shape of a cross-tenant read.
 */
describe('scopedToTenant', () => {
  it('emits the tenant predicate with no extra conditions', () => {
    const sql = render(scopedToTenant(timecards, 42), timecards);
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('where');
  });

  it('survives conditions that are all undefined', () => {
    // The failure mode this guards: `and(undefined, undefined)` is `undefined`,
    // and `.where(undefined)` returns every row in the table — for every tenant.
    const sql = db
      .select()
      .from(freelancerInvoices)
      .where(scopedToTenant(freelancerInvoices, 7, undefined, undefined))
      .toSQL().sql;
    expect(sql).toContain('"tenant_id"');
  });

  it('ANDs the extra conditions alongside the tenant predicate', () => {
    const sql = render(
      scopedToTenant(timecards, 1, eq(timecards.status, 'submitted')),
      timecards,
    );
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"status"');
    expect(sql).toContain('and');
  });

  it('binds the tenant id as a parameter, not inlined text', () => {
    const q = db.select().from(timecards).where(scopedToTenant(timecards, 99)).toSQL();
    expect(q.params).toContain(99);
  });
});

describe('scopedToSegment', () => {
  it('emits both the tenant and the segment predicate', () => {
    const q = db
      .select()
      .from(activityEvents)
      .where(scopedToSegment(activityEvents, 3, '00000000-0000-0000-0000-000000000000'))
      .toSQL();
    expect(q.sql).toContain('"tenant_id"');
    expect(q.sql).toContain('"segment_id"');
    expect(q.params).toContain(3);
  });
});
