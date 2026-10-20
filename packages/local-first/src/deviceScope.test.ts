import { describe, expect, it } from 'vitest';
import { deviceStorageKey, refusesUserScopedKey } from './deviceScope.js';

const NAME = 'local-first-v1';
const USER_A = 'user-account-a';
const USER_B = 'user-account-b';

describe('device storage scope', () => {
  it('builds a bf.device key and nothing user scoped', () => {
    const key = deviceStorageKey('device-a', NAME);
    expect(key).toBe('bf.device.device-a.local-first-v1');
    expect(key.startsWith('bf.device.')).toBe(true);
    expect(refusesUserScopedKey(key)).toBe(false);
  });

  it('gives two device ids two different keys for the same name', () => {
    const onDeviceA = deviceStorageKey('device-a', NAME);
    const onDeviceB = deviceStorageKey('device-b', NAME);
    expect(onDeviceA).not.toBe(onDeviceB);
    expect(onDeviceA).toBe('bf.device.device-a.local-first-v1');
    expect(onDeviceB).toBe('bf.device.device-b.local-first-v1');
  });

  it('keeps a user id out of the device key for either account', () => {
    for (const deviceId of ['device-a', 'device-b']) {
      const key = deviceStorageKey(deviceId, NAME);
      expect(key).not.toContain(USER_A);
      expect(key).not.toContain(USER_B);
      expect(key).not.toContain('.user.');
      expect(refusesUserScopedKey(key)).toBe(false);
    }
  });

  it('keeps one key on a shared device when the signed-in account changes', () => {
    // Second account on the same device reads the same snapshot; it cannot be
    // pointed at another account's namespace because the key has no user part.
    const signedInAsA = deviceStorageKey('device-shared', NAME);
    const signedInAsB = deviceStorageKey('device-shared', NAME);
    expect(signedInAsA).toBe(signedInAsB);
    expect(signedInAsA).toBe('bf.device.device-shared.local-first-v1');
    expect(signedInAsA).not.toContain(USER_A);
    expect(signedInAsB).not.toContain(USER_B);
  });

  it('throws device_id_required when the device id is empty', () => {
    expect(() => deviceStorageKey('', NAME)).toThrow('device_id_required');
    expect(() => deviceStorageKey('   ', NAME)).toThrow('device_id_required');
  });

  it('requires a name so a device cannot collapse onto the bare prefix', () => {
    expect(() => deviceStorageKey('device-a', '')).toThrow('storage_name_required');
    expect(() => deviceStorageKey('device-a', '  ')).toThrow('storage_name_required');
  });

  it('refuses a user scoped key by prefix or by segment', () => {
    expect(refusesUserScopedKey(`bf.user.${USER_A}.${NAME}`)).toBe(true);
    expect(refusesUserScopedKey(`bf.device.device-a.user.${USER_A}`)).toBe(true);
    expect(refusesUserScopedKey(`bf.device.device-a.${USER_A}.user.${NAME}`)).toBe(true);
  });

  it('accepts a device scoped key under any name', () => {
    expect(refusesUserScopedKey(deviceStorageKey('device-a', NAME))).toBe(false);
    expect(refusesUserScopedKey(deviceStorageKey('device-a', 'audit.store'))).toBe(false);
    expect(refusesUserScopedKey('bf.device.device-a.users')).toBe(false);
    expect(refusesUserScopedKey('bf.policy.v1')).toBe(false);
    expect(refusesUserScopedKey('')).toBe(false);
  });
});