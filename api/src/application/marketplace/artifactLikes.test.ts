/**
 * THE like use case — both like doors (`/api/marketplace-stats/like` and the
 * deprecated `/marketplace/skills/:slug/like`) land here, so these pin the rules
 * that used to differ between them: one store, a toggle that cannot double-insert,
 * and a skill catalogue counter derived from that store rather than nudged ±1.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { isLikeableArtifactType, readArtifactStats, toggleArtifactLike } from './artifactLikes';

describe('toggleArtifactLike', () => {
  it('likes when nothing was removed, idempotently on the primary key', async () => {
    const db = fakeDb([[], []]);
    const res = await toggleArtifactLike(db as unknown as Db, { userId: 'u1', type: 'persona', slug: 'p1' });
    expect(res).toEqual({ liked: true });
    expect(db.calls.map((c) => c.kind)).toEqual(['delete', 'insert']);
    expect(db.calls[1]?.chain).toContain('onConflictDoNothing');
    expect(db.calls[1]?.payload).toEqual({ userId: 'u1', artifactType: 'persona', artifactSlug: 'p1' });
  });

  it('unlikes when the delete removed the caller\'s row, without inserting', async () => {
    const db = fakeDb([[{ slug: 'p1' }]]);
    const res = await toggleArtifactLike(db as unknown as Db, { userId: 'u1', type: 'persona', slug: 'p1' });
    expect(res).toEqual({ liked: false });
    expect(db.calls.map((c) => c.kind)).toEqual(['delete']);
  });

  it('re-derives the skill catalogue counter from the store after a skill toggle', async () => {
    const db = fakeDb([[], [], []]);
    await toggleArtifactLike(db as unknown as Db, { userId: 'u1', type: 'skill', slug: 's1' });
    expect(db.calls.map((c) => c.kind)).toEqual(['delete', 'insert', 'update']);
    // A recomputed count, never a `likes + 1` that drifts on retries.
    expect(Object.keys(db.calls[2]?.payload as object)).toEqual(['likes']);
  });
});

describe('readArtifactStats', () => {
  it('returns nothing (and runs no query) for an empty slug list', async () => {
    const db = fakeDb();
    expect(await readArtifactStats(db as unknown as Db, { type: 'skill', slugs: ['', ''], userId: null })).toEqual({});
    expect(db.calls).toHaveLength(0);
  });

  it('merges likes, installs and the caller\'s own like flag per slug', async () => {
    const db = fakeDb([
      [{ slug: 'a', count: '3' }],
      [{ slug: 'a' }],
      [{ slug: 'b', count: 2 }],
    ]);
    const stats = await readArtifactStats(db as unknown as Db, { type: 'skill', slugs: ['a', 'b'], userId: 'u1' });
    expect(stats).toEqual({
      a: { likes: 3, installs: 0, liked: true },
      b: { likes: 0, installs: 2, liked: false },
    });
  });

  it('skips the per-user read when signed out', async () => {
    const db = fakeDb([[{ slug: 'a', count: 1 }], []]);
    const stats = await readArtifactStats(db as unknown as Db, { type: 'agent', slugs: ['a'], userId: null });
    expect(stats.a).toEqual({ likes: 1, installs: 0, liked: false });
    expect(db.calls).toHaveLength(2);
  });
});

describe('isLikeableArtifactType', () => {
  it('admits exactly the artifact_type enum values', () => {
    expect(['skill', 'persona', 'agent'].every(isLikeableArtifactType)).toBe(true);
    expect(isLikeableArtifactType('content')).toBe(false);
    expect(isLikeableArtifactType(undefined)).toBe(false);
  });
});
