import { describe, expect, it } from 'vitest';
import {
  CONFLICT_POLICY_REQUIRE_USER,
  resolveConflict,
  type ConflictSide,
} from './conflictPolicy';

const policy = CONFLICT_POLICY_REQUIRE_USER;

function side(overrides: Partial<ConflictSide> = {}): ConflictSide {
  return { updatedAt: '2026-10-18T10:00:00.000Z', version: 1, ...overrides };
}

describe('resolveConflict', () => {
  it('supports require_user and nothing else', () => {
    expect(policy).toBe('require_user');
    const resolution = resolveConflict(side({ version: 3 }), side({ version: 4 }), policy);
    expect(resolution.requiresUser).toBe(true);
  });

  it('surfaces a genuine overlap and picks neither side', () => {
    const local = side({ version: 4, updatedAt: '2026-10-18T10:00:00.000Z' });
    const remote = side({ version: 9, updatedAt: '2026-10-18T11:00:00.000Z' });

    const resolution = resolveConflict(local, remote, policy);

    expect(resolution.status).toBe('conflict');
    expect(resolution.requiresUser).toBe(true);
    expect(resolution.reason).toBe('concurrent_edits');
    // No winner key at all: not local, not remote, not deleted.
    expect(resolution).not.toHaveProperty('winner');
    expect(resolution.winner).toBeUndefined();
    expect(resolution.localVersion).toBe(4);
    expect(resolution.remoteVersion).toBe(9);
  });

  it('never resolves by newest updatedAt in either direction', () => {
    const older = side({ version: 2, updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = side({ version: 3, updatedAt: '2026-12-31T23:59:59.000Z' });

    // Newer remote wins nothing.
    expect(resolveConflict(older, newer, policy).status).toBe('conflict');
    expect(resolveConflict(older, newer, policy).requiresUser).toBe(true);
    // Newer local wins nothing either. The verdict does not depend on which
    // side has the later clock, which is exactly what last-write-wins would be.
    expect(resolveConflict(newer, older, policy).status).toBe('conflict');
    expect(resolveConflict(newer, older, policy).requiresUser).toBe(true);
  });

  it('treats an exact version tie as a duplicate, not a conflict', () => {
    const resolution = resolveConflict(
      side({ version: 7, updatedAt: '2026-10-18T10:00:00.000Z' }),
      side({ version: 7, updatedAt: '2026-10-18T12:00:00.000Z' }),
      policy,
    );

    expect(resolution.status).toBe('duplicate');
    expect(resolution.requiresUser).toBe(false);
    expect(resolution.reason).toBe('version_tie');
    expect(resolution).not.toHaveProperty('winner');
  });

  it('lets a local tombstone win as a deletion', () => {
    const resolution = resolveConflict(
      side({ version: 5, deletedAt: '2026-10-18T13:00:00.000Z' }),
      side({ version: 2, updatedAt: '2026-10-18T09:00:00.000Z' }),
      policy,
    );

    expect(resolution.status).toBe('resolved');
    expect(resolution.winner).toBe('deleted');
    expect(resolution.requiresUser).toBe(false);
    expect(resolution.reason).toBe('local_tombstone');
    expect(resolution.deletedAt).toBe('2026-10-18T13:00:00.000Z');
  });

  it('lets a remote tombstone win as a deletion', () => {
    const resolution = resolveConflict(
      side({ version: 5, updatedAt: '2026-10-18T09:00:00.000Z' }),
      side({ version: 2, deletedAt: '2026-10-18T13:00:00.000Z' }),
      policy,
    );

    expect(resolution.status).toBe('resolved');
    expect(resolution.winner).toBe('deleted');
    expect(resolution.requiresUser).toBe(false);
    expect(resolution.reason).toBe('remote_tombstone');
    expect(resolution.deletedAt).toBe('2026-10-18T13:00:00.000Z');
  });

  it('lets a remote tombstone beat a locally newer version', () => {
    // The local side looks like a fresh edit by version and clock. The delete
    // still wins: a delete is not a silent overwrite.
    const resolution = resolveConflict(
      side({ version: 40, updatedAt: '2026-12-31T23:59:59.000Z' }),
      side({ version: 3, deletedAt: '2026-02-01T00:00:00.000Z' }),
      policy,
    );

    expect(resolution.status).toBe('resolved');
    expect(resolution.winner).toBe('deleted');
    expect(resolution.requiresUser).toBe(false);
  });

  it('resolves both-tombstones as deleted without asking anyone', () => {
    const resolution = resolveConflict(
      side({ version: 5, deletedAt: '2026-10-18T13:00:00.000Z' }),
      side({ version: 6, deletedAt: '2026-10-18T14:00:00.000Z' }),
      policy,
    );

    expect(resolution.status).toBe('resolved');
    expect(resolution.winner).toBe('deleted');
    expect(resolution.requiresUser).toBe(false);
    expect(resolution.reason).toBe('both_tombstones');
  });

  it('keeps a deletion a deletion when the versions also tie', () => {
    // Checked before the version tie, so a delete is never downgraded into a
    // "duplicate replay" and resurrected by an import.
    const resolution = resolveConflict(
      side({ version: 8, deletedAt: '2026-10-18T13:00:00.000Z' }),
      side({ version: 8, deletedAt: '2026-10-18T13:00:00.000Z' }),
      policy,
    );

    expect(resolution.status).toBe('resolved');
    expect(resolution.winner).toBe('deleted');
    expect(resolution.requiresUser).toBe(false);
  });

  it('reads null, undefined, and blank deletedAt as still alive', () => {
    const remote = side({ version: 2 });
    for (const deletedAt of [undefined, null, '', '   ']) {
      const resolution = resolveConflict(side({ version: 5, deletedAt }), remote, policy);
      expect(resolution.status).toBe('conflict');
      expect(resolution.requiresUser).toBe(true);
    }

    expect(resolveConflict(side({ version: 5 }), remote, policy).status).toBe('conflict');
    expect(resolveConflict(remote, side({ version: 5 }), policy).status).toBe('conflict');
  });

  it('fails closed to conflict when the policy is not recognised', () => {
    const unknownPolicy = 'last_write_wins' as unknown as typeof policy;
    const resolution = resolveConflict(side({ version: 1 }), side({ version: 2 }), unknownPolicy);

    expect(resolution.status).toBe('conflict');
    expect(resolution.requiresUser).toBe(true);
    expect(resolution.reason).toBe('unsupported_policy');
    expect(resolution).not.toHaveProperty('winner');
  });

  it('never returns a winner for any conflict or duplicate verdict', () => {
    const cases: Array<[ConflictSide, ConflictSide]> = [
      [side({ version: 1 }), side({ version: 2 })],
      [side({ version: 2 }), side({ version: 1 })],
      [side({ version: 3 }), side({ version: 3 })],
      [side({ version: 1, updatedAt: '2026-01-01T00:00:00.000Z' }), side({ version: 2 })],
      [side({ version: 1 }), side({ version: 2, deletedAt: null })],
    ];

    for (const [local, remote] of cases) {
      const resolution = resolveConflict(local, remote, policy);
      if (resolution.status === 'resolved') continue;
      expect(resolution.requiresUser).toBe(resolution.status === 'conflict');
      expect(resolution.winner).toBeUndefined();
    }
  });
});