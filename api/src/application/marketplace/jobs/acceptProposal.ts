import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { freelancerEngagements, jobPostings, jobProposals } from '../../../infrastructure/database/schema';
import { inTransaction, type Db } from '../../../infrastructure/database/connection';
import { hireShape } from '../engagementShape';
import { bindScheduleToEngagement } from '../milestones';
import { proposalColumns } from './jobRows';

export interface AcceptProposalInput {
  tenantId: number;
  /** The employer accepting — recorded as the engagement's creator. */
  actorUserId: string;
  proposalId: string;
}

/**
 * The employer accepts a bid: the posting is filled, the freelancer is engaged, the
 * agreed schedule is bound, and every other open bid is declined — all of it in ONE
 * transaction, or none of it.
 *
 * Returns `null` when the proposal is not this tenant's open bid, and
 * `{ conflict: true }` when another accept filled the posting first.
 */
export async function acceptProposal(db: Db, input: AcceptProposalInput) {
  const { tenantId, actorUserId, proposalId } = input;
  return inTransaction(db, async (tx) => {
    const [pr] = await tx.select({
      ...proposalColumns,
      job_tenant: jobPostings.tenantId,
      project_id: jobPostings.projectId,
      job_title: jobPostings.title,
      job_engagement_type: jobPostings.engagementType,
      source_ticket_id: jobPostings.sourceTicketId,
    }).from(jobProposals)
      .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
      .where(and(eq(jobProposals.id, proposalId), inArray(jobProposals.status, ['submitted', 'shortlisted'])));
    if (!pr || Number(pr.job_tenant) !== Number(tenantId)) return null;

    // This conditional transition is the concurrency gate. Only one request can
    // move an open posting to filled; a replay cannot mint another engagement.
    const claimed = await tx.update(jobPostings)
      .set({ status: 'filled', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobPostings.id, pr.job_id), eq(jobPostings.tenantId, tenantId), eq(jobPostings.status, 'open')))
      .returning({ id: jobPostings.id });
    if (claimed.length === 0) return { conflict: true as const };

    const projectId = pr.project_id == null ? null : Number(pr.project_id);
    const [existing] = await tx.select({ id: freelancerEngagements.id })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.tenantId, tenantId),
        eq(freelancerEngagements.freelancerUserId, pr.freelancer_user_id),
        sql`COALESCE(${freelancerEngagements.projectId}, 0) = COALESCE(${projectId}, 0)`,
        isNull(freelancerEngagements.terminatedAt),
      ));
    const engagementId = existing?.id ?? crypto.randomUUID();
    if (existing) {
      await tx.update(freelancerEngagements)
        .set({ status: 'active', hiredAt: sql`COALESCE(${freelancerEngagements.hiredAt}, NOW())`, rateCents: pr.rate_cents, updatedAt: new Date() })
        .where(and(eq(freelancerEngagements.id, engagementId), eq(freelancerEngagements.tenantId, tenantId)));
    } else {
      await tx.insert(freelancerEngagements).values({
        id: engagementId, tenantId, projectId,
        freelancerUserId: pr.freelancer_user_id, status: 'active',
        rateCents: pr.rate_cents, currency: pr.currency ?? 'USD',
        title: pr.job_title, createdByUserId: actorUserId, hiredAt: new Date(),
        // Frozen at hire from the posting that was bid on — see 0928 on why this is
        // a declared copy rather than a join, and why it must not be re-read later.
        engagementType: hireShape(pr.job_engagement_type),
      });
    }
    // Carry the AGREED payment schedule onto the engagement, in the SAME transaction
    // that created it. Naming the accepted proposal is what makes this the agreed one:
    // a bid that counter-proposed its own deliverables binds THOSE, and the posting's
    // published schedule binds only when the accepted bid proposed none. Accepting a
    // proposal is agreeing to that proposal — funding the posting's terms over the top
    // would discard the counter-offer at the moment it was accepted. A no-op for an
    // hourly posting, which simply has no schedule at all.
    await bindScheduleToEngagement(tx, {
      tenantId,
      jobId: pr.job_id as string,
      engagementId,
      freelancerUserId: pr.freelancer_user_id as string,
      proposalId,
    });
    await tx.update(jobProposals).set({ status: 'accepted', updatedAt: new Date() }).where(eq(jobProposals.id, proposalId));
    await tx.update(jobProposals).set({ status: 'declined', updatedAt: new Date() })
      .where(and(eq(jobProposals.jobId, pr.job_id), inArray(jobProposals.status, ['submitted', 'shortlisted'])));
    return { conflict: false as const, engagementId, proposal: pr };
  });
}
