import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { listUserSessions, loadMemberSecurityDetail } from './sessionDirectory';
import type { Db } from '../../infrastructure/database/connection';

/** Two-select fake: sessions first, then the grouped token counts. */
function fakeDb(sessions: Record<string, unknown>[], counts: { sessionId: string | null; activeCount: number }[]) {
  const wheres: string[] = [];
  const dialect = new PgDialect();
  let call = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: (p: SQL) => {
          wheres.push(dialect.sqlToQuery(p).sql);
          const n = call++;
          return n === 0
            ? { orderBy: async () => sessions }
            : { groupBy: async () => counts };
        },
      }),
    }),
  };
  return { db: db as unknown as Db, wheres };
}

const session = { id: 's1', sessionName: 'Laptop', userAgent: 'ua', ipAddress: '1.1.1.1', isActive: true, revokedAt: null, createdAt: new Date(0), lastSeenAt: new Date(0) };

describe('listUserSessions', () => {
  it('attaches each session its live-token count', async () => {
    const { db } = fakeDb([session, { ...session, id: 's2' }], [{ sessionId: 's1', activeCount: 3 }, { sessionId: null, activeCount: 9 }]);
    const out = await listUserSessions(db, 'u1');
    expect(out.map((s) => [s.id, s.activeTokens])).toEqual([['s1', 3], ['s2', 0]]);
  });

  it('narrows the token count to one workspace only when a tenant scope is given', async () => {
    const scoped = fakeDb([session], []);
    await listUserSessions(scoped.db, 'u1', { tenantId: 7 });
    const unscoped = fakeDb([session], []);
    await listUserSessions(unscoped.db, 'u1');
    expect(scoped.wheres[1]).toContain('"tenant_id"');
    expect(unscoped.wheres[1]).not.toContain('"tenant_id"');
  });

  it('skips the token query when there are no sessions', async () => {
    const { db, wheres } = fakeDb([], []);
    expect(await listUserSessions(db, 'u1')).toEqual([]);
    expect(wheres).toHaveLength(1);
  });
});

describe('loadMemberSecurityDetail', () => {
  /** user, sessions, (token counts), token details — records every where clause. */
  function detailDb() {
    const wheres: string[] = [];
    const dialect = new PgDialect();
    let call = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: (p: SQL) => {
            wheres.push(dialect.sqlToQuery(p).sql);
            const n = call++;
            if (n === 0) return { limit: async () => [{ id: 'u1', email: 'a@b.c', username: 'u', displayName: 'U', mfaEnabled: false, mfaTempExpiresAt: null, mfaEnabledAt: null, mfaRecoveryGeneratedAt: null }] };
            if (n === 1) return { orderBy: async () => [] };
            return { orderBy: () => ({ limit: async () => [] }) };
          },
        }),
      }),
    };
    return { db: db as unknown as Db, wheres };
  }

  it('confines the token list to the workspace of the manager when a tenant scope is given', async () => {
    const { db, wheres } = detailDb();
    await loadMemberSecurityDetail(db, 'u1', { tenantId: 7 });
    expect(wheres[2]).toContain('"tenant_id"');
  });

  it('lists the whole account when unscoped', async () => {
    const { db, wheres } = detailDb();
    await loadMemberSecurityDetail(db, 'u1');
    expect(wheres[2]).not.toContain('"tenant_id"');
  });
});
