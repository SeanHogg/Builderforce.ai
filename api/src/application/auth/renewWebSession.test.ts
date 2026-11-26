import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../../domain/shared/errors';

const mocks = vi.hoisted(() => ({
  findActiveToken: vi.fn(),
  revokeSessionTokens: vi.fn(async () => ({ revokedJtis: [] as string[] })),
  persistWebSessionToken: vi.fn(async () => undefined),
  user: null as null | Record<string, unknown>,
}));

vi.mock('./sessionRevocation', () => ({
  findActiveToken: mocks.findActiveToken,
  revokeSessionTokens: mocks.revokeSessionTokens,
  assertActiveToken: (row: unknown) => {
    if (!row) throw new UnauthorizedError('Token has been revoked or expired');
    return row;
  },
}));
vi.mock('./webSessionStore', () => ({ persistWebSessionToken: mocks.persistWebSessionToken }));

import { decodeJwtPayload, signOpaqueJwt, WEB_ACCESS_TOKEN_TTL_SECONDS, WEB_RENEW_GRACE_SECONDS } from '../../infrastructure/auth/JwtService';
import { renewWebSession } from './renewWebSession';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const SECRET = 'test-secret';
const env = { JWT_SECRET: SECRET } as unknown as Env;
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => (mocks.user ? [mocks.user] : []) }) }) }),
} as unknown as Db;
const ctx = { isSuperadmin: () => false };
const nowSec = () => Math.floor(Date.now() / 1000);

type Claims = { sat?: number; sma?: number; jti: string; sid: string; iat: number; exp: number; mfaPending?: boolean };

function webToken(overrides: Partial<Claims> = {}): Promise<string> {
  const now = nowSec();
  return signOpaqueJwt({
    sub: 'u1', email: 'a@b.c', username: 'a', mfa: false, amr: ['pwd'],
    jti: 'old-jti', sid: 'sid-1', iat: now - 60, exp: now + 600,
    ...overrides,
  }, SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActiveToken.mockResolvedValue({ jti: 'old-jti', sessionId: 'sid-1', sessionRowId: 'sid-1', tokenLastSeenAt: null, sessionLastSeenAt: null });
  mocks.user = { id: 'u1', email: 'a@b.c', username: 'a', accountType: 'standard', isSuperadmin: false, isSuspended: false };
});

describe('renewWebSession', () => {
  it('issues a short token with a new jti, the same session and sat, and revokes the old jti', async () => {
    const sat = nowSec() - 3600;
    const result = await renewWebSession(db, env, await webToken({ sat, sma: 86_400 }), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claims = decodeJwtPayload<Claims>(result.token);
    expect(claims.jti).not.toBe('old-jti');
    expect(claims.sid).toBe('sid-1');
    expect(claims.sat).toBe(sat);
    expect(claims.sma).toBe(86_400);
    expect(claims.exp - claims.iat).toBe(WEB_ACCESS_TOKEN_TTL_SECONDS);
    expect(result.sessionExpiresAt).toBe(sat + 86_400);
    expect(mocks.persistWebSessionToken).toHaveBeenCalledOnce();
    expect(mocks.revokeSessionTokens).toHaveBeenCalledWith(db, env, { userId: 'u1', jti: 'old-jti' });
  });

  it('treats a token with no sat as having started at iat, with its own lifetime as max age', async () => {
    const now = nowSec();
    const token = await webToken({ iat: now - 3600, exp: now - 3600 + 86_400 });
    const result = await renewWebSession(db, env, token, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claims = decodeJwtPayload<Claims>(result.token);
    expect(claims.sat).toBe(now - 3600);
    expect(claims.sma).toBe(86_400);
  });

  it('never issues a token that outlives the session', async () => {
    const now = nowSec();
    const result = await renewWebSession(db, env, await webToken({ sat: now - 86_400 + 120, sma: 86_400 }), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeJwtPayload<Claims>(result.token).exp).toBe(now + 120);
  });

  it('refuses past the session max age with session_expired', async () => {
    const now = nowSec();
    const result = await renewWebSession(db, env, await webToken({ sat: now - 90_000, sma: 86_400 }), ctx);
    expect(result).toMatchObject({ ok: false, code: 'session_expired' });
    expect(mocks.revokeSessionTokens).not.toHaveBeenCalled();
  });

  it('refuses a revoked token', async () => {
    mocks.findActiveToken.mockResolvedValue(null);
    const result = await renewWebSession(db, env, await webToken(), ctx);
    expect(result).toMatchObject({ ok: false, code: 'token_revoked' });
    expect(mocks.persistWebSessionToken).not.toHaveBeenCalled();
  });

  it('accepts a token that lapsed inside the grace window', async () => {
    const now = nowSec();
    const result = await renewWebSession(db, env, await webToken({ iat: now - 1500, exp: now - 600, sat: now - 1500, sma: 86_400 }), ctx);
    expect(result.ok).toBe(true);
  });

  it('refuses a token expired beyond the grace window', async () => {
    const now = nowSec();
    const result = await renewWebSession(db, env, await webToken({ exp: now - WEB_RENEW_GRACE_SECONDS - 60 }), ctx);
    expect(result).toMatchObject({ ok: false, code: 'invalid_token' });
  });

  it('refuses a forged token and a pending-MFA token', async () => {
    const forged = (await webToken()).replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
    expect(await renewWebSession(db, env, forged, ctx)).toMatchObject({ ok: false, code: 'invalid_token' });
    expect(await renewWebSession(db, env, await webToken({ mfaPending: true }), ctx)).toMatchObject({ ok: false, code: 'invalid_token' });
  });

  it('refuses a suspended account', async () => {
    mocks.user = { ...mocks.user, isSuspended: true };
    expect(await renewWebSession(db, env, await webToken(), ctx)).toMatchObject({ ok: false, code: 'account_unavailable' });
  });
});
