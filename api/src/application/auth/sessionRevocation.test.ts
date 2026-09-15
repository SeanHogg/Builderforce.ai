import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  revokeSessionTokens, findActiveTokenCached, resolveActiveToken, sessionVersionOf, invalidateSessionVersion,
  type RevokeSelector, type ActiveTokenRow,
} from './sessionRevocation';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The ONE revoke use case: every route that signs a session out — the user's
 * own, an admin's force-logout, a tenant manager's member revoke, the end of an
 * impersonation — goes through here, so every one of them also drops the legacy
 * worker's cached introspection verdict for the jtis it revoked.
 */

type Captured = { table: unknown; set: Record<string, unknown>; where: string };

function fakeDb(returnedJtis: string[]) {
  const calls: Captured[] = [];
  const dialect = new PgDialect();
  const db = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: SQL) => {
          calls.push({ table, set: values, where: dialect.sqlToQuery(predicate).sql });
          const pending = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<{ jti: string }[]> };
          pending.returning = async () => returnedJtis.map((jti) => ({ jti }));
          return pending;
        },
      }),
    }),
  };
  return { db: db as unknown as Db, calls };
}

function fakeEnv() {
  const del = vi.fn(async (_key: string) => undefined);
  const env = { AUTH_CACHE_KV: { get: vi.fn(async () => null), put: vi.fn(), delete: del } } as unknown as Env;
  return { env, del };
}

const SESSIONS = 'sessions';
const TOKENS = 'tokens';
const tableName = (table: unknown) => (table === authUserSessions ? SESSIONS : table === authTokens ? TOKENS : 'other');

describe('revokeSessionTokens', () => {
  const cases: {
    name: string;
    selector: RevokeSelector;
    tables: string[];
    sessionWhere?: RegExp[];
    tokenWhere: RegExp[];
    tokenWhereNot?: RegExp[];
  }[] = [
    {
      name: 'one session and its tokens',
      selector: { userId: 'u1', sessionId: 's1' },
      tables: [SESSIONS, TOKENS],
      sessionWhere: [/"auth_user_sessions"\."id" = \$1/, /"auth_user_sessions"\."user_id" = \$2/],
      tokenWhere: [/"auth_tokens"\."revoked_at" is null/, /"auth_tokens"\."user_id" = \$1/, /"auth_tokens"\."session_id" = \$2/],
    },
    {
      name: 'every other session — sign out everywhere else',
      selector: { userId: 'u1', exceptSessionId: 'current' },
      tables: [SESSIONS, TOKENS],
      sessionWhere: [/"auth_user_sessions"\."id" <> \$2/, /"auth_user_sessions"\."is_active" = \$3/],
      tokenWhere: [/"auth_tokens"\."session_id" <> \$2/],
    },
    {
      name: 'one token; its session survives',
      selector: { userId: 'u1', jti: 'j1' },
      tables: [TOKENS],
      tokenWhere: [/"auth_tokens"\."user_id" = \$1/, /"auth_tokens"\."jti" = \$2/],
    },
    {
      name: 'everything the user holds — force-logout',
      selector: { userId: 'u1' },
      tables: [SESSIONS, TOKENS],
      sessionWhere: [/"auth_user_sessions"\."user_id" = \$1/, /"auth_user_sessions"\."is_active" = \$2/],
      tokenWhere: [/"auth_tokens"\."revoked_at" is null/, /"auth_tokens"\."user_id" = \$1/],
      tokenWhereNot: [/session_id/, /jti/, /tenant_id/],
    },
    {
      name: 'a token by id regardless of holder — ending an impersonation',
      selector: { jti: 'emul-1' },
      tables: [TOKENS],
      tokenWhere: [/"auth_tokens"\."jti" = \$1/],
      tokenWhereNot: [/user_id/],
    },
    {
      name: 'tenant-scoped admin revoke narrows the token update to that workspace',
      selector: { userId: 'u1', sessionId: 's1', tenantId: 7 },
      tables: [SESSIONS, TOKENS],
      // Sessions are user-level: the tenant scope never narrows the session update.
      sessionWhere: [/"auth_user_sessions"\."id" = \$1/, /"auth_user_sessions"\."user_id" = \$2/],
      tokenWhere: [/"auth_tokens"\."tenant_id" = \$2/, /"auth_tokens"\."session_id" = \$3/],
    },
  ];

  it.each(cases)('$name', async ({ selector, tables, sessionWhere, tokenWhere, tokenWhereNot }) => {
    const { db, calls } = fakeDb(['j-a', 'j-b']);
    const { env, del } = fakeEnv();

    const result = await revokeSessionTokens(db, env, selector);

    expect(calls.map((c) => tableName(c.table))).toEqual(tables);
    const tokenCall = calls.find((c) => c.table === authTokens)!;
    for (const pattern of tokenWhere) expect(tokenCall.where).toMatch(pattern);
    for (const pattern of tokenWhereNot ?? []) expect(tokenCall.where).not.toMatch(pattern);
    expect(Object.keys(tokenCall.set).sort()).toEqual(['lastSeenAt', 'revokedAt']);

    const sessionCall = calls.find((c) => c.table === authUserSessions);
    if (sessionWhere) {
      for (const pattern of sessionWhere) expect(sessionCall!.where).toMatch(pattern);
      expect(sessionCall!.set.isActive).toBe(false);
    } else {
      expect(sessionCall).toBeUndefined();
    }

    // Both cached verdicts for EVERY revoked jti are dropped from the shared KV: the
    // worker's introspection answer and the API's own live-token row.
    expect(result).toEqual({ revokedJtis: ['j-a', 'j-b'] });
    expect(del.mock.calls.map((c) => c[0]).sort()).toEqual([
      'cache:auth:active:j-a', 'cache:auth:active:j-b',
      'cache:auth:introspect:j-a', 'cache:auth:introspect:j-b',
    ]);
  });

  it('invalidates nothing when no live token matched', async () => {
    const { db } = fakeDb([]);
    const { env, del } = fakeEnv();
    expect(await revokeSessionTokens(db, env, { userId: 'u1', jti: 'already-revoked' })).toEqual({ revokedJtis: [] });
    expect(del).not.toHaveBeenCalled();
  });

  it('still revokes with no env (no KV bound) — the database is the source of truth', async () => {
    const { db, calls } = fakeDb(['j-a']);
    expect(await revokeSessionTokens(db, undefined, { userId: 'u1' })).toEqual({ revokedJtis: ['j-a'] });
    expect(calls).toHaveLength(2);
  });
});

/**
 * A minimal `Db` double for the `SELECT ... LIMIT 1` shape {@link findActiveToken}
 * and {@link sessionVersionOf} both use, plus the fire-and-forget
 * `UPDATE ... SET ... WHERE` shape {@link lastSeenWrites} issues off the critical
 * path. `rowsPerCall` hands back one row-set per `select(...).limit(...)` — the
 * call count is how these tests prove a cache hit never reaches the db at all.
 */
interface FakeSelectChain {
  from(): FakeSelectChain;
  leftJoin(): FakeSelectChain;
  where(): FakeSelectChain;
  limit(): Promise<unknown[]>;
}

function fakeAuthDb(rowsPerCall: unknown[][]) {
  let call = 0;
  const selectChain: FakeSelectChain = {
    from: () => selectChain,
    leftJoin: () => selectChain,
    where: () => selectChain,
    limit: async () => {
      const rows = rowsPerCall[call] ?? [];
      call += 1;
      return rows;
    },
  };
  const updateChain = { set: () => ({ where: async () => undefined }) };
  const db = { select: () => selectChain, update: () => updateChain } as unknown as Db;
  return { db, callCount: () => call };
}

const LIVE_ROW: ActiveTokenRow = {
  jti: 'j1', sessionId: null, sessionRowId: null,
  tokenLastSeenAt: new Date('2026-01-01T00:00:00Z'), sessionLastSeenAt: null,
};

describe('findActiveTokenCached', () => {
  it('serves a second call from cache without hitting the db', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeAuthDb([[LIVE_ROW]]);
    expect(await findActiveTokenCached(env, db, 'u1', 'j1')).toEqual(LIVE_ROW);
    expect(callCount()).toBe(1);
    expect(await findActiveTokenCached(env, db, 'u1', 'j1')).toEqual(LIVE_ROW);
    expect(callCount()).toBe(1);
  });

  it('does not cache a null row (unknown/expired/revoked token)', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeAuthDb([[], []]);
    expect(await findActiveTokenCached(env, db, 'u1', 'missing')).toBeNull();
    expect(await findActiveTokenCached(env, db, 'u1', 'missing')).toBeNull();
    expect(callCount()).toBe(2);
  });

  it('does not cache a dead-session row (token names a session the LEFT JOIN missed)', async () => {
    const deadRow: ActiveTokenRow = { jti: 'j2', sessionId: 's1', sessionRowId: null, tokenLastSeenAt: null, sessionLastSeenAt: null };
    const { env } = fakeEnv();
    const { db, callCount } = fakeAuthDb([[deadRow], [deadRow]]);
    expect(await findActiveTokenCached(env, db, 'u1', 'j2')).toEqual(deadRow);
    expect(await findActiveTokenCached(env, db, 'u1', 'j2')).toEqual(deadRow);
    expect(callCount()).toBe(2);
  });

  it('falls through to the db on a holder mismatch — a jti is only honoured for the user it names', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeAuthDb([[LIVE_ROW], [LIVE_ROW]]);
    expect(await findActiveTokenCached(env, db, 'u1', 'j1')).toEqual(LIVE_ROW); // caches under u1
    expect(await findActiveTokenCached(env, db, 'u2', 'j1')).toEqual(LIVE_ROW); // different holder
    expect(callCount()).toBe(2);
  });
});

describe('resolveActiveToken', () => {
  it('refreshes the cached copy when last-seen writes are due', async () => {
    const staleRow: ActiveTokenRow = {
      jti: 'j3', sessionId: null, sessionRowId: null,
      tokenLastSeenAt: new Date(Date.now() - 20 * 60_000), sessionLastSeenAt: null,
    };
    const { env } = fakeEnv();
    const { db, callCount } = fakeAuthDb([[staleRow]]);

    const { active, writes } = await resolveActiveToken(env, db, 'u1', 'j3');
    expect(active.jti).toBe('j3');
    expect(writes.length).toBeGreaterThan(0);
    await Promise.all(writes);

    // A second, independent read is served from the REFRESHED cached copy — not
    // the stale row the db returned — and never re-queries the db.
    const cached = await findActiveTokenCached(env, db, 'u1', 'j3');
    expect(cached?.tokenLastSeenAt?.getTime()).toBeGreaterThan(staleRow.tokenLastSeenAt!.getTime());
    expect(callCount()).toBe(1);
  });
});

describe('sessionVersionOf / invalidateSessionVersion', () => {
  it('caches the session version', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeAuthDb([[{ sessionVersion: 3 }]]);
    expect(await sessionVersionOf(env, db, 'u1')).toBe(3);
    expect(await sessionVersionOf(env, db, 'u1')).toBe(3);
    expect(callCount()).toBe(1);
  });

  it('invalidateSessionVersion deletes the cache key so the next read re-queries the db', async () => {
    const { env, del } = fakeEnv();
    const { db, callCount } = fakeAuthDb([[{ sessionVersion: 1 }], [{ sessionVersion: 2 }]]);
    expect(await sessionVersionOf(env, db, 'u1')).toBe(1);
    await invalidateSessionVersion(env, 'u1');
    expect(del).toHaveBeenCalledWith('cache:auth:session-version:u1');
    expect(await sessionVersionOf(env, db, 'u1')).toBe(2);
    expect(callCount()).toBe(2);
  });
});
