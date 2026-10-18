import { describe, expect, it } from 'vitest';
import { createPresenceTracker, mergePresence } from './presenceDelta';

type M = { userId: string; cursor?: { x: number; y: number } };

describe('mergePresence', () => {
  it('treats an answer without `present` as the full roster', () => {
    const answer = { members: [{ userId: 'a' }] };
    expect(mergePresence<M>([{ userId: 'z' }], answer)).toEqual({ members: answer.members, complete: true });
  });

  it('keeps held rows for unchanged members, takes changed ones, and drops departures', () => {
    const held: M[] = [{ userId: 'a', cursor: { x: 1, y: 1 } }, { userId: 'b' }, { userId: 'gone' }];
    const merged = mergePresence<M>(held, { members: [{ userId: 'b', cursor: { x: 9, y: 9 } }], present: ['a', 'b'] });
    expect(merged.complete).toBe(true);
    expect(merged.members).toEqual([{ userId: 'a', cursor: { x: 1, y: 1 } }, { userId: 'b', cursor: { x: 9, y: 9 } }]);
    expect(merged.members[0]).toBe(held[0]);
  });

  it('flags a present member it holds no row for', () => {
    expect(mergePresence<M>([], { members: [], present: ['a'] }).complete).toBe(false);
  });
});

describe('createPresenceTracker', () => {
  it('echoes the fingerprints back, and forgets them when the roster has a hole', () => {
    const tracker = createPresenceTracker<M>();
    expect(tracker.known()).toEqual({});
    tracker.apply({ members: [{ userId: 'a' }], present: ['a'], fingerprints: { a: 'f1' } });
    expect(tracker.known()).toEqual({ a: 'f1' });
    expect(tracker.apply({ members: [], present: ['a'], fingerprints: { a: 'f1' } })).toEqual([{ userId: 'a' }]);
    tracker.apply({ members: [], present: ['a', 'b'], fingerprints: { a: 'f1', b: 'f2' } });
    expect(tracker.known()).toEqual({});
  });

  it('reset forgets the roster and fingerprints, so the next board starts from a full list', () => {
    const tracker = createPresenceTracker<M>();
    tracker.apply({ members: [{ userId: 'a' }], present: ['a'], fingerprints: { a: 'f1' } });
    tracker.reset();
    expect(tracker.known()).toEqual({});
    expect(tracker.apply({ members: [], present: [], fingerprints: {} })).toEqual([]);
  });
});
