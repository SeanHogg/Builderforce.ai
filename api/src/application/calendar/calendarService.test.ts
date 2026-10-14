/**
 * Calendar grant storage is sealed-only. The plaintext fallback (pre-1107
 * `access_token` / `refresh_token`) is gone; a row without a blob cannot be read.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { calendarConnections } from '../../infrastructure/database/schema';
import { sealOAuthTokens } from '../integrations/oauthTokenVault';
import { freshAccessToken, persistGrant, upsertCalendarGrant } from './calendarService';

const SECRET = 'test-base-secret-do-not-use-in-prod';
const TENANT = 42;
const env = { JWT_SECRET: SECRET } as unknown as Env;

type Connection = typeof calendarConnections.$inferSelect;

function conn(over: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    tenantId: TENANT,
    userId: 'user-1',
    provider: 'google',
    accountEmail: 'a@example.com',
    tokenEnc: null,
    tokenIv: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    scope: 'calendar',
    calendarId: 'primary',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

type Captured = {
  set?: Record<string, unknown>;
  values?: Record<string, unknown>;
  conflictSet?: Record<string, unknown>;
};

function capturingDb(existing: unknown[] = []): { db: Db; captured: Captured } {
  const captured: Captured = {};
  const db = {
    select: () => ({
      from: () => ({
        where: async () => existing,
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        captured.set = payload;
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: (payload: Record<string, unknown>) => {
        captured.values = payload;
        return {
          onConflictDoUpdate: async (opts: { set: Record<string, unknown> }) => {
            captured.conflictSet = opts.set;
          },
        };
      },
    }),
  };
  return { db: db as unknown as Db, captured };
}

function throwsOnWriteDb(): Db {
  return {
    update: () => {
      throw new Error('must not write a still-valid sealed grant');
    },
    insert: () => {
      throw new Error('must not write a still-valid sealed grant');
    },
  } as unknown as Db;
}

describe('calendarService sealed-only grants', () => {
  it('reads a sealed grant (encrypted path still works)', async () => {
    const sealed = await sealOAuthTokens(env, TENANT, {
      accessToken: 'access-sealed',
      refreshToken: 'refresh-sealed',
      expiresAtMs: Date.now() + 3_600_000,
      scope: 'calendar',
    });
    const token = await freshAccessToken(
      throwsOnWriteDb(),
      env,
      conn({ tokenEnc: sealed.enc, tokenIv: sealed.iv }),
    );
    expect(token).toBe('access-sealed');
  });

  it('does not fall back to plaintext — a row with no blob cannot be read', async () => {
    const token = await freshAccessToken(throwsOnWriteDb(), env, conn());
    expect(token).toBeNull();
  });

  it('persistGrant writes only sealed columns (no plaintext token fields)', async () => {
    const { db, captured } = capturingDb();
    await persistGrant(db, env, { id: 'conn-1', tenantId: TENANT }, {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAtMs: Date.now() + 60_000,
      scope: 'calendar',
    });
    expect(captured.set).toBeDefined();
    expect(captured.set).not.toHaveProperty('accessToken');
    expect(captured.set).not.toHaveProperty('refreshToken');
    expect(typeof captured.set?.tokenEnc).toBe('string');
    expect(typeof captured.set?.tokenIv).toBe('string');
    expect((captured.set?.tokenEnc as string).length).toBeGreaterThan(0);
  });

  it('upsertCalendarGrant writes only sealed columns on insert and conflict', async () => {
    const { db, captured } = capturingDb();
    await upsertCalendarGrant(db, env, {
      tenantId: TENANT,
      userId: 'user-1',
      provider: 'google',
      accountEmail: 'a@example.com',
      tokens: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'calendar' },
      defaultScope: 'calendar',
    });
    expect(captured.values).toBeDefined();
    expect(captured.values).not.toHaveProperty('accessToken');
    expect(captured.values).not.toHaveProperty('refreshToken');
    expect(typeof captured.values?.tokenEnc).toBe('string');
    expect(typeof captured.values?.tokenIv).toBe('string');
    expect(captured.conflictSet).toBeDefined();
    expect(captured.conflictSet).not.toHaveProperty('accessToken');
    expect(captured.conflictSet).not.toHaveProperty('refreshToken');
    expect(typeof captured.conflictSet?.tokenEnc).toBe('string');
  });
});
