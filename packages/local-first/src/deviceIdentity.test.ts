import { describe, expect, it, vi } from 'vitest';
import {
  DEVICE_ID_IS_USER,
  mintDeviceId,
  resolveDeviceId,
  sameDeviceAfterSignOut,
} from './deviceIdentity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_A = 'user-account-a';
const USER_B = 'user-account-b';

describe('device identity', () => {
  it('mints a dev_-prefixed uuid, and two calls differ', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_denied'));
    try {
      const first = mintDeviceId();
      const second = mintDeviceId();

      expect(first.startsWith('dev_')).toBe(true);
      expect(first.slice('dev_'.length)).toMatch(UUID);
      expect(second.startsWith('dev_')).toBe(true);
      expect(second.slice('dev_'.length)).toMatch(UUID);
      expect(second).not.toBe(first);
      expect(first).not.toBeInstanceOf(Promise);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns a stored device id unchanged, including across a different signed-in user', () => {
    const stored = mintDeviceId();
    expect(resolveDeviceId(stored, USER_A)).toBe(stored);
    expect(resolveDeviceId(stored, USER_B)).toBe(stored);
    expect(resolveDeviceId(stored, null)).toBe(stored);
    expect(resolveDeviceId(stored, undefined)).toBe(stored);
    expect(resolveDeviceId(stored, '')).toBe(stored);
    // A legacy raw uuid is still the same device; do not remint it.
    const legacy = '018f0c2a-1111-4222-8333-444455556666';
    expect(resolveDeviceId(legacy, USER_A)).toBe(legacy);
  });

  it('mints when nothing is stored', () => {
    const minted = new Set<string>();
    for (const stored of ['', '   ', null, undefined]) {
      const id = resolveDeviceId(stored, USER_A);
      expect(id.startsWith('dev_')).toBe(true);
      expect(id).not.toBe(USER_A);
      expect(id.startsWith(USER_A)).toBe(false);
      minted.add(id);
    }
    expect(minted.size).toBe(4);
  });

  it('refuses a stored id that equals the signed-in user', () => {
    expect(() => resolveDeviceId(USER_A, USER_A)).toThrow(DEVICE_ID_IS_USER);
    expect(() => resolveDeviceId(USER_A, USER_A)).toThrow(/^device_id_is_user$/);
    try {
      resolveDeviceId(USER_A, USER_A);
      expect.unreachable('device_id_is_user');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(DEVICE_ID_IS_USER);
    }
  });

  it('refuses a stored id that starts with the signed-in user id', () => {
    expect(() => resolveDeviceId(`${USER_A}-device`, USER_A)).toThrow(DEVICE_ID_IS_USER);
    expect(() => resolveDeviceId(`${USER_A}${mintDeviceId()}`, USER_A)).toThrow(DEVICE_ID_IS_USER);
    // Containing the user id later is not a prefix, so the stored id stands.
    const embedded = `dev_${USER_A}`;
    expect(resolveDeviceId(embedded, USER_A)).toBe(embedded);
  });

  it('is the same device after sign-out only when the id is unchanged and is not the user', () => {
    const deviceId = mintDeviceId();
    expect(sameDeviceAfterSignOut(deviceId, deviceId, USER_A)).toBe(true);
    expect(sameDeviceAfterSignOut(deviceId, deviceId, USER_B)).toBe(true);
    expect(sameDeviceAfterSignOut(deviceId, mintDeviceId(), USER_A)).toBe(false);
    expect(sameDeviceAfterSignOut(USER_A, USER_A, USER_A)).toBe(false);
    expect(sameDeviceAfterSignOut(deviceId, USER_A, USER_A)).toBe(false);
    expect(sameDeviceAfterSignOut('', '', USER_A)).toBe(false);
    expect(sameDeviceAfterSignOut('   ', '   ', USER_A)).toBe(false);
  });
});
