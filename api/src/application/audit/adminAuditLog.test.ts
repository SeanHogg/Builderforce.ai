import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { adminAuditFilterFrom, listAdminAuditLog } from './adminAuditLog';

const dialect = new PgDialect();

describe('adminAuditFilterFrom — ONE reading of the operator-audit filter', () => {
  const from = (q: Record<string, string>) => adminAuditFilterFrom((name) => q[name]);

  it('reads the names the admin client sends (actorId / targetUserId / tenantId)', () => {
    expect(from({ event: 'LOGIN', actorId: 'a1', targetUserId: 'u2', tenantId: '7' }))
      .toEqual({ event: 'LOGIN', actorId: 'a1', targetUserId: 'u2', tenantId: 7 });
  });

  it('still honours the short names the routes used to read', () => {
    expect(from({ actor: 'a1', target: 'u2' })).toMatchObject({ actorId: 'a1', targetUserId: 'u2' });
  });

  it('drops a junk tenant id rather than filtering on it', () => {
    expect(from({ tenantId: 'abc' }).tenantId).toBeUndefined();
  });
});

describe('listAdminAuditLog', () => {
  it('filters on every given field, newest first, and serialises createdAt', async () => {
    const seen: { where?: string; limit?: number; offset?: number } = {};
    const chain = {
      from: () => chain,
      where: (p: SQL | undefined) => { seen.where = p ? dialect.sqlToQuery(p).sql : ''; return chain; },
      orderBy: () => chain,
      limit: (n: number) => { seen.limit = n; return chain; },
      offset: (n: number) => {
        seen.offset = n;
        return Promise.resolve([{ id: 'x', event: 'E', actorId: null, targetUserId: null, tenantId: 3, ipAddress: null, metadata: {}, createdAt: new Date('2026-10-17T00:00:00.000Z') }]);
      },
    };
    const db = { select: () => chain } as never;
    const rows = await listAdminAuditLog(db, { event: 'E', actorId: 'a', tenantId: 3 }, { limit: 50, offset: 10 });
    expect(seen.where).toContain('"admin_audit_log"."event"');
    expect(seen.where).toContain('"admin_audit_log"."actor_id"');
    expect(seen.where).toContain('"admin_audit_log"."tenant_id"');
    expect(seen).toMatchObject({ limit: 50, offset: 10 });
    expect(rows[0]?.createdAt).toBe('2026-10-17T00:00:00.000Z');
  });
});
