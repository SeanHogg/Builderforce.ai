/**
 * Tab coordinator claim (G24 remainder).
 *
 * One device, many tabs. Two tabs of the same device must not both be the
 * sync coordinator. `claimTab` returns `{ holder: tabId }` when `lease.holder`
 * is absent or `lease.expiresAt <= now` (an expiry equal to now is not held).
 * A different tab whose lease is still live gets
 * `{ holder: lease.holder, refused: tabId }` and the holder is not changed.
 * The same tab may claim again while it still holds.
 *
 * `heartbeat` extends `expiresAt` to `now + ttlMs` only when `holder === tabId`.
 * Any other caller gets the same lease object back.
 *
 * Neither function mutates its input. The caller stores the next lease.
 * Two device ids are out of scope: this lease is already one device. This
 * module does not open IndexedDB, take a file lock, or call the network.
 */

export interface TabCoordinatorLease {
  /** Absent, or blank, when no tab holds the coordinator. */
  readonly holder?: string;
  readonly expiresAt: number;
}

export type TabClaimResult =
  | { readonly holder: string }
  | { readonly holder: string; readonly refused: string };

function holderAbsent(holder: string | undefined): boolean {
  return holder === undefined || holder.length === 0;
}

/**
 * Claim the coordinator for `tabId`.
 *
 * Grants `{ holder: tabId }` when nobody holds, the lease has expired
 * (`expiresAt <= now`), or this tab already holds. A different live holder
 * is refused and left in place.
 */
export function claimTab(lease: TabCoordinatorLease, tabId: string, now: number): TabClaimResult {
  const holder = lease.holder;
  if (!holderAbsent(holder) && holder !== tabId && lease.expiresAt > now) {
    return { holder, refused: tabId };
  }
  return { holder: tabId };
}

/**
 * Extend `expiresAt` to `now + ttlMs` only for the current holder.
 *
 * A different tab, or a lease with no holder, is returned unchanged.
 */
export function heartbeat(
  lease: TabCoordinatorLease,
  tabId: string,
  now: number,
  ttlMs: number,
): TabCoordinatorLease {
  if (lease.holder !== tabId) return lease;
  return { holder: lease.holder, expiresAt: now + ttlMs };
}
