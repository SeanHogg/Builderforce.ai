import { describe, expect, it } from 'vitest';
import { MAX_KNOWN_PRESENCE, parseKnownPresence, presenceDelta, presenceFingerprint, type PresenceMemberRow } from './presenceDelta';

const member = (userId: string, overrides: Partial<PresenceMemberRow> = {}): PresenceMemberRow => ({
  userId, role: 'editor', displayName: userId.toUpperCase(), avatarUrl: null, lastSeenRevision: 3,
  lastSeenAt: '2026-10-17T12:00:00Z', viewport: { x: 1, y: 2, zoom: 1 }, cursor: { x: 5, y: 6 },
  selection: ['s1'], typing: false, followingUserId: null, ...overrides,
});

describe('presenceFingerprint', () => {
  it('ignores the heartbeat timestamp and JSONB key order', () => {
    const a = member('a');
    expect(presenceFingerprint(member('a', { lastSeenAt: '2026-10-17T12:00:30Z' }))).toBe(presenceFingerprint(a));
    expect(presenceFingerprint(member('a', { viewport: { zoom: 1, y: 2, x: 1 } }))).toBe(presenceFingerprint(a));
  });

  it('changes when anything the board draws changes', () => {
    const base = presenceFingerprint(member('a'));
    for (const change of [{ cursor: { x: 9, y: 6 } }, { selection: [] }, { typing: true }, { role: 'viewer' }, { lastSeenRevision: 4 }, { followingUserId: 'b' }]) {
      expect(presenceFingerprint(member('a', change))).not.toBe(base);
    }
  });
});

describe('presenceDelta', () => {
  it('returns the full list, unchanged in shape, when the caller sent no `known`', () => {
    const rows = [member('a'), member('b')];
    expect(presenceDelta(rows, null)).toEqual({ members: rows });
  });

  it('ships only changed or new members, every present id, and the fingerprints', () => {
    const a = member('a');
    const b = member('b');
    const known = new Map([['a', presenceFingerprint(a)], ['b', 'stale'], ['gone', 'x']]);
    const delta = presenceDelta([a, b, member('c')], known);
    expect(delta.members.map((m) => m.userId)).toEqual(['b', 'c']);
    expect(delta.present).toEqual(['a', 'b', 'c']);
    expect(Object.keys(delta.fingerprints ?? {})).toEqual(['a', 'b', 'c']);
  });

  it('an empty `known` asks for a delta answer carrying everyone', () => {
    const delta = presenceDelta([member('a')], parseKnownPresence({}));
    expect(delta.members).toHaveLength(1);
    expect(delta.present).toEqual(['a']);
  });
});

describe('parseKnownPresence', () => {
  it('accepts only a bounded string map', () => {
    expect(parseKnownPresence(undefined)).toBeNull();
    expect(parseKnownPresence(['a'])).toBeNull();
    expect([...parseKnownPresence({ a: 'x', b: 7 })!.entries()]).toEqual([['a', 'x']]);
    const many = Object.fromEntries(Array.from({ length: MAX_KNOWN_PRESENCE + 5 }, (_, i) => [`u${i}`, 'f']));
    expect(parseKnownPresence(many)!.size).toBe(MAX_KNOWN_PRESENCE);
  });
});
