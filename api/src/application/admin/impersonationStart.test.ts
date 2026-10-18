/**
 * THE impersonation start use case — both admin doors (`/impersonation/start` and the
 * deprecated `/impersonate`) run this, so the governance pinned here is the
 * governance neither door can skip: a reason, no superadmin target, one active
 * session, a capped role, a revocable token and an audit row.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const signEmulationJwt = vi.fn(async (..._args: unknown[]) => 'emu-token');
vi.mock('../../infrastructure/auth/JwtService', () => ({
  signEmulationJwt: (...args: unknown[]) => signEmulationJwt(...args),
  decodeJwtPayload: () => ({ jti: 'jti-1' }),
}));

const { startImpersonation } = await import('./impersonationStart');

const env = { JWT_SECRET: 'test-secret' };
const target = { id: 'u-1', email: 'u@example.com', displayName: 'U', avatarUrl: null, isSuperadmin: false };
const tenant = { id: 7, name: 'Acme', slug: 'acme' };
const input = { adminId: 'admin-1', userId: 'u-1', tenantId: 7, reason: 'Bug #12' };

describe('startImpersonation', () => {
  it('refuses a blank reason before touching the database', async () => {
    const db = fakeDb();
    const res = await startImpersonation(env, db as unknown as Db, { ...input, reason: '   ' });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(db.calls).toHaveLength(0);
  });

  it('refuses to impersonate a Super Admin', async () => {
    const db = fakeDb([[{ ...target, isSuperadmin: true }]]);
    const res = await startImpersonation(env, db as unknown as Db, input);
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('refuses a second active session and names the open one', async () => {
    const db = fakeDb([[target], [{ id: 'sess-open' }]]);
    const res = await startImpersonation(env, db as unknown as Db, input);
    expect(res).toMatchObject({ ok: false, status: 409, sessionId: 'sess-open' });
  });

  it('refuses a role above the target\'s own', async () => {
    const db = fakeDb([[target], [], [tenant], [{ role: 'viewer' }]]);
    const res = await startImpersonation(env, db as unknown as Db, { ...input, role: 'owner' });
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it('records the session, stores the JTI for revocation, and audits the start', async () => {
    const startedAt = new Date('2026-10-17T10:00:00Z');
    const db = fakeDb([
      [target], [], [tenant], [{ role: 'developer' }],
      [{ id: 'sess-1', startedAt }], // insert session
      [],                            // update jti
      [],                            // audit insert
    ]);
    const res = await startImpersonation(env, db as unknown as Db, { ...input, enableDebugger: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.started).toMatchObject({
      sessionId: 'sess-1', token: 'emu-token', role: 'developer', debugger: true,
      user: { id: 'u-1', email: 'u@example.com' }, tenant,
      startedAt: startedAt.toISOString(),
    });
    expect(signEmulationJwt).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u-1', tid: 7, emuBy: 'admin-1', emuSid: 'sess-1' }), 'test-secret',
    );
    const [sessionInsert, jtiUpdate, auditInsert] = db.calls.slice(4);
    expect(sessionInsert?.payload).toMatchObject({ reason: 'Bug #12', roleOverride: 'developer', debuggerEnabled: true });
    expect(jtiUpdate?.payload).toEqual({ tokenJti: 'jti-1' });
    expect(auditInsert?.payload).toMatchObject({ event: 'IMPERSONATION_STARTED' });
  });
});
