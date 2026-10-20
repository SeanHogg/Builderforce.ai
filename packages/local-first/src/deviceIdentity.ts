/**
 * Stable device identity (G04).
 *
 * The device id is minted on this machine and kept across sign-out. It is not
 * the signed-in user id, and it is not derived from one: a later account on
 * the same device must still see the same device. This module does not read
 * storage, a session, or the network.
 */

/** Thrown when a stored id is the signed-in user, or starts with that user id. */
export const DEVICE_ID_IS_USER = 'device_id_is_user';

const DEVICE_PREFIX = 'dev_';

function deviceIdIsUser(): never {
  throw Object.assign(new Error(DEVICE_ID_IS_USER), { code: DEVICE_ID_IS_USER });
}

/**
 * Mint a device id: `dev_` plus `crypto.randomUUID`.
 *
 * Local only. Two calls never return the same id.
 */
export function mintDeviceId(): string {
  return `${DEVICE_PREFIX}${crypto.randomUUID()}`;
}

function blank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Keep a stored device id, or mint one when nothing is stored.
 *
 * A non-empty stored id is returned unchanged so a restart does not mint a
 * second device. That id must not be the signed-in user and must not start
 * with the user id — both throw `device_id_is_user`. An empty, missing, or
 * whitespace-only stored value is not an id; a new one is minted.
 */
export function resolveDeviceId(
  stored: string | null | undefined,
  signedInUserId: string | null | undefined,
): string {
  if (blank(stored)) return mintDeviceId();
  const id = stored as string;
  const userId = typeof signedInUserId === 'string' ? signedInUserId : '';
  if (userId !== '' && (id === userId || id.startsWith(userId))) deviceIdIsUser();
  return id;
}

/**
 * True only when sign-out left the same device id, and that id is not `userId`.
 *
 * Equal blanks are not a device. A non-string is not a device. If either id
 * equals the passed user id, the identity followed the account, not the device.
 */
export function sameDeviceAfterSignOut(
  before: string,
  after: string,
  userId: string,
): boolean {
  if (typeof before !== 'string' || typeof after !== 'string') return false;
  if (before.trim() === '' || after.trim() === '') return false;
  if (before !== after) return false;
  if (before === userId || after === userId) return false;
  return true;
}
