/**
 * Inviting ONE named freelancer to ONE posting.
 *
 * ── WHY AN INVITE IS A ROW AND NOT A NOTIFICATION ───────────────────────────────
 * The cheap version of this feature is `notify(db, env, { kind: 'invited', … })` and
 * nothing else. It is cheap because it is not the feature: a notification is a message
 * that has been read or not, while an invite has a counterparty, an expiry, an outcome
 * and — the part that actually matters — a NEXT STEP. An invitee who accepts must land
 * inside the bid flow, on the posting, with their proposal already opened; anything less
 * is a message saying "somebody would like you to go and find something".
 *
 * So the row is the invite and the notification announces it. {@link respondToInvite}
 * opens the invitee's `job_proposals` row in the `saved` state — the same pre-bid state
 * `POST /api/jobs/:id/save` uses, so an accepted invite and a self-shortlisted job are
 * ONE lifecycle rather than two that can disagree — and records the proposal id on the
 * invite, which is the durable link between "we asked" and "they bid".
 *
 * ── AN INVITE IS ALSO A GRANT ───────────────────────────────────────────────────
 * `POST /api/jobs/:id/proposals` refuses a `visibility='private'` posting to anybody
 * without an active engagement in that workspace. Inviting a stranger to a private
 * posting and then refusing their bid would be the product contradicting itself, so a
 * LIVE invite (sent or viewed or accepted, and not past its expiry) is the other way
 * through that gate — see {@link hasLiveInvite}. That is why the expiry is real rather
 * than decorative: an access grant with no end is a decision nobody revisits.
 *
 * ── EXPIRY IS EVALUATED ON READ ─────────────────────────────────────────────────
 * There is no invite-expiry sweep and there should not be one: the state is a pure
 * function of `expires_at` and the clock, and a cron that rewrites rows to say what the
 * clock already says is a second source of truth that can lag. Reads project the
 * effective status; a response past the deadline is refused with the same predicate.
 */
import { desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { jobInvites, jobPostings, jobProposals, tenants, users } from '../../infrastructure/database/schema';
import { notify } from '../notifications/notify';

/** The lifecycle. `expired` is never WRITTEN by a request — it is what the clock says. */
export const INVITE_STATUSES = ['sent', 'viewed', 'accepted', 'declined', 'expired'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/** Statuses that still admit a response — and that still grant access to a private posting. */
export const LIVE_INVITE_STATUSES = ['sent', 'viewed'] as const;

/** How long an invite stands when the client does not say. Two weeks: long enough that a
 *  freelancer on holiday does not lose it, short enough that a stale grant lapses. */
export const DEFAULT_INVITE_TTL_DAYS = 14;
export const MAX_INVITE_TTL_DAYS = 90;

export interface JobInvite {
  id: string;
  jobId: string;
  jobTitle: string | null;
  tenantId: number;
  tenantName: string | null;
  freelancerUserId: string;
  freelancerName: string | null;
  message: string | null;
  /** The EFFECTIVE status: `expired` whenever the deadline has passed, whatever the
   *  column says. One projection, so no surface can show a live invite that the response
   *  path would refuse. */
  status: InviteStatus;
  expiresAt: Date | string | null;
  respondedAt: Date | string | null;
  /** The proposal an acceptance opened — the reason this is not a dead notification. */
  proposalId: string | null;
  createdAt: Date | string | null;
}

const isExpired = (status: string, expiresAt: Date | string | null): boolean => {
  if (status === 'accepted' || status === 'declined') return false;
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
};

interface InviteRow {
  id: string;
  jobId: string;
  tenantId: number;
  freelancerUserId: string;
  message: string | null;
  status: string;
  expiresAt: Date | null;
  respondedAt: Date | null;
  proposalId: string | null;
  createdAt: Date | null;
  jobTitle?: string | null;
  tenantName?: string | null;
  freelancerName?: string | null;
}

const mapInvite = (r: InviteRow): JobInvite => ({
  id: r.id,
  jobId: r.jobId,
  jobTitle: r.jobTitle ?? null,
  tenantId: Number(r.tenantId),
  tenantName: r.tenantName ?? null,
  freelancerUserId: r.freelancerUserId,
  freelancerName: r.freelancerName ?? null,
  message: r.message ?? null,
  status: (isExpired(r.status, r.expiresAt) ? 'expired' : r.status) as InviteStatus,
  expiresAt: r.expiresAt ?? null,
  respondedAt: r.respondedAt ?? null,
  proposalId: r.proposalId ?? null,
  createdAt: r.createdAt ?? null,
});

/** `expires_at` for a requested TTL, clamped. Null TTL → the default window. */
export function inviteDeadline(days?: unknown): Date {
  const requested = Number(days);
  const ttl = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.round(requested), MAX_INVITE_TTL_DAYS)
    : DEFAULT_INVITE_TTL_DAYS;
  return new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
}

export type InviteFailure = 'job_not_found' | 'job_not_open' | 'person_not_found' | 'self_invite';

export interface CreateInviteInput {
  tenantId: number;
  jobId: string;
  freelancerUserId: string;
  invitedByUserId: string;
  message?: unknown;
  expiresInDays?: unknown;
}

/**
 * Invite somebody, or refresh the invite they already have.
 *
 * Idempotent on `(job, person)`: re-inviting updates the standing invite rather than
 * stacking a second one the invitee would have to answer twice. A refresh REOPENS a
 * lapsed invite (back to `sent`, with a new deadline) but never overwrites an invite
 * they already answered — declining is an answer, and re-asking must not erase it.
 */
export async function createInvite(
  db: Db,
  env: Env,
  input: CreateInviteInput,
): Promise<{ invite: JobInvite } | { error: InviteFailure }> {
  if (input.freelancerUserId === input.invitedByUserId) return { error: 'self_invite' };
  const [job] = await db
    .select({ id: jobPostings.id, title: jobPostings.title, status: jobPostings.status })
    .from(jobPostings)
    .where(scopedToTenant(jobPostings, input.tenantId, eq(jobPostings.id, input.jobId)))
    .limit(1);
  if (!job) return { error: 'job_not_found' };
  // Inviting somebody to a filled posting would be asking for a bid that cannot be
  // accepted — refused here rather than left to fail at the bid.
  if (job.status !== 'open') return { error: 'job_not_open' };

  const [person] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.freelancerUserId))
    .limit(1);
  if (!person) return { error: 'person_not_found' };

  const message = typeof input.message === 'string' ? input.message.slice(0, 2000) : null;
  const expiresAt = inviteDeadline(input.expiresInDays);
  const [row] = await db.insert(jobInvites)
    .values({
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      jobId: input.jobId,
      freelancerUserId: input.freelancerUserId,
      invitedByUserId: input.invitedByUserId,
      message,
      status: 'sent',
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [jobInvites.jobId, jobInvites.freelancerUserId],
      set: {
        message: sql`COALESCE(excluded.message, ${jobInvites.message})`,
        expiresAt: sql`excluded.expires_at`,
        // Only a lapsed or unanswered invite goes back to `sent`. An `accepted` or
        // `declined` one keeps its answer: re-asking somebody who said no must not
        // silently rewrite the record to say they never did.
        status: sql`CASE WHEN ${jobInvites.status} IN ('accepted','declined') THEN ${jobInvites.status} ELSE 'sent' END`,
        invitedByUserId: sql`excluded.invited_by_user_id`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();
  if (!row) return { error: 'job_not_found' };

  const [ten] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, input.tenantId));
  await notify(db, env, {
    userId: input.freelancerUserId,
    tenantId: input.tenantId,
    kind: 'job_invite',
    title: `${ten?.name ?? 'A workspace'} invited you to bid on "${job.title}"`,
    body: message,
    // The JOB is the ref, not the invite: every notification in this feed routes to a
    // marketplace surface, and the surface that answers an invite is the posting.
    ref: input.jobId,
  });
  return { invite: mapInvite({ ...row, jobTitle: job.title, freelancerName: person.displayName }) };
}

/** The invites on one of this tenant's postings — the employer's side. */
export async function readInvitesForJob(db: Db, tenantId: number, jobId: string): Promise<JobInvite[]> {
  const rows = await db
    .select({
      id: jobInvites.id,
      jobId: jobInvites.jobId,
      tenantId: jobInvites.tenantId,
      freelancerUserId: jobInvites.freelancerUserId,
      message: jobInvites.message,
      status: jobInvites.status,
      expiresAt: jobInvites.expiresAt,
      respondedAt: jobInvites.respondedAt,
      proposalId: jobInvites.proposalId,
      createdAt: jobInvites.createdAt,
      jobTitle: jobPostings.title,
      freelancerName: users.displayName,
    })
    .from(jobInvites)
    .innerJoin(jobPostings, eq(jobPostings.id, jobInvites.jobId))
    .innerJoin(users, eq(users.id, jobInvites.freelancerUserId))
    .where(scopedToTenant(jobInvites, tenantId, eq(jobInvites.jobId, jobId)))
    .orderBy(desc(jobInvites.createdAt))
    .limit(200);
  return rows.map(mapInvite);
}

/**
 * The invites addressed to ONE person — the invitee's side of the marketplace.
 *
 * Cross-tenant by construction: a for-hire account belongs to no workspace, so "who has
 * invited me" spans every tenant that has. Declared with `subject_own_rows`, whose
 * predicate — `freelancer_user_id = <the verified caller>` — is strictly stronger than a
 * tenant filter, and is compared against the web JWT's identity and never a parameter.
 */
export async function readInvitesForUser(db: Db, userId: string, opts?: { liveOnly?: boolean }): Promise<JobInvite[]> {
  const rows = await db
    .select({
      id: jobInvites.id,
      jobId: jobInvites.jobId,
      tenantId: jobInvites.tenantId,
      freelancerUserId: jobInvites.freelancerUserId,
      message: jobInvites.message,
      status: jobInvites.status,
      expiresAt: jobInvites.expiresAt,
      respondedAt: jobInvites.respondedAt,
      proposalId: jobInvites.proposalId,
      createdAt: jobInvites.createdAt,
      jobTitle: jobPostings.title,
      tenantName: tenants.name,
    })
    .from(jobInvites)
    .innerJoin(jobPostings, eq(jobPostings.id, jobInvites.jobId))
    .innerJoin(tenants, eq(tenants.id, jobInvites.tenantId))
    .where(acrossTenants(jobInvites, 'subject_own_rows',
      eq(jobInvites.freelancerUserId, userId),
      opts?.liveOnly ? inArray(jobInvites.status, [...LIVE_INVITE_STATUSES]) : undefined,
      opts?.liveOnly ? or(isNull(jobInvites.expiresAt), gt(jobInvites.expiresAt, new Date())) : undefined))
    .orderBy(desc(jobInvites.createdAt))
    .limit(200);
  return rows.map(mapInvite);
}

/**
 * Does this person hold a LIVE invite to this posting?
 *
 * The private-posting grant. Kept as a boolean point lookup rather than folded into the
 * bid handler's query, because it answers an access question and the bid handler already
 * answers three others.
 */
export async function hasLiveInvite(db: Db, jobId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: jobInvites.id })
    .from(jobInvites)
    .where(acrossTenants(jobInvites, 'subject_own_rows',
      eq(jobInvites.freelancerUserId, userId),
      eq(jobInvites.jobId, jobId),
      // `accepted` counts: somebody who accepted an invite and is now writing the bid
      // must not lose access between the two clicks.
      inArray(jobInvites.status, ['sent', 'viewed', 'accepted']),
      or(isNull(jobInvites.expiresAt), gt(jobInvites.expiresAt, new Date()))))
    .limit(1);
  return Boolean(row);
}

/** Stamp an invite as seen. Never moves an answered or lapsed one. */
export async function markInviteViewed(db: Db, userId: string, inviteId: string): Promise<void> {
  await db.update(jobInvites)
    .set({ status: 'viewed', viewedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(acrossTenants(jobInvites, 'subject_own_rows',
      eq(jobInvites.id, inviteId),
      eq(jobInvites.freelancerUserId, userId),
      eq(jobInvites.status, 'sent')));
}

export type InviteResponseFailure = 'not_found' | 'expired' | 'already_answered' | 'job_closed';

export interface InviteResponse {
  invite: JobInvite;
  /** The proposal the acceptance opened, in the `saved` (pre-bid) state. Null on a
   *  decline. The caller hands this to the client so the bid form opens on it. */
  proposalId: string | null;
}

/**
 * Accept or decline. Accepting SHORT-CIRCUITS INTO THE PROPOSAL FLOW.
 *
 * The whole point of the row. On accept:
 *   1. the invitee's `job_proposals` row for this posting is opened in the `saved`
 *      state — an upsert, so somebody who had already bookmarked or bid on the posting
 *      keeps the row (and the bid) they already have;
 *   2. its id is stamped onto the invite, so "we invited them and they bid" is one
 *      readable chain rather than two events a human has to correlate;
 *   3. the inviting workspace is notified, because an invite nobody answers back to is
 *      the same dead end from the other direction.
 *
 * Written as ONE transaction: an invite marked accepted with no proposal behind it is
 * precisely the dead notification this feature exists to stop being.
 */
export async function respondToInvite(
  db: Db,
  env: Env,
  input: { userId: string; inviteId: string; accept: boolean },
): Promise<InviteResponse | { error: InviteResponseFailure }> {
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: jobInvites.id,
        jobId: jobInvites.jobId,
        tenantId: jobInvites.tenantId,
        freelancerUserId: jobInvites.freelancerUserId,
        message: jobInvites.message,
        status: jobInvites.status,
        expiresAt: jobInvites.expiresAt,
        respondedAt: jobInvites.respondedAt,
        proposalId: jobInvites.proposalId,
        createdAt: jobInvites.createdAt,
        invitedByUserId: jobInvites.invitedByUserId,
        jobTitle: jobPostings.title,
        jobStatus: jobPostings.status,
      })
      .from(jobInvites)
      .innerJoin(jobPostings, eq(jobPostings.id, jobInvites.jobId))
      .where(acrossTenants(jobInvites, 'subject_own_rows',
        eq(jobInvites.id, input.inviteId),
        eq(jobInvites.freelancerUserId, input.userId)))
      .limit(1);
    if (!row) return { error: 'not_found' as const };
    if (row.status === 'accepted' || row.status === 'declined') return { error: 'already_answered' as const };
    if (isExpired(row.status, row.expiresAt)) return { error: 'expired' as const };
    if (input.accept && row.jobStatus !== 'open') return { error: 'job_closed' as const };

    let proposalId: string | null = null;
    if (input.accept) {
      const [bid] = await tx.insert(jobProposals)
        .values({
          id: crypto.randomUUID(),
          jobId: row.jobId,
          freelancerUserId: input.userId,
          status: 'saved',
        })
        .onConflictDoUpdate({
          target: [jobProposals.jobId, jobProposals.freelancerUserId],
          // Never downgrades a real bid back to `saved` — accepting an invite for a
          // posting you already bid on is a no-op on the bid, not a withdrawal.
          set: { updatedAt: sql`NOW()` },
        })
        .returning({ id: jobProposals.id });
      proposalId = bid?.id ?? null;
    }

    const [updated] = await tx.update(jobInvites)
      .set({
        status: input.accept ? 'accepted' : 'declined',
        respondedAt: new Date(),
        proposalId,
        updatedAt: new Date(),
      })
      .where(scopedToTenant(jobInvites, Number(row.tenantId), eq(jobInvites.id, row.id)))
      .returning();
    if (!updated) return { error: 'not_found' as const };
    return { row, updated, proposalId };
  });
  if ('error' in outcome && outcome.error) return { error: outcome.error };

  const [me] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.userId));
  if (outcome.row.invitedByUserId) {
    await notify(db, env, {
      userId: outcome.row.invitedByUserId,
      tenantId: Number(outcome.row.tenantId),
      kind: input.accept ? 'invite_accepted' : 'invite_declined',
      title: input.accept
        ? `${me?.displayName ?? 'A freelancer'} accepted your invite to "${outcome.row.jobTitle}"`
        : `${me?.displayName ?? 'A freelancer'} declined your invite to "${outcome.row.jobTitle}"`,
      ref: outcome.row.jobId,
    });
  }
  return {
    invite: mapInvite({ ...outcome.updated, jobTitle: outcome.row.jobTitle }),
    proposalId: outcome.proposalId,
  };
}

/** Withdraw an invite the client no longer wants standing. Only an UNANSWERED one:
 *  deleting an answer is rewriting history, so an answered invite is left alone. */
export async function withdrawInvite(db: Db, tenantId: number, inviteId: string): Promise<boolean> {
  const rows = await db.delete(jobInvites)
    .where(scopedToTenant(jobInvites, tenantId,
      eq(jobInvites.id, inviteId),
      inArray(jobInvites.status, [...LIVE_INVITE_STATUSES])))
    .returning({ id: jobInvites.id });
  return rows.length > 0;
}

/** How many live invites are outstanding on a posting — the employer's list badge. */
export async function countLiveInvites(db: Db, tenantId: number, jobId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(jobInvites)
    .where(scopedToTenant(jobInvites, tenantId,
      eq(jobInvites.jobId, jobId),
      inArray(jobInvites.status, [...LIVE_INVITE_STATUSES]),
      or(isNull(jobInvites.expiresAt), gt(jobInvites.expiresAt, new Date()))));
  return Number(rows[0]?.value ?? 0);
}
