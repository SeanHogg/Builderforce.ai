import { describe, expect, it } from 'vitest';
import {
  BUSY_TIMEOUT,
  decideRecoveryCopy,
  isSecretShapedKey,
  leaseBusy,
  leaseReclaimable,
  lockStolen,
  recoverSnapshot,
  redactForUploadOrLog,
  requiresRecoveryCopy,
  SECRET_SHAPED_KEYS,
} from './durabilityContract.js';

describe('durability contract', () => {
  it('keeps a held lease busy until release, including at 30s and later', () => {
    const holder = 'window-a';
    const heldSince = 1_700_000_000_000;
    expect(BUSY_TIMEOUT).toBe('until_release');
    for (const age of [0, 29_999, 30_000, 30_001, 60_000, 3_600_000]) {
      const now = heldSince + age;
      expect(leaseBusy(holder, now, heldSince)).toBe(true);
      expect(lockStolen(holder, now, heldSince, 30_000)).toBe(false);
      expect(lockStolen(holder, now, heldSince, age)).toBe(false);
    }
  });

  it('does not treat a missing holder as busy and does not grant a steal', () => {
    expect(leaseBusy(undefined)).toBe(false);
    expect(leaseBusy(null)).toBe(false);
    expect(leaseBusy('')).toBe(false);
    expect(leaseBusy(undefined, 1_700_000_030_000, 1_700_000_000_000)).toBe(false);
    expect(lockStolen(undefined, 1_700_000_030_000, 1_700_000_000_000, 30_000)).toBe(false);
    expect(lockStolen(null)).toBe(false);
    expect(lockStolen('')).toBe(false);
  });

  it('reclaims only a provably dead holder or a holder-less lease, never on age', () => {
    // A crashed create left a lease that names nobody.
    expect(leaseReclaimable(null, 'unknown')).toBe(true);
    expect(leaseReclaimable('', 'alive')).toBe(true);
    // A named holder needs proof of death.
    expect(leaseReclaimable('window-a', 'dead')).toBe(true);
    expect(leaseReclaimable('window-a', 'alive')).toBe(false);
    expect(leaseReclaimable('window-a', 'unknown')).toBe(false);
    // Reclaiming a dead holder is not a steal from a live one.
    expect(lockStolen('window-a', Date.now(), 0, 1)).toBe(false);
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

  it('keeps the previous good VSIX copy when the parse failed', () => {
    const previous = { records: [1], note: 'good' };
    const decision = decideRecoveryCopy('vsix-file', previous, '{');
    expect(decision).toEqual({
      adapter: 'vsix-file',
      replace: false,
      keepPrevious: true,
      previous,
      reason: 'corrupt_snapshot',
    });
    if (decision.replace) throw new Error('corrupt parse must not replace');
    expect(decision.previous).toBe(previous);
  });

  it('may replace a VSIX copy only with a parse that succeeded', () => {
    const previous = { records: [1] };
    expect(decideRecoveryCopy('vsix-file', previous, '{"records":[2]}')).toEqual({
      adapter: 'vsix-file',
      replace: true,
      value: { records: [2] },
    });
  });

  it('does not ask IndexedDB for a second file', () => {
    const previous = { records: [1] };
    expect(decideRecoveryCopy('indexeddb', previous, '{')).toEqual({
      secondFile: false,
      replace: false,
    });
    expect(decideRecoveryCopy('indexeddb', previous, '{"records":[2]}')).toEqual({
      secondFile: false,
      replace: false,
    });
  });

  it('strips secret-shaped keys before a snapshot is eligible to upload or log', () => {
    expect(SECRET_SHAPED_KEYS).toEqual([
      'token',
      'password',
      'authorization',
      'cookie',
      'apiKey',
      'clientSecret',
    ]);
    for (const key of SECRET_SHAPED_KEYS) {
      expect(isSecretShapedKey(key)).toBe(true);
      expect(isSecretShapedKey(key.toUpperCase())).toBe(true);
    }
    expect(isSecretShapedKey('note')).toBe(false);
    expect(isSecretShapedKey('records')).toBe(false);

    const snapshot = {
      records: [1],
      token: 'secret-token',
      Password: 'secret-password',
      nested: {
        authorization: 'Bearer x',
        cookie: 'sid=1',
        apiKey: 'key',
        clientSecret: 'secret',
        name: 'kept',
      },
      items: [{ token: 'drop', id: 2 }],
    };
    const redacted = redactForUploadOrLog(snapshot);
    expect(redacted).toEqual({
      records: [1],
      nested: { name: 'kept' },
      items: [{ id: 2 }],
    });
    expect(redacted).not.toBe(snapshot);
    expect(snapshot.token).toBe('secret-token');
    expect(snapshot.nested.authorization).toBe('Bearer x');
  });
});
