/**
 * The CLIENT's shortlist — the supply-side mirror of a seeker's saved jobs.
 *
 * ── WHY IT IS A JOIN AND NOT A "LIST" AGGREGATE ─────────────────────────────────
 * The tempting shape is `talent_lists` + `talent_list_members`. It buys nothing here:
 * nothing ever loads a list without its members, no list has a property of its own
 * beyond its name, and a two-table version would let an empty list exist — a row that
 * means "somebody typed a name once". So a list is a VALUE on the join (`list_name`),
 * which is the register's rule that a new KIND is a column value rather than a new
 * table, and an empty list is simply the absence of rows.
 *
 * ── WHY THE OWNER IS ON THE ROW AS WELL AS THE TENANT ───────────────────────────
 * A shortlist is a PERSON's working set. Two hiring managers in one workspace keep
 * separate ones, and quietly merging them would be indistinguishable from a leak between
 * them. So reads are scoped `(tenantId, ownerUserId)` and the tenant alone is never
 * enough.
 *
 * The read is deliberately UNCACHED: it is a small point lookup keyed on one person,
 * and a shortlist that does not show the person you added a second ago is a shortlist
 * that looks broken.
 */
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { freelancerProfiles, savedTalent, users } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseJsonArray } from '../../domain/shared/json';

/** The default list, so "save this person" needs no name. */
export const DEFAULT_TALENT_LIST = 'shortlist';

/** How many people one workspace-owner pair may shortlist. Bounded because the read is
 *  unpaginated by design — a shortlist you have to page through is a search. */
export const SAVED_TALENT_LIMIT = 500;

export interface SavedTalentEntry {
  id: string;
  freelancerUserId: string;
  listName: string;
  note: string | null;
  createdAt: Date | string | null;
  /** The person, joined so the shortlist renders without a second round trip per row. */
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  discipline: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  currency: string;
  availability: string | null;
  rating: number | null;
  ratingCount: number;
}

const listName = (raw: unknown): string => {
  const name = String(raw ?? '').trim().slice(0, 80);
  return name || DEFAULT_TALENT_LIST;
};

/**
 * The freelancer's received rating, as raw SQL for the same reason `jobRoutes` writes
 * the client rating that way: `freelancer_reviews.direction` exists in the DB (0299) but
 * is not modelled on the Drizzle table, so the predicate cannot be expressed in the
 * builder. `saved_talent.freelancer_user_id` is spelled out rather than interpolated —
 * this statement has joins, and a bare column would bind to the subquery's own scope.
 */
const ratingSql = sql<string | null>`(SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.freelancer_user_id = saved_talent.freelancer_user_id AND r.direction = 'employer_to_freelancer')`;
const ratingCountSql = sql<number>`(SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = saved_talent.freelancer_user_id AND r.direction = 'employer_to_freelancer')::int`;

/** One workspace-owner's shortlist, optionally narrowed to a single named list. */
export async function readSavedTalent(
  db: Db,
  input: { tenantId: number; ownerUserId: string; list?: string | null },
): Promise<SavedTalentEntry[]> {
  const rows = await db
    .select({
      id: savedTalent.id,
      freelancerUserId: savedTalent.freelancerUserId,
      listName: savedTalent.listName,
      note: savedTalent.note,
      createdAt: savedTalent.createdAt,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      headline: freelancerProfiles.headline,
      discipline: freelancerProfiles.discipline,
      skills: freelancerProfiles.skills,
      hourlyRateCents: freelancerProfiles.hourlyRateCents,
      currency: freelancerProfiles.currency,
      availability: freelancerProfiles.availability,
      rating: ratingSql,
      ratingCount: ratingCountSql,
    })
    .from(savedTalent)
    .innerJoin(users, eq(users.id, savedTalent.freelancerUserId))
    // LEFT, not INNER: somebody can be shortlisted before they publish a for-hire
    // profile, and dropping them from the client's own list the day they unpublish
    // would look like the platform lost them.
    .leftJoin(freelancerProfiles, eq(freelancerProfiles.userId, savedTalent.freelancerUserId))
    .where(scopedToTenant(savedTalent, input.tenantId,
      eq(savedTalent.ownerUserId, input.ownerUserId),
      input.list ? eq(savedTalent.listName, listName(input.list)) : undefined))
    .orderBy(desc(savedTalent.createdAt))
    .limit(SAVED_TALENT_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    freelancerUserId: r.freelancerUserId,
    listName: r.listName,
    note: r.note ?? null,
    createdAt: r.createdAt ?? null,
    displayName: r.displayName ?? null,
    avatarUrl: r.avatarUrl ?? null,
    headline: r.headline ?? null,
    discipline: r.discipline ?? null,
    skills: parseJsonArray<string>(r.skills),
    hourlyRateCents: r.hourlyRateCents == null ? null : Number(r.hourlyRateCents),
    currency: r.currency ?? 'USD',
    availability: r.availability ?? null,
    rating: r.rating == null ? null : Number(r.rating),
    ratingCount: Number(r.ratingCount ?? 0),
  }));
}

/** The distinct list names this owner has used, so a picker can offer them. */
export async function readTalentLists(db: Db, input: { tenantId: number; ownerUserId: string }): Promise<Array<{ name: string; count: number }>> {
  const rows = await db
    .select({ name: savedTalent.listName, count: sql<number>`count(*)::int` })
    .from(savedTalent)
    .where(scopedToTenant(savedTalent, input.tenantId, eq(savedTalent.ownerUserId, input.ownerUserId)))
    .groupBy(savedTalent.listName)
    .orderBy(savedTalent.listName);
  return rows.map((r) => ({ name: r.name, count: Number(r.count ?? 0) }));
}

/**
 * Shortlist somebody. Idempotent on `(tenant, owner, freelancer, list)`: saving the same
 * person twice edits the note rather than stacking a duplicate.
 *
 * The freelancer must be a real user; the caller has already established that the actor
 * belongs to the tenant.
 */
export async function saveTalent(
  db: Db,
  input: { tenantId: number; ownerUserId: string; freelancerUserId: string; list?: string | null; note?: string | null },
): Promise<{ id: string } | null> {
  const [person] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.freelancerUserId)).limit(1);
  if (!person) return null;
  const note = typeof input.note === 'string' ? input.note.slice(0, 2000) : null;
  const [row] = await db.insert(savedTalent)
    .values({
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      freelancerUserId: input.freelancerUserId,
      listName: listName(input.list),
      note,
    })
    .onConflictDoUpdate({
      target: [savedTalent.tenantId, savedTalent.ownerUserId, savedTalent.freelancerUserId, savedTalent.listName],
      // A save with no note must not WIPE the note that is already there — the second
      // save is usually a click, not an edit.
      set: { note: sql`COALESCE(excluded.note, ${savedTalent.note})`, updatedAt: sql`NOW()` },
    })
    .returning({ id: savedTalent.id });
  return row ?? null;
}

/** Un-shortlist. Removes from ONE list, or from every list when none is named. */
export async function unsaveTalent(
  db: Db,
  input: { tenantId: number; ownerUserId: string; freelancerUserId: string; list?: string | null },
): Promise<void> {
  await db.delete(savedTalent).where(scopedToTenant(savedTalent, input.tenantId,
    eq(savedTalent.ownerUserId, input.ownerUserId),
    eq(savedTalent.freelancerUserId, input.freelancerUserId),
    input.list ? eq(savedTalent.listName, listName(input.list)) : undefined));
}

/**
 * Which of `freelancerUserIds` this owner has already shortlisted.
 *
 * One query for the whole page rather than one per card — the talent grid and the
 * recommendation feed both need the toggle state for twenty people at once, and asking
 * per row is the N+1 the performance rule forbids.
 */
export async function readSavedTalentIds(
  db: Db,
  input: { tenantId: number; ownerUserId: string; freelancerUserIds: string[] },
): Promise<Set<string>> {
  if (input.freelancerUserIds.length === 0) return new Set();
  const rows = await db
    .select({ freelancerUserId: savedTalent.freelancerUserId })
    .from(savedTalent)
    .where(scopedToTenant(savedTalent, input.tenantId,
      eq(savedTalent.ownerUserId, input.ownerUserId),
      inArray(savedTalent.freelancerUserId, input.freelancerUserIds)));
  return new Set(rows.map((r) => r.freelancerUserId));
}
