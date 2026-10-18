import { beforeEach, describe, expect, it, vi } from 'vitest';

const mfa = vi.hoisted(() => ({
  verifyTotpCode: vi.fn(),
  decryptSecretFromStorage: vi.fn(async () => 'SECRET'),
  encryptSecretForStorage: vi.fn(async () => 'sealed'),
  generateRecoveryCodes: vi.fn(() => ['r1', 'r2']),
  generateTotpSecret: vi.fn(() => 'NEWSECRET'),
  buildOtpAuthUrl: vi.fn(({ issuer }: { issuer: string }) => `otpauth://${issuer}`),
  hashRecoveryCode: vi.fn(async (c: string) => `h:${c}`),
  normalizeRecoveryCode: vi.fn((c: string) => c.toLowerCase()),
}));
vi.mock('../../infrastructure/auth/MfaService', () => mfa);
vi.mock('../integrations/credentialCrypto', () => ({ credentialSecret: () => 'cred' }));

import { beginMfaSetup, confirmMfaEnable, disableMfa, regenerateRecoveryCodes, verifyMfaChallenge } from './mfaChallenge';

/** Select queue: each `select()` chain resolves to the next queued rows. */
function fakeDb(selects: unknown[][]) {
  const queue = [...selects];
  const writes: { op: string; set?: Record<string, unknown> }[] = [];
  const chain = () => {
    const rows = queue.shift() ?? [];
    const c: Record<string, unknown> = {};
    c.from = () => c; c.where = () => c; c.limit = async () => rows;
    return c;
  };
  const db = {
    select: chain,
    update: () => ({ set: (set: Record<string, unknown>) => { writes.push({ op: 'update', set }); return { where: async () => undefined }; } }),
    delete: () => ({ where: async () => { writes.push({ op: 'delete' }); } }),
    insert: () => ({ values: async () => { writes.push({ op: 'insert' }); } }),
  };
  return { db: db as never, writes };
}
const env = { JWT_SECRET: 'j' } as never;

describe('mfaChallenge', () => {
  beforeEach(() => { mfa.verifyTotpCode.mockReset(); });

  it('verifyMfaChallenge rejects a user without MFA', async () => {
    const { db } = fakeDb([]);
    expect(await verifyMfaChallenge(db, env, { id: 'u', mfaEnabled: false, mfaSecretEnc: null }, '123456')).toBe(false);
  });

  it('verifyMfaChallenge accepts a valid TOTP, and a recovery code only once found unused', async () => {
    mfa.verifyTotpCode.mockResolvedValueOnce(true);
    const u = { id: 'u', mfaEnabled: true, mfaSecretEnc: 'enc' };
    expect(await verifyMfaChallenge(fakeDb([]).db, env, u, '123456')).toBe(true);
    const hit = fakeDb([[{ id: 'rc1' }]]);
    expect(await verifyMfaChallenge(hit.db, env, u, undefined, 'ABC')).toBe(true);
    expect(hit.writes.map((w) => w.op)).toEqual(['update']);
    expect(await verifyMfaChallenge(fakeDb([[]]).db, env, u, undefined, 'ABC')).toBe(false);
  });

  it('beginMfaSetup uses the caller-supplied issuer and refuses an enrolled user', async () => {
    const ok = await beginMfaSetup(fakeDb([[{ id: 'u', email: 'a@b.c', mfaEnabled: false }]]).db, env, 'u', 'Builderforce');
    expect(ok).toMatchObject({ ok: true, otpauthUrl: 'otpauth://Builderforce', manualEntryKey: 'NEWSECRET', expiresIn: 600 });
    expect(await beginMfaSetup(fakeDb([[{ id: 'u', email: 'a', mfaEnabled: true }]]).db, env, 'u', 'x')).toMatchObject({ ok: false, status: 409 });
    expect(await beginMfaSetup(fakeDb([[]]).db, env, 'u', 'x')).toMatchObject({ ok: false, status: 404 });
  });

  it('confirmMfaEnable enforces expiry and the code, then returns recovery codes', async () => {
    const future = new Date(Date.now() + 60_000);
    const row = { id: 'u', mfaEnabled: false, mfaTempSecretEnc: 'tmp', mfaTempExpiresAt: future };
    expect(await confirmMfaEnable(fakeDb([[{ ...row, mfaTempExpiresAt: new Date(0) }]]).db, env, 'u', '1')).toMatchObject({ ok: false, status: 400 });
    mfa.verifyTotpCode.mockResolvedValueOnce(false);
    expect(await confirmMfaEnable(fakeDb([[row]]).db, env, 'u', '1')).toMatchObject({ ok: false, status: 401 });
    mfa.verifyTotpCode.mockResolvedValueOnce(true);
    const good = fakeDb([[row]]);
    expect(await confirmMfaEnable(good.db, env, 'u', '1')).toEqual({ ok: true, recoveryCodes: ['r1', 'r2'] });
    expect(good.writes.some((w) => w.set?.mfaEnabled === true)).toBe(true);
  });

  it('disableMfa is a no-op when already off and 401s on a bad code', async () => {
    expect(await disableMfa(fakeDb([[{ id: 'u', mfaEnabled: false }]]).db, env, 'u', '1')).toEqual({ ok: true, value: { enabled: false } });
    mfa.verifyTotpCode.mockResolvedValueOnce(false);
    expect(await disableMfa(fakeDb([[{ id: 'u', mfaEnabled: true, mfaSecretEnc: 'e' }]]).db, env, 'u', '1')).toMatchObject({ ok: false, status: 401 });
    mfa.verifyTotpCode.mockResolvedValueOnce(true);
    const good = fakeDb([[{ id: 'u', mfaEnabled: true, mfaSecretEnc: 'e' }]]);
    expect(await disableMfa(good.db, env, 'u', '1')).toEqual({ ok: true, value: { enabled: false } });
    expect(good.writes.some((w) => w.set?.mfaEnabled === false)).toBe(true);
  });

  it('regenerateRecoveryCodes requires MFA on and a valid challenge', async () => {
    expect(await regenerateRecoveryCodes(fakeDb([[{ id: 'u', mfaEnabled: false }]]).db, env, 'u', '1')).toMatchObject({ ok: false, status: 400 });
    mfa.verifyTotpCode.mockResolvedValueOnce(true);
    const good = fakeDb([[{ id: 'u', mfaEnabled: true, mfaSecretEnc: 'e' }]]);
    expect(await regenerateRecoveryCodes(good.db, env, 'u', '1')).toEqual({ ok: true, value: { recoveryCodes: ['r1', 'r2'] } });
  });
});
