/**
 * Device-scoped coordinator lease (G24).
 *
 * Exactly one sync coordinator may hold a live lease for a device store.
 * `acquire` returns a token when no live lease exists for that device, and
 * `{ ok: false, reason: 'lease_held' }` when one does. A lease is held only
 * while `expiresAt > now`; an expiry in the past, or equal to now, is not
 * held. Age does not steal a live lease, including at 30s: a future
 * `expiresAt` stays held. There is no steal window. Two devices never block
 * each other. `release` and `renew` affect only the matching token and
 * return false for any other token.
 *
 * The caller owns the lease table. This module does not open IndexedDB,
 * take a file lock, or call the network.
 */

export interface CoordinatorLease {
  readonly deviceId: string;
  readonly token: string;
  expiresAt: number;
}

/** One slot per device id. The caller creates and keeps this table. */
export type CoordinatorLeases = Map<string, CoordinatorLease>;

export type AcquireResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: 'lease_held' };

function isHeld(lease: CoordinatorLease | undefined, now: number): lease is CoordinatorLease {
  return lease !== undefined && lease.expiresAt > now;
}

export function acquire(
  leases: CoordinatorLeases,
  deviceId: string,
  now: number,
  ttlMs: number,
): AcquireResult {
  const current = leases.get(deviceId);
  if (isHeld(current, now)) return { ok: false, reason: 'lease_held' };
  const token = crypto.randomUUID();
  leases.set(deviceId, { deviceId, token, expiresAt: now + ttlMs });
  return { ok: true, token };
}

function matching(leases: CoordinatorLeases, token: string): CoordinatorLease | undefined {
  for (const lease of leases.values()) {
    if (lease.token === token) return lease;
  }
  return undefined;
}

/** Deletes only the row whose token matches. A foreign or unknown token is a no-op. */
export function release(leases: CoordinatorLeases, token: string): boolean {
  const lease = matching(leases, token);
  if (!lease) return false;
  leases.delete(lease.deviceId);
  return true;
}

/** Extends only the row whose token matches. A foreign or unknown token is left unchanged. */
export function renew(leases: CoordinatorLeases, token: string, now: number, ttlMs: number): boolean {
  const lease = matching(leases, token);
  if (!lease) return false;
  lease.expiresAt = now + ttlMs;
  return true;
}
