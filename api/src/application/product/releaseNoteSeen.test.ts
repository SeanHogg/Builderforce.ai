import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The unread count behind the version chip's badge.
 *
 * The two rules worth pinning are both about NOT crying wolf: a brand-new
 * account is not badged with the entire history of the product, and the count is
 * taken over the cached published list rather than a second query per signed-in
 * read.
 */

const published = vi.hoisted(() => ({ listPublishedReleaseNotes: vi.fn() }));
vi.mock('./releaseNotes', async (orig) => ({
  ...(await orig<typeof import('./releaseNotes')>()),
  ...published,
}));

import { countUnreadReleaseNotes } from './releaseNoteSeen';

const note = (publishedAt: string | null) => ({
  id: publishedAt ?? 'draft', version: '2026.8.23', title: 'T', body: null,
  category: 'new', stage: 'live', betaOptIn: false, betaTerms: null,
  stageEndsAt: null, publishedAt, emailedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
});

/** A `users` row read: select().from().where().limit() → [row]. */
const userDb = (row: { seenAt: Date | null; createdAt: Date } | null) => ({
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }),
  }),
}) as any;

const env = {} as any;
const AUG_10 = new Date('2026-08-10T00:00:00.000Z');
const AUG_14 = new Date('2026-08-14T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  published.listPublishedReleaseNotes.mockResolvedValue([
    note('2026-08-15T18:23:00.000Z'),
    note('2026-08-15T18:22:00.000Z'),
    note('2026-08-12T09:00:00.000Z'),
    note('2026-08-09T09:00:00.000Z'),
  ]);
});

describe('countUnreadReleaseNotes', () => {
  it('counts only what was published after the last time they looked', async () => {
    const count = await countUnreadReleaseNotes(env, userDb({ seenAt: AUG_14, createdAt: AUG_10 }), 'u1' as never);
    expect(count).toBe(2);
  });

  it('reads a never-opened panel as the account\'s own start date, not the epoch', async () => {
    // Signed up on the 14th: the three notes that predate them are not new TO
    // THEM, so a fresh account is badged with what shipped since — not with the
    // whole changelog, which is how a badge trains people to ignore it.
    const count = await countUnreadReleaseNotes(env, userDb({ seenAt: null, createdAt: AUG_14 }), 'u1' as never);
    expect(count).toBe(2);
  });

  it('badges nothing for an account created after the newest note', async () => {
    const fresh = new Date('2026-08-16T00:00:00.000Z');
    const count = await countUnreadReleaseNotes(env, userDb({ seenAt: null, createdAt: fresh }), 'u1' as never);
    expect(count).toBe(0);
  });

  it('takes the count over the cached published list — never a second query', async () => {
    await countUnreadReleaseNotes(env, userDb({ seenAt: AUG_10, createdAt: AUG_10 }), 'u1' as never);
    expect(published.listPublishedReleaseNotes).toHaveBeenCalledTimes(1);
  });

  it('returns 0 for an unknown user rather than throwing — the badge is chrome', async () => {
    expect(await countUnreadReleaseNotes(env, userDb(null), 'ghost' as never)).toBe(0);
    expect(published.listPublishedReleaseNotes).not.toHaveBeenCalled();
  });
});
