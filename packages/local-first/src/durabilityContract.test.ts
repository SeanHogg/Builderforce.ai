import { describe, expect, it } from 'vitest';
import {
  VSIX_LOCK_STEAL_MS,
  lockStolen,
  recoverSnapshot,
  requiresRecoveryCopy,
} from './durabilityContract.js';

describe('durability contract', () => {
  it('does not steal a VSIX lock held for 29_999 ms', () => {
    const heldSince = 1_700_000_000_000;
    expect(VSIX_LOCK_STEAL_MS).toBe(30_000);
    expect(lockStolen(heldSince, heldSince + 29_999, VSIX_LOCK_STEAL_MS)).toBe(false);
  });

  it('steals a VSIX lock at 30_000 ms and after', () => {
    const heldSince = 1_700_000_000_000;
    expect(lockStolen(heldSince, heldSince + 30_000, VSIX_LOCK_STEAL_MS)).toBe(true);
    expect(lockStolen(heldSince, heldSince + 30_001, VSIX_LOCK_STEAL_MS)).toBe(true);
  });

  it('uses the caller window: stolen at the boundary, not before', () => {
    expect(lockStolen(100, 109, 10)).toBe(false);
    expect(lockStolen(100, 110, 10)).toBe(true);
  });

  it('recovers valid JSON', () => {
    expect(recoverSnapshot('{"records":[1]}')).toEqual({ ok: true, value: { records: [1] } });
    expect(recoverSnapshot('[]')).toEqual({ ok: true, value: [] });
    expect(recoverSnapshot('null')).toEqual({ ok: true, value: null });
    expect(recoverSnapshot('"snapshot"')).toEqual({ ok: true, value: 'snapshot' });
  });

  it('refuses invalid JSON as corrupt_snapshot and never throws', () => {
    expect(recoverSnapshot('{')).toEqual({ ok: false, reason: 'corrupt_snapshot' });
    expect(recoverSnapshot('')).toEqual({ ok: false, reason: 'corrupt_snapshot' });
    expect(recoverSnapshot('not-json')).toEqual({ ok: false, reason: 'corrupt_snapshot' });
    expect(recoverSnapshot('{"a":1,}')).toEqual({ ok: false, reason: 'corrupt_snapshot' });

    expect(() => recoverSnapshot(undefined)).not.toThrow();
    expect(recoverSnapshot(undefined)).toEqual({ ok: false, reason: 'corrupt_snapshot' });
    expect(() => recoverSnapshot({ broken: true })).not.toThrow();
    expect(recoverSnapshot({ broken: true })).toEqual({ ok: false, reason: 'corrupt_snapshot' });
  });

  it('requires a recovery copy only for the VSIX file snapshot', () => {
    expect(requiresRecoveryCopy('vsix-file')).toBe(true);
    expect(requiresRecoveryCopy('indexeddb')).toBe(false);
  });
});
