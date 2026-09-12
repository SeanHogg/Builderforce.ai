/**
 * Freelancer side of a proposal — my bids, my work-sample attachments, withdrawal,
 * and the reads and write a bid is made of.
 *
 * Every read here is scoped to the bidder's OWN proposal (`freelancer_user_id`), so
 * nothing on this surface can read or write somebody else's bid. The bid's
 * orchestration (who may bid, screening, the schedule, candidate intake) stays with
 * its route; these are the statements it runs.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import {
  freelancerEngagements,
  jobPostings,
  jobProposals,
  users,
} from '../../../infrastructure/database/schema';
import { excluded } from '../../../infrastructure/database/upsert';
import { normalizeAttachments, type PostingAttachment, type ScreeningAnswerResult } from '../jobPostings';
import { mapProposal, proposalColumns } from './jobRows';

/** Every proposal this freelancer has made, newest first. */
export async function listMyProposals(db: Db, userId: string) {
  const rows = await db
    .select({ ...proposalColumns, job_title: jobPostings.title })
    .from(jobProposals)
    .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
    .where(eq(jobProposals.freelancerUserId, userId))
    .orderBy(desc(jobProposals.createdAt))
    .limit(200);
  return rows.map(mapProposal);
}

/** The bidder's own proposal's attachments (normalised), or null when it is not theirs. */
export async function readOwnProposalAttachments(
  db: Db,
  userId: string,
  pid: string,
): Promise<{ jobId: string; attachments: PostingAttachment[] } | null> {
  const [proposal] = await db
    .select({ jobId: jobProposals.jobId, attachments: jobProposals.attachments })
    .from(jobProposals)
    .where(and(eq(jobProposals.id, pid), eq(jobProposals.freelancerUserId, userId)))
    .limit(1);
  if (!proposal) return null;
  return { jobId: proposal.jobId, attachments: normalizeAttachments(proposal.attachments) };
}

/** Replace the bidder's own proposal's attachment list. */
export async function writeOwnProposalAttachments(
  db: Db,
  userId: string,
  pid: string,
  attachments: PostingAttachment[],
): Promise<void> {
  await db.update(jobProposals)
    .set({ attachments, updatedAt: sql`NOW()` })
    .where(and(eq(jobProposals.id, pid), eq(jobProposals.freelancerUserId, userId)));
}

/** Withdraw a live bid. False when there was no such live bid of theirs. */
export async function withdrawProposal(db: Db, userId: string, pid: string): Promise<boolean> {
  const rows = await db
    .update(jobProposals)
    .set({ status: 'withdrawn', updatedAt: sql`NOW()` })
    .where(and(
      eq(jobProposals.id, pid),
      eq(jobProposals.freelancerUserId, userId),
      inArray(jobProposals.status, ['submitted', 'shortlisted']),
    ))
    .returning({ id: jobProposals.id });
  return rows.length > 0;
}

// ---- The bid ------------------------------------------------------------------

/** The posting facts a bid is checked against. */
export async function readBiddableJob(db: Db, id: string) {
  const [job] = await db
    .select({
      id: jobPostings.id,
      tenant_id: jobPostings.tenantId,
      title: jobPostings.title,
      created_by_user_id: jobPostings.createdByUserId,
      status: jobPostings.status,
      visibility: jobPostings.visibility,
      screening_questions: jobPostings.screeningQuestions,
    })
    .from(jobPostings)
    .where(eq(jobPostings.id, id));
  return job;
}

/** Whether this person has an ACTIVE engagement with the posting's workspace — the
 *  standing relationship that admits them to a private posting. */
export async function hasActiveEngagement(db: Db, tenantId: number, userId: string): Promise<boolean> {
  const [relationship] = await db.select({ id: freelancerEngagements.id })
    .from(freelancerEngagements)
    .where(and(
      eq(freelancerEngagements.tenantId, tenantId),
      eq(freelancerEngagements.freelancerUserId, userId),
      isNull(freelancerEngagements.terminatedAt),
    )).limit(1);
  return Boolean(relationship);
}

/** The bidder's opt-in to being hired and the name the employer is notified with. */
export async function readBidder(db: Db, userId: string) {
  const [me] = await db
    .select({ available_for_hire: users.availableForHire, display_name: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  return me;
}

/**
 * Record (or revise) the bid. Returns the proposal id the statement actually wrote.
 *
 * The id must come BACK from the statement. Bidding is an upsert — a revised bid
 * updates the row that already exists — so returning the uuid this call minted would
 * hand the caller an id that names nothing, and every follow-up keyed on it (its
 * schedule, its withdrawal) would 404.
 */
export async function upsertBid(
  db: Db,
  input: { jobId: string; userId: string; coverNote: string | null; rateCents: number | null; screeningAnswers: ScreeningAnswerResult['answers'] },
): Promise<string | null> {
  const [bid] = await db
    .insert(jobProposals)
    .values({
      id: crypto.randomUUID(),
      jobId: input.jobId,
      freelancerUserId: input.userId,
      coverNote: input.coverNote,
      rateCents: input.rateCents,
      screeningAnswers: input.screeningAnswers,
    })
    .onConflictDoUpdate({
      target: [jobProposals.jobId, jobProposals.freelancerUserId],
      set: {
        coverNote: excluded(jobProposals.coverNote),
        rateCents: excluded(jobProposals.rateCents),
        // A revision replaces the answers wholesale — one bid is one set of answers,
        // not an accumulation. Attachments are NOT touched: they are uploaded by their
        // own route after the row exists, and re-submitting a revised cover note must
        // not delete the work samples already attached to it.
        screeningAnswers: excluded(jobProposals.screeningAnswers),
        status: 'submitted',
        updatedAt: sql`NOW()`,
      },
    })
    .returning({ id: jobProposals.id });
  return bid?.id ?? null;
}
