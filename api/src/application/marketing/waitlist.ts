/**
 * Who is waiting, and for what (PRD 19 §9).
 *
 * ── ONE FEATURE OVER TWO TABLES, AND WHY THAT IS THE MERGE ──────────────────
 * `waitlist_entries` and `region_waitlist` are the same concept keyed differently:
 * identical status vocabulary (`waiting | invited | joined | declined`), identical
 * `invited_at` / `joined_at` shape. One is keyed by an arbitrary `list_key`, the
 * other by country and region.
 *
 * The merge rule says consolidate into ONE combined feature and keep the more
 * mature side. `waitlist_entries` is the more general and the more mature — it
 * carries a name, a referrer and a queue position. `region_waitlist` adds the one
 * thing it lacks: a geographic key, and the reason a person is waiting is that we
 * do not operate where they are.
 *
 * Both tables stay, because `newTablesAllowed: false` also means no table
 * DELETIONS in this pass and because their keys are genuinely different shapes.
 * What is unified is the FEATURE: one status machine, one invite path, one
 * conversion funnel, and {@link waitlistOverview} answers "who is waiting" across
 * both. Two waitlist features would mean inviting somebody twice.
 *
 * ── THE STATUS MACHINE IS THE WHOLE VALUE ───────────────────────────────────
 * `invited` is not a flag, it is a transition with a timestamp, and `joined` is
 * another. A waitlist that only records "waiting" cannot answer the two questions
 * anybody actually asks — how many invitations converted, and how long people
 * waited — so {@link conversionFunnel} exists and both timestamps are stamped by
 * the transition rather than supplied by the caller.
 *
 * ── POSITION IS ASSIGNED, NOT COMPUTED ──────────────────────────────────────
 * A queue position computed as "count of earlier rows" changes when somebody
 * ahead of you is removed, which means the number you were shown was never real.
 * {@link joinList} assigns the next position at insert and it never moves.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { regionWaitlist, waitlistEntries } from '../../infrastructure/database/schema';
import { scopedToNullableTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';

/** Shared by both tables — which is what makes one status machine possible. */
export const WAITLIST_STATUSES = ['waiting', 'invited', 'joined', 'declined'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const isWaitlistStatus = (v: unknown): v is WaitlistStatus =>
  typeof v === 'string' && (WAITLIST_STATUSES as readonly string[]).includes(v);

export class WaitlistError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'WaitlistError';
  }
}

const requireEmail = (v: string): string => {
  const s = v.trim().toLowerCase();
  // Deliberately permissive — a waitlist that rejects a valid unusual address
  // loses a customer, and the address is verified by the invitation anyway.
  if (!s || s.length > 320 || !s.includes('@')) throw new WaitlistError('a valid email is required');
  return s;
};

// ── Joining ─────────────────────────────────────────────────────────────────

/**
 * Join a named list. Idempotent on (list_key, email) — the unique index — so a
 * double-submitted form does not create a second place in the queue.
 *
 * The assigned position is the count at insert time and never moves afterwards;
 * see the module docstring.
 */
export async function joinList(
  db: Db,
  tenantId: number | null,
  input: { listKey: string; email: string; name?: string | null; referrer?: string | null },
) {
  const listKey = input.listKey.trim().toLowerCase();
  if (!listKey) throw new WaitlistError('listKey is required');
  const email = requireEmail(input.email);

  const [tail] = await db
    .select({ next: sql<number>`coalesce(max(${waitlistEntries.position}) + 1, 1)` })
    .from(waitlistEntries)
    .where(scopedToNullableTenant(waitlistEntries, tenantId, eq(waitlistEntries.listKey, listKey)));

  await db
    .insert(waitlistEntries)
    .values({
      tenantId,
      listKey: listKey.slice(0, 96),
      email,
      name: input.name ?? null,
      referrer: input.referrer ?? null,
      position: tail?.next ?? 1,
      status: 'waiting',
    })
    .onConflictDoNothing({ target: [waitlistEntries.listKey, waitlistEntries.email] });

  const [row] = await db
    .select()
    .from(waitlistEntries)
    .where(scopedToNullableTenant(waitlistEntries, tenantId, and(
      eq(waitlistEntries.listKey, listKey),
      eq(waitlistEntries.email, email),
    )))
    .limit(1);
  if (!row) throw new WaitlistError('could not join the list');
  return row;
}

/** Join the region waitlist — "we do not operate where you are, yet". */
export async function joinRegion(
  db: Db,
  tenantId: number | null,
  input: { email: string; country?: string | null; region?: string | null; source?: string | null },
) {
  const email = requireEmail(input.email);
  const [row] = await db
    .insert(regionWaitlist)
    .values({
      tenantId,
      email,
      country: input.country ? input.country.trim().toUpperCase().slice(0, 2) : null,
      region: input.region ?? null,
      source: input.source ?? null,
      status: 'waiting',
    })
    .returning();
  if (!row) throw new WaitlistError('could not join the region waitlist');
  return row;
}

// ── The one status machine ──────────────────────────────────────────────────

/**
 * Invite people from a list. Stamps `invited_at` in the same write.
 *
 * Only rows currently `waiting` are affected, which makes a repeated invite run
 * safe: somebody already invited is not re-invited, and somebody who declined is
 * not dragged back. That predicate is the whole idempotence guarantee — without
 * it a retried batch mails the same people twice.
 */
export async function inviteFromList(
  db: Db,
  env: Env,
  tenantId: number | null,
  actor: ActorIdentity,
  listKey: string,
  emails: string[],
) {
  if (emails.length === 0) return { invited: 0, emails: [] as string[] };
  const normalised = emails.map(requireEmail);

  const rows = await db
    .update(waitlistEntries)
    .set({ status: 'invited', invitedAt: new Date(), updatedAt: new Date() })
    .where(scopedToNullableTenant(waitlistEntries, tenantId, and(
      eq(waitlistEntries.listKey, listKey.trim().toLowerCase()),
      inArray(waitlistEntries.email, normalised),
      eq(waitlistEntries.status, 'waiting'),
    )))
    .returning({ email: waitlistEntries.email });

  if (tenantId !== null && rows.length > 0) {
    await recordActivity(env, db, {
      tenantId, actor, verb: 'waitlist.invited',
      targetType: 'waitlist', targetId: listKey,
      metadata: { invited: rows.length },
    });
  }
  return { invited: rows.length, emails: rows.map((r) => r.email) };
}

/**
 * Invite everyone waiting in a region — the write that happens the day a region
 * opens. Same `waiting`-only predicate, for the same reason.
 */
export async function inviteRegion(
  db: Db,
  env: Env,
  tenantId: number | null,
  actor: ActorIdentity,
  country: string,
) {
  const rows = await db
    .update(regionWaitlist)
    .set({ status: 'invited', invitedAt: new Date(), updatedAt: new Date() })
    .where(scopedToNullableTenant(regionWaitlist, tenantId, and(
      eq(regionWaitlist.country, country.trim().toUpperCase().slice(0, 2)),
      eq(regionWaitlist.status, 'waiting'),
    )))
    .returning({ email: regionWaitlist.email });

  if (tenantId !== null && rows.length > 0) {
    await recordActivity(env, db, {
      tenantId, actor, verb: 'waitlist.region_opened',
      targetType: 'region', targetId: country,
      metadata: { invited: rows.length },
    });
  }
  return { invited: rows.length, emails: rows.map((r) => r.email) };
}

/**
 * Close the loop for one person, across BOTH lists.
 *
 * One call, because somebody who signs up may be on a named list AND a region
 * list, and marking only one leaves them permanently "waiting" for something they
 * already have — which is precisely the double-invite two separate features
 * would produce.
 */
export async function markOutcome(
  db: Db,
  tenantId: number | null,
  email: string,
  outcome: 'joined' | 'declined',
) {
  if (outcome !== 'joined' && outcome !== 'declined') {
    throw new WaitlistError("outcome must be 'joined' or 'declined'");
  }
  const address = requireEmail(email);
  const stamp = outcome === 'joined' ? { joinedAt: new Date() } : {};

  const [lists, regions] = await Promise.all([
    db.update(waitlistEntries)
      .set({ status: outcome, ...stamp, updatedAt: new Date() })
      .where(scopedToNullableTenant(waitlistEntries, tenantId, and(
        eq(waitlistEntries.email, address),
        inArray(waitlistEntries.status, ['waiting', 'invited']),
      )))
      .returning({ id: waitlistEntries.id }),
    db.update(regionWaitlist)
      .set({ status: outcome, ...stamp, updatedAt: new Date() })
      .where(scopedToNullableTenant(regionWaitlist, tenantId, and(
        eq(regionWaitlist.email, address),
        inArray(regionWaitlist.status, ['waiting', 'invited']),
      )))
      .returning({ id: regionWaitlist.id }),
  ]);

  return { email: address, outcome, listRows: lists.length, regionRows: regions.length };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** One list, in queue order. */
export async function listEntries(db: Db, tenantId: number | null, listKey: string, status?: WaitlistStatus) {
  if (status !== undefined && !isWaitlistStatus(status)) {
    throw new WaitlistError(`status must be one of: ${WAITLIST_STATUSES.join(', ')}`);
  }
  return db
    .select()
    .from(waitlistEntries)
    .where(scopedToNullableTenant(waitlistEntries, tenantId, and(
      eq(waitlistEntries.listKey, listKey.trim().toLowerCase()),
      ...(status ? [eq(waitlistEntries.status, status)] : []),
    )))
    .orderBy(asc(waitlistEntries.position));
}

/**
 * Who is waiting, across both tables — the unified answer that is the point of
 * merging these into one feature.
 */
export async function waitlistOverview(db: Db, tenantId: number | null) {
  const [lists, regions] = await Promise.all([
    db.select({
      key: waitlistEntries.listKey,
      status: waitlistEntries.status,
      people: sql<number>`count(*)::int`,
    })
      .from(waitlistEntries)
      .where(scopedToNullableTenant(waitlistEntries, tenantId))
      .groupBy(waitlistEntries.listKey, waitlistEntries.status),
    db.select({
      key: regionWaitlist.country,
      status: regionWaitlist.status,
      people: sql<number>`count(*)::int`,
    })
      .from(regionWaitlist)
      .where(scopedToNullableTenant(regionWaitlist, tenantId))
      .groupBy(regionWaitlist.country, regionWaitlist.status),
  ]);

  return {
    lists: lists.map((l) => ({ ...l, kind: 'list' as const })),
    regions: regions.map((r) => ({ ...r, kind: 'region' as const })),
  };
}

/**
 * Did the invitations convert, and how long did people wait?
 *
 * `medianWaitDays` is measured from `created_at` to `joined_at` over people who
 * actually joined — the only population for whom the wait has ended. Including
 * people still waiting would make the number fall every time somebody new signs
 * up, which is the opposite of what it should do.
 */
export async function conversionFunnel(db: Db, tenantId: number | null, listKey?: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      waiting: sql<number>`count(*) filter (where ${waitlistEntries.status} = 'waiting')::int`,
      invited: sql<number>`count(*) filter (where ${waitlistEntries.status} = 'invited')::int`,
      joined: sql<number>`count(*) filter (where ${waitlistEntries.status} = 'joined')::int`,
      declined: sql<number>`count(*) filter (where ${waitlistEntries.status} = 'declined')::int`,
      inviteConversion: sql<number | null>`(
        count(*) filter (where ${waitlistEntries.status} = 'joined')::float8
        / nullif(count(*) filter (where ${waitlistEntries.status} in ('invited','joined','declined')), 0)
      )`,
      medianWaitDays: sql<number | null>`percentile_cont(0.5) within group (
        order by extract(epoch from (${waitlistEntries.joinedAt} - ${waitlistEntries.createdAt})) / 86400
      ) filter (where ${waitlistEntries.joinedAt} is not null)`,
    })
    .from(waitlistEntries)
    .where(scopedToNullableTenant(
      waitlistEntries,
      tenantId,
      listKey ? eq(waitlistEntries.listKey, listKey.trim().toLowerCase()) : undefined,
    ));

  return row ?? { total: 0, waiting: 0, invited: 0, joined: 0, declined: 0, inviteConversion: null, medianWaitDays: null };
}

/** Where demand is, so an operator can decide which region to open next. */
export async function regionDemand(db: Db, tenantId: number | null) {
  return db
    .select({
      country: regionWaitlist.country,
      waiting: sql<number>`count(*) filter (where ${regionWaitlist.status} = 'waiting')::int`,
      invited: sql<number>`count(*) filter (where ${regionWaitlist.status} = 'invited')::int`,
      joined: sql<number>`count(*) filter (where ${regionWaitlist.status} = 'joined')::int`,
    })
    .from(regionWaitlist)
    .where(scopedToNullableTenant(regionWaitlist, tenantId))
    .groupBy(regionWaitlist.country)
    .orderBy(desc(sql`count(*) filter (where ${regionWaitlist.status} = 'waiting')`));
}
