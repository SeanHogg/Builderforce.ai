/** The one "editor key must still be live" gate: live, revoked, may-not-act-as-member and missing-key outcomes. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveKey: vi.fn(async (): Promise<{ valid: boolean; mayRescope: boolean }> => ({ valid: true, mayRescope: true })),
}));
vi.mock('./gatewayAccess', () => ({ resolveEditorKeySession: mocks.resolveKey }));

import { assertExchangeableKeyRow, assertLiveEditorKey } from './editorKeyGate';

const db = {} as never;

beforeEach(() => {
  mocks.resolveKey.mockReset();
  mocks.resolveKey.mockResolvedValue({ valid: true, mayRescope: true });
});

describe('assertLiveEditorKey', () => {
  it('passes a live key and reads it for the session user', async () => {
    const out = await assertLiveEditorKey(db, { keyId: 'key-1', userId: 'u1', missingKey: 'allow' });
    expect(out).toEqual({ ok: true, mayRescope: true });
    expect(mocks.resolveKey).toHaveBeenCalledWith(db, 'key-1', 'u1');
  });

  it('refuses a revoked / unknown / foreign key with 401 invalid_api_key', async () => {
    mocks.resolveKey.mockResolvedValue({ valid: false, mayRescope: false });
    expect(await assertLiveEditorKey(db, { keyId: 'key-1', userId: 'u1', missingKey: 'allow' })).toEqual({
      ok: false, status: 401, code: 'invalid_api_key', message: 'Invalid or revoked API key',
    });
  });

  it('refuses a key that may not act in another workspace with 403 editor_key_required, only when a rescope is asked', async () => {
    mocks.resolveKey.mockResolvedValue({ valid: true, mayRescope: false });
    expect(await assertLiveEditorKey(db, { keyId: 'key-1', userId: 'u1', missingKey: 'session_stale', requireRescope: true }))
      .toMatchObject({ ok: false, status: 403, code: 'editor_key_required' });
    expect(await assertLiveEditorKey(db, { keyId: 'key-1', userId: 'u1', missingKey: 'session_stale' }))
      .toEqual({ ok: true, mayRescope: false });
  });

  it('a missing key id is skipped under "allow" and session_stale under "session_stale", never looked up', async () => {
    expect(await assertLiveEditorKey(db, { keyId: undefined, userId: 'u1', missingKey: 'allow' })).toMatchObject({ ok: true });
    expect(await assertLiveEditorKey(db, { keyId: null, userId: 'u1', missingKey: 'session_stale' }))
      .toMatchObject({ ok: false, status: 403, code: 'session_stale' });
    expect(mocks.resolveKey).not.toHaveBeenCalled();
  });
});

describe('assertExchangeableKeyRow', () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: 'k1', revokedAt: null, scopes: null, ...over });

  it('passes a live, unrestricted key row through', () => {
    const r = row();
    expect(assertExchangeableKeyRow(r)).toEqual({ ok: true, row: r });
    expect(assertExchangeableKeyRow(row({ scopes: '[]' }))).toMatchObject({ ok: true });
  });

  it('refuses a missing row and a revoked row with the same 401', () => {
    const refusal = { ok: false, status: 401, code: 'invalid_api_key', message: 'Invalid or revoked API key' };
    expect(assertExchangeableKeyRow(undefined)).toEqual(refusal);
    expect(assertExchangeableKeyRow(row({ revokedAt: new Date('2026-01-01') }))).toEqual(refusal);
  });

  it('refuses a scoped key (it may not act as the member) with the same 401', () => {
    expect(assertExchangeableKeyRow(row({ scopes: JSON.stringify(['replay:ingest']) })))
      .toMatchObject({ ok: false, status: 401, code: 'invalid_api_key' });
  });
});
