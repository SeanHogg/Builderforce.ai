/**
 * "Is there anything new behind that version number?" — the unread half of the
 * product-updates changelog.
 *
 * The panel is reachable from every route and nothing announced it, so passive
 * feature discovery did not exist: only a user who thought to click a version
 * string ever saw what shipped. This module is the one place that answers how
 * many published notes a given person has not seen, and the one place that moves
 * their read clock.
 *
 * TWO DECISIONS WORTH NAMING:
 *
 *   1. The count is taken over the CACHED published list, not a second query.
 *      Every signed-in read of `/betas` would otherwise add a `COUNT(*)` over
 *      `release_notes` on a list that changes only when an operator publishes —
 *      the exact read the published-list cache exists to serve.
 *
 *   2. A NULL `product_updates_seen_at` reads as the account's `created_at`.
 *      The alternative (treat NULL as the epoch) badges every brand-new signup
 *      with the entire history of the product, which reads as noise and trains
 *      people to ignore the badge on the one day it could have taught them
 *      something. Notes that predate you are not new to you.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { users } from '../../infrastructure/database/schema';
import type { UserId } from '../../domain/shared/types';
import { listPublishedReleaseNotes } from './releaseNotes';

/**
 * Published notes this user has not seen. 0 for an unknown user rather than a
 * throw: the badge is chrome, and chrome must never be the thing that breaks a
 * page.
 */
export async function countUnreadReleaseNotes(env: Env, db: Db, userId: UserId): Promise<number> {
  const [row] = await db
    .select({ seenAt: users.productUpdatesSeenAt, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return 0;

  // NULL seen-at → the account's own creation date (see the header).
  const since = (row.seenAt ?? row.createdAt).getTime();
  const notes = await listPublishedReleaseNotes(env, db);
  return notes.filter((n) => n.publishedAt != null && Date.parse(n.publishedAt) > since).length;
}

/** Mark everything published up to now as seen. Called when the panel opens —
 *  opening the changelog IS reading it, so there is no second "mark as read". */
export async function markReleaseNotesSeen(db: Db, userId: UserId): Promise<void> {
  await db
    .update(users)
    .set({ productUpdatesSeenAt: sql`NOW()` })
    .where(eq(users.id, userId));
}
