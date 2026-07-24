/**
 * Platform release notes — the changelog Builderforce markets to its own users.
 *
 * PLATFORM-GLOBAL, not tenant-scoped: one list feeds every user's footer
 * "What's new" panel and the weekly product-updates digest email. (Contrast
 * `changelog_entries`, which is a tenant's changelog for THEIR product.)
 *
 * Read shape: the published list is read by every user on panel-open, changes
 * only when an operator publishes — the canonical read-through-cache case. One
 * fixed key holds the newest PUBLISHED_CACHE_LIMIT rows; every write invalidates
 * it, so a just-published note appears on the next open rather than after a TTL.
 *
 * "Sent" state: `emailedAt` is stamped by the weekly digest AFTER it mails the
 * note out, so a note is marketed by email exactly once while the panel keeps
 * the full history. The digest reads published-and-unsent via
 * `listUnsentPublishedReleaseNotes`.
 */

import { desc, eq, inArray, isNotNull, isNull, and, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { releaseNotes } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

export const RELEASE_NOTE_CATEGORIES = ['new', 'improvement', 'fix'] as const;
export type ReleaseNoteCategory = (typeof RELEASE_NOTE_CATEGORIES)[number];

export function isReleaseNoteCategory(value: unknown): value is ReleaseNoteCategory {
  return typeof value === 'string' && (RELEASE_NOTE_CATEGORIES as readonly string[]).includes(value);
}

/** The wire/UI shape — timestamps as ISO strings so the cached value is pure JSON. */
export interface ReleaseNote {
  id: string;
  version: string;
  title: string;
  body: string | null;
  category: string;
  publishedAt: string | null;
  emailedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const PUBLISHED_CACHE_KEY = 'release-notes:published';
/** Upper bound on the cached published list — the panel shows history, not an archive. */
const PUBLISHED_CACHE_LIMIT = 100;

type Row = typeof releaseNotes.$inferSelect;

function toWire(row: Row): ReleaseNote {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    body: row.body,
    category: row.category,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    emailedAt: row.emailedAt ? row.emailedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The published list, newest first — what the footer panel renders. Cached under
 * ONE fixed key (bounded keyspace); callers slice with `limit` client-side of the
 * cache so every limit shares the same cached value.
 */
export async function listPublishedReleaseNotes(env: Env, db: Db, limit = 50): Promise<ReleaseNote[]> {
  const all = await getOrSetCached(env, PUBLISHED_CACHE_KEY, async () => {
    const rows = await db
      .select()
      .from(releaseNotes)
      .where(isNotNull(releaseNotes.publishedAt))
      .orderBy(desc(releaseNotes.publishedAt))
      .limit(PUBLISHED_CACHE_LIMIT);
    return rows.map(toWire);
  }, { kvTtlSeconds: 600 });
  return all.slice(0, Math.max(1, Math.min(limit, PUBLISHED_CACHE_LIMIT)));
}

/** Everything, drafts included, newest first — the /admin authoring surface. */
export async function listAllReleaseNotes(db: Db, limit = 200): Promise<ReleaseNote[]> {
  const rows = await db
    .select()
    .from(releaseNotes)
    .orderBy(desc(releaseNotes.createdAt))
    .limit(limit);
  return rows.map(toWire);
}

export interface ReleaseNoteInput {
  version: string;
  title: string;
  body?: string | null;
  category?: ReleaseNoteCategory;
  /** true → published now; false/omitted → draft. */
  publish?: boolean;
}

export async function createReleaseNote(env: Env, db: Db, input: ReleaseNoteInput): Promise<ReleaseNote> {
  const [row] = await db
    .insert(releaseNotes)
    .values({
      version: input.version,
      title: input.title,
      body: input.body ?? null,
      category: input.category ?? 'improvement',
      publishedAt: input.publish ? new Date() : null,
    })
    .returning();
  await invalidateCached(env, PUBLISHED_CACHE_KEY);
  return toWire(row!);
}

export interface ReleaseNotePatch {
  version?: string;
  title?: string;
  body?: string | null;
  category?: ReleaseNoteCategory;
  /** true → publish (keeps an existing publishedAt); false → back to draft. */
  publish?: boolean;
}

export async function updateReleaseNote(env: Env, db: Db, id: string, patch: ReleaseNotePatch): Promise<ReleaseNote | null> {
  const [existing] = await db.select().from(releaseNotes).where(eq(releaseNotes.id, id)).limit(1);
  if (!existing) return null;

  const [row] = await db
    .update(releaseNotes)
    .set({
      ...(patch.version !== undefined ? { version: patch.version } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.publish !== undefined
        ? { publishedAt: patch.publish ? (existing.publishedAt ?? new Date()) : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(releaseNotes.id, id))
    .returning();
  await invalidateCached(env, PUBLISHED_CACHE_KEY);
  return row ? toWire(row) : null;
}

export async function deleteReleaseNote(env: Env, db: Db, id: string): Promise<boolean> {
  const deleted = await db.delete(releaseNotes).where(eq(releaseNotes.id, id)).returning({ id: releaseNotes.id });
  await invalidateCached(env, PUBLISHED_CACHE_KEY);
  return deleted.length > 0;
}

/** Published but never emailed — what the next weekly digest will carry, oldest
 *  first so the email reads chronologically. Direct read (cron path, no cache). */
export async function listUnsentPublishedReleaseNotes(db: Db): Promise<ReleaseNote[]> {
  const rows = await db
    .select()
    .from(releaseNotes)
    .where(and(isNotNull(releaseNotes.publishedAt), isNull(releaseNotes.emailedAt)))
    .orderBy(releaseNotes.publishedAt);
  return rows.map(toWire);
}

/** Stamp the "sent" flag AFTER a digest run has attempted delivery, so a crashed
 *  run re-sends next week (at-least-once) rather than silently dropping notes. */
export async function markReleaseNotesEmailed(env: Env, db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(releaseNotes)
    .set({ emailedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(inArray(releaseNotes.id, ids));
  await invalidateCached(env, PUBLISHED_CACHE_KEY);
}
