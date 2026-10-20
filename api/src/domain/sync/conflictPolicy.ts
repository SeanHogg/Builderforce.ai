/**
 * Domain — sync conflict policy: surface a conflict, never resolve it by
 * last-write-wins.
 *
 * `SyncConflict` in `packages/local-first/src/records.ts` records a `reason`
 * and a `resolvedAt`, but it never says what the server is allowed to do with a
 * row that two devices both changed. Without a rule the only available default
 * is "newest `updatedAt` wins", which silently discards one side's work: no
 * receipt, no conflict record, nothing to show the user. This module is the
 * rule that prevents that.
 *
 * The single supported policy is `'require_user'`: an overlap that cannot be
 * proven identical is reported, and the decision is the user's. There is no
 * timestamp tie-break anywhere in this file and there must never be one —
 * `updatedAt` is carried for the conflict record and reporting only.
 *
 * The three verdicts, in evaluation order:
 *
 * 1. A tombstone on EITHER side wins: `{ status: 'resolved', winner: 'deleted' }`.
 *    A delete is not a silent overwrite, it is a deletion. Both sides deleted is
 *    the same verdict — the row is gone either way, so nobody loses an edit.
 * 2. An exact version tie is a replay of one revision, not a conflict:
 *    `{ status: 'duplicate', requiresUser: false }`.
 * 3. Otherwise both sides moved and the versions differ:
 *    `{ status: 'conflict', requiresUser: true }`, and NEITHER side is picked.
 *
 * Order matters. A version tie that also carries a tombstone is a deletion, not
 * a duplicate replay: rule 1 is checked first so a delete is never downgraded
 * into "already seen" and resurrected by an import.
 *
 * Pure: no database, no HTTP, no clock. A push route calls this before it
 * writes anything.
 */

/** The one policy this domain supports. There is no automatic-resolution mode. */
export const CONFLICT_POLICY_REQUIRE_USER = 'require_user' as const;

export type SyncConflictPolicy = typeof CONFLICT_POLICY_REQUIRE_USER;

/** Widened so a value decoded off the wire can be checked, not just a literal. */
const SUPPORTED_POLICIES: readonly string[] = [CONFLICT_POLICY_REQUIRE_USER];

/** The minimum a caller must supply about each side of an overlap. */
export interface ConflictSide {
  /** Carried for the conflict record and reporting. Never a tie-break. */
  updatedAt: string;
  version: number;
  deletedAt?: string | null;
}

export type ConflictReason =
  | 'local_tombstone'
  | 'remote_tombstone'
  | 'both_tombstones'
  | 'version_tie'
  | 'concurrent_edits'
  | 'unsupported_policy';

interface ConflictResolutionBase {
  reason: ConflictReason;
  localVersion: number;
  remoteVersion: number;
  deletedAt?: string;
}

/**
 * `winner?: never` on the conflict and duplicate variants: a caller cannot set
 * a winner on a verdict that has none. Either `deleted`, or nothing.
 */
export type ConflictResolution =
  | (ConflictResolutionBase & {
      status: 'conflict';
      requiresUser: true;
      winner?: never;
    })
  | (ConflictResolutionBase & {
      status: 'duplicate';
      requiresUser: false;
      winner?: never;
    })
  | (ConflictResolutionBase & {
      status: 'resolved';
      requiresUser: false;
      winner: 'deleted';
      deletedAt: string;
    });

/**
 * A tombstone is a real deletion timestamp. `null`, `undefined`, and a blank
 * string are all "still alive" — an empty string is not a timestamp, and
 * treating it as a delete would let an unset column silently erase a row.
 */
function tombstoneAt(side: ConflictSide): string | undefined {
  const deletedAt = side.deletedAt;
  if (typeof deletedAt !== 'string') return undefined;
  return deletedAt.trim() === '' ? undefined : deletedAt;
}

/**
 * Decide what happens to a row that exists on both sides. See the module
 * comment for the three verdicts and their order.
 *
 * An unrecognised policy fails closed to `conflict` / `requiresUser: true`:
 * an unknown rule is not permission to overwrite somebody's work.
 */
export function resolveConflict(
  local: ConflictSide,
  remote: ConflictSide,
  policy: SyncConflictPolicy,
): ConflictResolution {
  const base = {
    localVersion: local.version,
    remoteVersion: remote.version,
  };

  const localDeletedAt = tombstoneAt(local);
  const remoteDeletedAt = tombstoneAt(remote);

  // 1. A deletion is not a silent overwrite. Checked before the version tie so
  //    a delete is never downgraded into "already seen" and resurrected.
  if (localDeletedAt !== undefined && remoteDeletedAt !== undefined) {
    return {
      ...base,
      status: 'resolved',
      winner: 'deleted',
      requiresUser: false,
      reason: 'both_tombstones',
      deletedAt: remoteDeletedAt,
    };
  }
  if (localDeletedAt !== undefined) {
    return {
      ...base,
      status: 'resolved',
      winner: 'deleted',
      requiresUser: false,
      reason: 'local_tombstone',
      deletedAt: localDeletedAt,
    };
  }
  if (remoteDeletedAt !== undefined) {
    return {
      ...base,
      status: 'resolved',
      winner: 'deleted',
      requiresUser: false,
      reason: 'remote_tombstone',
      deletedAt: remoteDeletedAt,
    };
  }

  // 2. Same revision on both sides is one revision arriving twice.
  if (local.version === remote.version) {
    return {
      ...base,
      status: 'duplicate',
      requiresUser: false,
      reason: 'version_tie',
    };
  }

  // 3. Two revisions of one row. Pick neither; a person decides.
  if (!SUPPORTED_POLICIES.includes(policy)) {
    return {
      ...base,
      status: 'conflict',
      requiresUser: true,
      reason: 'unsupported_policy',
    };
  }

  return {
    ...base,
    status: 'conflict',
    requiresUser: true,
    reason: 'concurrent_edits',
  };
}