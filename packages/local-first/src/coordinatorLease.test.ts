import { describe, expect, it } from 'vitest';
import { acquire, release, renew, type CoordinatorLeases } from './coordinatorLease.js';

const TTL_MS = 1_000;

function leases(): CoordinatorLeases {
  return new Map();
}

function granted(result: ReturnType<typeof acquire>): string {
  expect(result).toEqual({ ok: true, token: expect.any(String) });
  if (!result.ok) throw new Error('expected grant');
  return result.token;
}

describe('coordinator lease', () => {
  it('grants the first coordinator and refuses a second while the lease is live', () => {
    const table = leases();
    const token = granted(acquire(table, 'device-a', 0, TTL_MS));

    expect(acquire(table, 'device-a', TTL_MS - 1, TTL_MS)).toEqual({ ok: false, reason: 'lease_held' });
    expect(table.get('device-a')).toEqual({ deviceId: 'device-a', token, expiresAt: TTL_MS });
  });

  it('does not treat a lease whose expiresAt is in the past as held', () => {
    const table = leases();
    table.set('device-a', { deviceId: 'device-a', token: 'old', expiresAt: 50 });

    const token = granted(acquire(table, 'device-a', 51, TTL_MS));
    expect(token).not.toBe('old');
    expect(table.get('device-a')?.expiresAt).toBe(51 + TTL_MS);
    expect(renew(table, 'old', 51, TTL_MS)).toBe(false);
  });

  it('does not treat a lease that expires at now as held', () => {
    const table = leases();
    const first = granted(acquire(table, 'device-a', 0, TTL_MS));

    const next = granted(acquire(table, 'device-a', TTL_MS, TTL_MS));
    expect(next).not.toBe(first);
    expect(renew(table, first, TTL_MS, TTL_MS)).toBe(false);
  });

  it('renews only the matching token and keeps the lease held past the original expiry', () => {
    const table = leases();
    const token = granted(acquire(table, 'device-a', 0, TTL_MS));

    expect(renew(table, 'unknown', 500, TTL_MS)).toBe(false);
    expect(table.get('device-a')?.expiresAt).toBe(TTL_MS);

    expect(renew(table, token, 500, TTL_MS)).toBe(true);
    expect(table.get('device-a')).toEqual({ deviceId: 'device-a', token, expiresAt: 500 + TTL_MS });
    expect(acquire(table, 'device-a', TTL_MS, TTL_MS)).toEqual({ ok: false, reason: 'lease_held' });
    expect(acquire(table, 'device-a', 500 + TTL_MS - 1, TTL_MS)).toEqual({ ok: false, reason: 'lease_held' });
  });

  it('does not steal a held lease because it is 30s old', () => {
    const table = leases();
    const token = granted(acquire(table, 'device-a', 0, 120_000));

    expect(acquire(table, 'device-a', 30_000, 1_000)).toEqual({ ok: false, reason: 'lease_held' });
    expect(acquire(table, 'device-a', 119_999, 1_000)).toEqual({ ok: false, reason: 'lease_held' });
    expect(table.get('device-a')).toEqual({ deviceId: 'device-a', token, expiresAt: 120_000 });

    const next = granted(acquire(table, 'device-a', 120_000, 1_000));
    expect(next).not.toBe(token);
    expect(renew(table, token, 120_000, 1_000)).toBe(false);
    expect(release(table, token)).toBe(false);
  });

  it('releases and renews only the matching token', () => {
    const table = leases();
    const a = granted(acquire(table, 'device-a', 0, TTL_MS));
    const b = granted(acquire(table, 'device-b', 0, TTL_MS));

    expect(release(table, 'unknown')).toBe(false);
    expect(renew(table, 'unknown', 10, TTL_MS)).toBe(false);
    expect(table.get('device-a')).toEqual({ deviceId: 'device-a', token: a, expiresAt: TTL_MS });
    expect(table.get('device-b')).toEqual({ deviceId: 'device-b', token: b, expiresAt: TTL_MS });

    expect(release(table, a)).toBe(true);
    expect(table.has('device-a')).toBe(false);
    expect(table.get('device-b')?.token).toBe(b);
    expect(renew(table, a, 1, TTL_MS)).toBe(false);
    expect(release(table, a)).toBe(false);

    const again = granted(acquire(table, 'device-a', 1, TTL_MS));
    expect(again).not.toBe(a);
    expect(acquire(table, 'device-b', 1, TTL_MS)).toEqual({ ok: false, reason: 'lease_held' });
    expect(release(table, b)).toBe(true);
    expect(table.has('device-b')).toBe(false);
    expect(table.get('device-a')?.token).toBe(again);
  });

  it('does not let one device block another', () => {
    const table = leases();
    const a = granted(acquire(table, 'device-a', 0, TTL_MS));
    const b = granted(acquire(table, 'device-b', 0, TTL_MS));

    expect(a).not.toBe(b);
    expect(acquire(table, 'device-a', 1, TTL_MS)).toEqual({ ok: false, reason: 'lease_held' });
    expect(renew(table, b, 10, TTL_MS)).toBe(true);
    expect(table.get('device-a')).toEqual({ deviceId: 'device-a', token: a, expiresAt: TTL_MS });
    expect(table.get('device-b')?.expiresAt).toBe(10 + TTL_MS);
    expect(acquire(table, 'device-b', 10, TTL_MS)).toEqual({ ok: false, reason: 'lease_held' });
  });
});
