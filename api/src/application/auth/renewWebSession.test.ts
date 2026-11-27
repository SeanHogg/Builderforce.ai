import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findTokenForRenewal: vi.fn(),
  supersedeToken: vi.fn(async () => true),
  revokeSessionTokens: vi.fn(async () => ({ revokedJtis: [] as string[] })),
  recordAuthToken: vi.fn(async () => undefined),
  user: null as null | Record<string, unknown>,
}));

vi.mock('./tokenRotation', () => ({
  findTokenForRenewal: mocks.findTokenForRenewal,
  supersedeToken: mocks.supersedeToken,
}));
vi.mock('./sessionRevocation', () => ({ revokeSessionTokens: mocks.revokeSessionTokens }));
vi.mock('./webSessionStore', () => ({ recordAuthToken: mocks.recordAuthToken }));

import { decodeJwtPayload, signOpaqueJwt, WEB_ACCESS_TOKEN_TTL_SECONDS } from '../../infrastructure/auth/JwtService';
import { renewWebSession, RENEW_REPLAY_WINDOW_SECONDS } from './renewWebSession';
import type { RenewalTokenRow } from './tokenRotation';
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

function row(overrides: Partial<RenewalTokenRow> = {}): RenewalTokenRow {
  return {
    jti: 'old-jti', sessionId: 'sid-1', tokenType: 'web', sessionLive: true,
    issuedAt: new Date((nowSec() - 60) * 1000), revokedAt: null, supersededBy: null,
    ...overrides,
  };
}

/** The ledger as a map, so a test can describe several rows of one session. */
function ledger(rows: RenewalTokenRow[]): void {
  mocks.findTokenForRenewal.mockImplementation(async (_db: Db, _user: string, jti: string) =>
    rows.find((r) => r.jti === jti) ?? null);
}

beforeEach(() => {
  vi.clearAllMocks();
  ledger([row()]);
  mocks.supersedeToken.mockResolvedValue(true);
  mocks.user = { id: 'u1', email: 'a@b.c', username: 'a', accountType: 'standard', isSuperadmin: false, isSuspended: false };
});

describe('renewWebSession — rotation', () => {
  it('issues a short token with a new jti, the same session and sat, and supersedes the presented jti', async () => {
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
    expect(mocks.recordAuthToken).toHaveBeenCalledWith(db, result.token, expect.objectContaining({ userId: 'u1', sessionId: 'sid-1' }));
    expect(mocks.supersedeToken).toHaveBeenCalledWith(db, env, { userId: 'u1', jti: 'old-jti', successorJti: claims.jti });
    expect(mocks.revokeSessionTokens).not.toHaveBeenCalled();
  });

  it('renews a token that lapsed hours ago (device asleep 3 h)', async () => {
    const now = nowSec();
    const asleep = now - 3 * 3600;
    const result = await renewWebSession(db, env, await webToken({
      iat: asleep - WEB_ACCESS_TOKEN_TTL_SECONDS, exp: asleep, sat: now - 86_400 * 3, sma: 30 * 86_400,
    }), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeJwtPayload<Claims>(result.token).exp).toBe(now + WEB_ACCESS_TOKEN_TTL_SECONDS);
  });

  it('treats a token with no sat as having started at iat, with its own lifetime as max age', async () => {
    const now = nowSec();
    const result = await renewWebSession(db, env, await webToken({ iat: now - 3600, exp: now - 3600 + 86_400 }), ctx);
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
    expect(result.expiresIn).toBe(120);
  });

  it('refuses past the session max age with session_expired, writing nothing', async () => {
    const now = nowSec();
    const result = await renewWebSession(db, env, await webToken({ sat: now - 90_000, sma: 86_400, iat: now - 86_500, exp: now - 86_500 + 900 }), ctx);
    expect(result).toMatchObject({ ok: false, code: 'session_expired' });
    expect(mocks.recordAuthToken).not.toHaveBeenCalled();
    expect(mocks.supersedeToken).not.toHaveBeenCalled();
    expect(mocks.revokeSessionTokens).not.toHaveBeenCalled();
  });
});

describe('renewWebSession — a token that is no longer current', () => {
  it('ends the WHOLE session when a rotated jti is presented outside the replay window', async () => {
    const now = nowSec();
    ledger([
      row({ revokedAt: new Date((now - RENEW_REPLAY_WINDOW_SECONDS - 600) * 1000), supersededBy: 'next-jti' }),
      row({ jti: 'next-jti' }),
    ]);
    const result = await renewWebSession(db, env, await webToken(), ctx);
    expect(result).toMatchObject({ ok: false, code: 'session_revoked' });
    expect(mocks.revokeSessionTokens).toHaveBeenCalledWith(db, env, { userId: 'u1', sessionId: 'sid-1' });
    expect(mocks.recordAuthToken).not.toHaveBeenCalled();
  });

  it('answers a repeat inside the replay window with the SAME successor', async () => {
    const now = nowSec();
    const successorIat = now - 5;
    ledger([
      row({ revokedAt: new Date((now - 5) * 1000), supersededBy: 'next-jti' }),
      row({ jti: 'next-jti', issuedAt: new Date(successorIat * 1000) }),
    ]);
    const presented = await webToken({ sat: now - 3600, sma: 86_400 });
    const first = await renewWebSession(db, env, presented, ctx);
    const second = await renewWebSession(db, env, presented, ctx);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.token).toBe(first.token);
    const claims = decodeJwtPayload<Claims>(first.token);
    expect(claims.jti).toBe('next-jti');
    expect(claims.iat).toBe(successorIat);
    expect(claims.exp).toBe(successorIat + WEB_ACCESS_TOKEN_TTL_SECONDS);
    expect(mocks.recordAuthToken).not.toHaveBeenCalled();
    expect(mocks.supersedeToken).not.toHaveBeenCalled();
    expect(mocks.revokeSessionTokens).not.toHaveBeenCalled();
  });

  it('ends the session inside the window too when the successor has itself moved on', async () => {
    const now = nowSec();
    ledger([
      row({ revokedAt: new Date((now - 5) * 1000), supersededBy: 'next-jti' }),
      row({ jti: 'next-jti', revokedAt: new Date((now - 2) * 1000), supersededBy: 'third-jti' }),
    ]);
    const result = await renewWebSession(db, env, await webToken(), ctx);
    expect(result).toMatchObject({ ok: false, code: 'session_revoked' });
    expect(mocks.revokeSessionTokens).toHaveBeenCalledWith(db, env, { userId: 'u1', sessionId: 'sid-1' });
  });

  it('settles a lost race on the same token by withdrawing its own successor and returning the winner', async () => {
    const now = nowSec();
    const rows = [row(), row({ jti: 'winner-jti', issuedAt: new Date(now * 1000) })];
    ledger(rows);
    mocks.supersedeToken.mockImplementation(async () => {
      rows[0] = row({ revokedAt: new Date(now * 1000), supersededBy: 'winner-jti' });
      return false;
    });
    const result = await renewWebSession(db, env, await webToken(), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeJwtPayload<Claims>(result.token).jti).toBe('winner-jti');
    const ours = (mocks.recordAuthToken.mock.calls[0] as unknown[])[1] as string;
    expect(mocks.revokeSessionTokens).toHaveBeenCalledWith(db, env, { userId: 'u1', jti: decodeJwtPayload<Claims>(ours).jti });
  });

  it('refuses a token revoked any other way, without ending the session', async () => {
    ledger([row({ revokedAt: new Date(), supersededBy: null })]);
    expect(await renewWebSession(db, env, await webToken(), ctx)).toMatchObject({ ok: false, code: 'token_revoked' });
    expect(mocks.revokeSessionTokens).not.toHaveBeenCalled();
  });

  it('refuses a token whose session was signed out, and an unknown jti', async () => {
    ledger([row({ sessionLive: false })]);
    expect(await renewWebSession(db, env, await webToken(), ctx)).toMatchObject({ ok: false, code: 'token_revoked' });
    ledger([]);
    expect(await renewWebSession(db, env, await webToken(), ctx)).toMatchObject({ ok: false, code: 'token_revoked' });
    expect(mocks.recordAuthToken).not.toHaveBeenCalled();
  });
});

describe('renewWebSession — what is never renewed', () => {
  it('refuses a forged token and a pending-MFA token', async () => {
    // Tamper the FIRST signature character: all six of its bits are signature bytes (the last
    // character also carries padding bits a decoder may drop, so flipping it is not always a forgery).
    const [header, body, sig] = (await webToken()).split('.') as [string, string, string];
    const forged = `${header}.${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    expect(await renewWebSession(db, env, forged, ctx)).toMatchObject({ ok: false, code: 'invalid_token' });
    expect(await renewWebSession(db, env, await webToken({ mfaPending: true }), ctx)).toMatchObject({ ok: false, code: 'invalid_token' });
  });

  it('refuses a workspace token: only a web session row renews', async () => {
    ledger([row({ tokenType: 'tenant' })]);
    expect(await renewWebSession(db, env, await webToken(), ctx)).toMatchObject({ ok: false, code: 'invalid_token' });
    expect(mocks.recordAuthToken).not.toHaveBeenCalled();
    expect(mocks.supersedeToken).not.toHaveBeenCalled();
  });

  it('refuses a suspended account', async () => {
    mocks.user = { ...mocks.user, isSuspended: true };
    expect(await renewWebSession(db, env, await webToken(), ctx)).toMatchObject({ ok: false, code: 'account_unavailable' });
  });

  it('treats a missing signing secret as a server fault, not a sign-out', async () => {
    const token = await webToken();
    await expect(renewWebSession(db, { JWT_SECRET: '' } as unknown as Env, token, ctx)).rejects.toThrow(/JWT_SECRET/);
  });
});
