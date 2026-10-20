/**
 * Device-scoped local storage keys (G27).
 *
 * The local snapshot lives on the device. A key built from the signed-in user
 * id moves when the account changes, so a second account on the same device
 * can read or overwrite the first account's snapshot. This module takes a
 * device id and a name only. It reads no session, no token, and no user id,
 * and offers no user-scoped alternative.
 */

const DEVICE_PREFIX = 'bf.device.';
const USER_PREFIX = 'bf.user.';
const USER_SEGMENT = '.user.';

/**
 * `bf.device.<deviceId>.<name>`.
 *
 * Throws `device_id_required` when the device id is missing or blank: an empty
 * id would collapse every device onto `bf.device..<name>`, which is one shared
 * slot again by another route.
 */
export function deviceStorageKey(deviceId: string, name: string): string {
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) throw new Error('device_id_required');
  const segment = typeof name === 'string' ? name.trim() : '';
  if (!segment) throw new Error('storage_name_required');
  return `${DEVICE_PREFIX}${id}.${segment}`;
}

/**
 * True when a key is addressed by user identity rather than by device, i.e. it
 * starts with `bf.user.` or contains a `.user.` segment. Such a key follows the
 * account across a sign-out and sign-in, so it is refused for local snapshots.
 */
export function refusesUserScopedKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return key.startsWith(USER_PREFIX) || key.includes(USER_SEGMENT);
}