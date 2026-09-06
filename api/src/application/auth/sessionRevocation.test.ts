import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { revokeSessionTokens, type RevokeSelector } from './sessionRevocation';
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

    // The worker's cached verdict for EVERY revoked jti is dropped from the shared KV.
    expect(result).toEqual({ revokedJtis: ['j-a', 'j-b'] });
    expect(del.mock.calls.map((c) => c[0]).sort()).toEqual(['cache:auth:introspect:j-a', 'cache:auth:introspect:j-b']);
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
