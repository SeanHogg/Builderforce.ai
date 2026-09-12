/**
 * Job seeker: saved jobs.
 *
 * A saved job is a proposal in the `saved` state, NOT a second table. hired.video
 * modelled bookmarks separately, which then needed its own join to answer "did I
 * already apply to this?" and could disagree with the answer the proposals table
 * gave. Saving and applying are two points on one lifecycle — save → submitted →
 * shortlisted → accepted — so they are one row whose status moves, which is the
 * register's rule that a new KIND is a column value rather than a new table.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import { jobPostings, jobProposals } from '../../../infrastructure/database/schema';
import { acrossTenants } from '../../../infrastructure/database/tenantScope';
import { mapProposal, proposalColumns } from './jobRows';

/** The seeker's shortlist. */
export async function listSavedJobs(db: Db, userId: string) {
  const rows = await db
    .select({ ...proposalColumns, job_title: jobPostings.title })
    .from(jobProposals)
    .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
    .where(and(
      eq(jobProposals.freelancerUserId, userId),
      eq(jobProposals.status, 'saved'),
    ))
    .orderBy(desc(jobProposals.createdAt))
    .limit(200);
  return rows.map(mapProposal);
}

/**
 * Bookmark a job. Never downgrades a real bid back to `saved`: saving something you
 * already applied to is a no-op, not a withdrawal. False when the posting does not exist.
 */
export async function saveJob(db: Db, userId: string, id: string): Promise<boolean> {
  // The marketplace is the cross-tenant surface: a freelancer has no tenant of
  // their own, so bookmarking an employer's posting reads past the tenant filter
  // by design. Declared rather than baselined, and the id is the access predicate.
  const [job] = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(acrossTenants(jobPostings, 'public_catalogue', eq(jobPostings.id, id)));
  if (!job) return false;
  const pid = crypto.randomUUID();
  await db.insert(jobProposals)
    .values({ id: pid, jobId: id, freelancerUserId: userId, status: 'saved' })
    .onConflictDoUpdate({
      target: [jobProposals.jobId, jobProposals.freelancerUserId],
      set: { updatedAt: sql`NOW()` },
    });
  return true;
}

/** Unsave. Only ever removes a `saved` row, so this can never silently delete a submitted bid. */
export async function unsaveJob(db: Db, userId: string, id: string): Promise<void> {
  await db.delete(jobProposals).where(and(
    eq(jobProposals.jobId, id),
    eq(jobProposals.freelancerUserId, userId),
    eq(jobProposals.status, 'saved'),
  ));
}
