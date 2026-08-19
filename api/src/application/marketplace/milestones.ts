/**
 * The WRITER for fixed-price milestones — the only thing that moves escrow money.
 *
 * `escrow.ts` decides; this executes. Everything here is the boring half: read the
 * milestone, ask the machine, write the row and (when the move moves money) the ledger
 * entry. Keeping the two apart is what let every refusal be tested as a table without a
 * database, and it is why this module has no branching policy of its own — if you find
 * yourself adding an `if` about who may do what, it belongs in `escrow.ts`.
 *
 * ── IDEMPOTENCY IS THE DATABASE'S JOB, NOT A CHECK SOMEBODY REMEMBERED ──────────
 * `ledger_entries.reference` is unique per (tenant, denomination), and
 * `escrowLedgerReference` keys it on the milestone AND the action. So a retried release
 * — a double-clicked button, a replayed webhook, a cron that overlapped itself —
 * collides in Postgres and is absorbed by `onConflictDoNothing()`. This is the same
 * rule `listingCommerce` follows and the one the knowledge-checkout settlement was
 * required to land on: a replay must collide in the database rather than in application
 * code, because application code is where the check goes missing.
 *
 * The STATUS write is guarded the same way, with the expected status in the WHERE
 * clause. Two concurrent approvals therefore produce one transition and one loser that
 * updates zero rows, without a transaction — which matters because the platform runs on
 * neon-http, where there are none.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  engagementMilestones,
  freelancerEngagements,
  ledgerEntries,
} from '../../infrastructure/database/schema';
import { notify } from '../notifications/notify';
import { createPayout, isPayoutsConfigured } from '../integrations/payments';
import {
  escrowLedgerReference,
  escrowMovement,
  evaluateEscrow,
  evaluateWorkGate,
  summariseEscrow,
  type EscrowParty,
  type EscrowRefusal,
  type EscrowSummary,
  type MilestoneAction,
  type MilestoneStatus,
  type WorkGateVerdict,
} from './escrow';

const USD_CENTS = 'usd_cents';

/** A milestone as every surface reads it. */
export interface Milestone {
  id: string;
  tenantId: number;
  jobId: string | null;
  engagementId: string | null;
  freelancerUserId: string | null;
  title: string;
  description: string | null;
  sequence: number;
  amountCents: number;
  currency: string;
  status: MilestoneStatus;
  dueAt: Date | null;
  fundedAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  releasedAt: Date | null;
  submissionNote: string | null;
  rejectionReason: string | null;
  createdAt: Date;
}

const columns = {
  id: engagementMilestones.id,
  tenantId: engagementMilestones.tenantId,
  jobId: engagementMilestones.jobId,
  engagementId: engagementMilestones.engagementId,
  freelancerUserId: engagementMilestones.freelancerUserId,
  title: engagementMilestones.title,
  description: engagementMilestones.description,
  sequence: engagementMilestones.sequence,
  amountCents: engagementMilestones.amountCents,
  currency: engagementMilestones.currency,
  status: engagementMilestones.status,
  dueAt: engagementMilestones.dueAt,
  fundedAt: engagementMilestones.fundedAt,
  submittedAt: engagementMilestones.submittedAt,
  approvedAt: engagementMilestones.approvedAt,
  releasedAt: engagementMilestones.releasedAt,
  submissionNote: engagementMilestones.submissionNote,
  rejectionReason: engagementMilestones.rejectionReason,
  createdAt: engagementMilestones.createdAt,
};

/** The timestamp column each terminal-ish state stamps, so the row records WHEN as
 *  well as WHAT. Declared as data beside the machine's states rather than as a switch
 *  in the mover, so a new state cannot forget its stamp. */
const STAMP_COLUMN: Readonly<Partial<Record<MilestoneStatus, 'fundedAt' | 'submittedAt' | 'approvedAt' | 'releasedAt' | 'cancelledAt'>>> = {
  funded: 'fundedAt',
  submitted: 'submittedAt',
  approved: 'approvedAt',
  released: 'releasedAt',
  cancelled: 'cancelledAt',
};

export interface MilestoneScheduleView {
  milestones: Milestone[];
  summary: EscrowSummary;
  /** Whether work may start — the funded-before-work gate, resolved for this schedule. */
  gate: WorkGateVerdict;
}

/** Read one engagement's schedule, its rolled-up money, and whether work is authorised. */
export async function readEngagementSchedule(db: Db, tenantId: number, engagementId: string): Promise<MilestoneScheduleView> {
  // Two reads, not one query with a join: the schedule and the engagement's SHAPE are
  // independent facts, and the gate needs both even when one is empty — a fixed-price
  // engagement with NO milestones is precisely the case the gate must refuse, and a join
  // would return no rows and make it indistinguishable from an hourly one.
  const [rows, [engagement]] = await Promise.all([
    db.select(columns).from(engagementMilestones)
      .where(and(
        eq(engagementMilestones.tenantId, tenantId),
        eq(engagementMilestones.engagementId, engagementId),
      ))
      .orderBy(asc(engagementMilestones.sequence), asc(engagementMilestones.createdAt)) as Promise<Milestone[]>,
    db.select({ engagementType: freelancerEngagements.engagementType })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.tenantId, tenantId),
        eq(freelancerEngagements.id, engagementId),
      ))
      .limit(1),
  ]);
  return {
    milestones: rows,
    summary: summariseEscrow(rows),
    gate: evaluateWorkGate(engagement?.engagementType ?? null, rows),
  };
}

/**
 * Read the schedule proposed against a job — the bidding half, before anybody is hired.
 *
 * Tenant-scoped even though `job_id` alone would identify the rows: the posting belongs
 * to the employer's workspace, and a bare id predicate on a tenant-owned table is the
 * shape that becomes an IDOR the moment a caller can guess or enumerate one.
 */
export async function readJobSchedule(db: Db, tenantId: number, jobId: string): Promise<Milestone[]> {
  const rows = await db.select(columns).from(engagementMilestones)
    .where(scopedToTenant(engagementMilestones, tenantId, eq(engagementMilestones.jobId, jobId)))
    .orderBy(asc(engagementMilestones.sequence), asc(engagementMilestones.createdAt));
  return rows as Milestone[];
}

export interface CreateMilestoneInput {
  tenantId: number;
  jobId?: string | null;
  engagementId?: string | null;
  proposalId?: string | null;
  freelancerUserId?: string | null;
  title: string;
  description?: string | null;
  amountCents: number;
  currency?: string;
  sequence?: number;
  dueAt?: Date | null;
  createdByUserId?: string | null;
}

/** Add a deliverable to a schedule. Always lands in `draft` — nothing is funded by
 *  being written down, which is the property the whole machine rests on. */
export async function createMilestone(db: Db, input: CreateMilestoneInput): Promise<Milestone> {
  const id = crypto.randomUUID();
  const [row] = await db.insert(engagementMilestones).values({
    id,
    tenantId: input.tenantId,
    jobId: input.jobId ?? null,
    engagementId: input.engagementId ?? null,
    proposalId: input.proposalId ?? null,
    freelancerUserId: input.freelancerUserId ?? null,
    title: input.title.slice(0, 200),
    description: input.description ?? null,
    sequence: input.sequence ?? 0,
    amountCents: Math.max(0, Math.floor(input.amountCents)),
    currency: (input.currency ?? 'USD').slice(0, 3).toUpperCase(),
    status: 'draft',
    dueAt: input.dueAt ?? null,
    createdByUserId: input.createdByUserId ?? null,
  }).returning(columns);
  return row as Milestone;
}

/**
 * Carry a bid's proposed schedule onto the engagement that accepted it.
 *
 * Stamps rather than copies, deliberately: the client agreed to THESE rows, and a copy
 * is a second schedule that can differ from the one that was bid. Also stamps the
 * freelancer, which is what makes a later release pay whoever was engaged at the time.
 */
export async function bindScheduleToEngagement(
  // Structural rather than `Db`, so the accept path can pass its TRANSACTION. Binding
  // has to happen in the same transaction that creates the engagement: a commit that
  // hires somebody but leaves the schedule on the job is an engagement whose agreed
  // deliverables silently vanished, and there is no second request that would repair it
  // — accepting a proposal is a one-shot, concurrency-gated move.
  db: Pick<Db, 'update'>,
  input: { tenantId: number; jobId: string; engagementId: string; freelancerUserId: string; proposalId?: string | null },
): Promise<number> {
  const rows = await db.update(engagementMilestones)
    .set({
      engagementId: input.engagementId,
      freelancerUserId: input.freelancerUserId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(engagementMilestones.tenantId, input.tenantId),
      eq(engagementMilestones.jobId, input.jobId),
      // Only the schedule that has not been bound yet, and only what is still a draft:
      // re-running an accept must not reopen work that has already been transacted.
      eq(engagementMilestones.status, 'draft'),
      ...(input.proposalId ? [eq(engagementMilestones.proposalId, input.proposalId)] : []),
    ))
    .returning({ id: engagementMilestones.id });
  return rows.length;
}

export type MilestoneMoveResult =
  | { ok: true; milestone: Milestone; movedMoney: boolean; payoutConfigured: boolean }
  | { ok: false; reason: EscrowRefusal | 'not_found' | 'conflict' };

export interface MoveMilestoneInput {
  tenantId: number;
  milestoneId: string;
  action: MilestoneAction;
  party: EscrowParty;
  /** The acting user — the freelancer for `submit`, the client otherwise. */
  actorUserId: string;
  note?: string | null;
}

/**
 * Apply one escrow action.
 *
 * The order is deliberate and is the only interesting thing in this function:
 *
 *   1. READ the milestone.
 *   2. ASK the machine. A refusal returns before anything is written.
 *   3. WRITE the money first, then the status — and the status write is conditional on
 *      the milestone still being in the state we decided against.
 *
 * Money before status, because the two are not in one transaction (neon-http has none)
 * and the two possible half-failures are not equally bad. Ledger-then-status can leave
 * a hold recorded against a milestone that still reads `draft`: visible, reconcilable,
 * and retryable — the retry collides on the unique reference and only the status moves.
 * Status-then-ledger would leave a milestone that says the money is held when no entry
 * exists, which is the failure that tells a freelancer to start work that nobody paid
 * for.
 */
export async function moveMilestone(env: Env, db: Db, input: MoveMilestoneInput): Promise<MilestoneMoveResult> {
  const [current] = await db.select(columns).from(engagementMilestones)
    .where(and(
      eq(engagementMilestones.tenantId, input.tenantId),
      eq(engagementMilestones.id, input.milestoneId),
    ))
    .limit(1);
  if (!current) return { ok: false, reason: 'not_found' };
  const milestone = current as Milestone;

  const verdict = evaluateEscrow({
    action: input.action,
    status: milestone.status,
    party: input.party,
    amountCents: milestone.amountCents,
  });
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };

  let payoutConfigured = isPayoutsConfigured(env);
  if (verdict.movesMoney) {
    await writeEscrowLedger(db, milestone, input.action);
    if (input.action === 'release') {
      // The money movement itself is still the env-gated stub — the parity audit calls
      // this partial-by-nature. A missing provider does NOT block the release: the
      // ledger entry is the platform's own record either way, and refusing to release
      // because no webhook is configured would strand every self-hosted deployment.
      const payout = await createPayout(env, {
        invoiceId: milestone.id,
        amountCents: milestone.amountCents,
        currency: milestone.currency,
        freelancerUserId: milestone.freelancerUserId ?? '',
        tenantId: milestone.tenantId,
      });
      payoutConfigured = payout.configured;
    }
  }

  const now = new Date();
  const stamp = STAMP_COLUMN[verdict.next];
  const [updated] = await db.update(engagementMilestones)
    .set({
      status: verdict.next,
      updatedAt: now,
      ...(stamp ? { [stamp]: now } : {}),
      ...(input.action === 'submit' ? { submissionNote: input.note ?? null } : {}),
      ...(input.action === 'reject' ? { rejectionReason: input.note ?? null } : {}),
    })
    .where(and(
      eq(engagementMilestones.tenantId, input.tenantId),
      eq(engagementMilestones.id, input.milestoneId),
      // The optimistic guard: two concurrent approvals produce one winner and one
      // update that touches zero rows, with no transaction involved.
      eq(engagementMilestones.status, milestone.status),
    ))
    .returning(columns);
  if (!updated) return { ok: false, reason: 'conflict' };

  await announce(env, db, updated as Milestone, input);
  return { ok: true, milestone: updated as Milestone, movedMoney: verdict.movesMoney, payoutConfigured };
}

/** The ledger entries one money-moving action writes. Idempotent by unique reference. */
async function writeEscrowLedger(db: Db, milestone: Milestone, action: MilestoneAction): Promise<void> {
  const movement = escrowMovement(action);
  if (!movement) return;
  const reference = escrowLedgerReference(milestone.id, action);
  const amount = movement.sign * milestone.amountCents;
  await db.insert(ledgerEntries).values({
    tenantId: milestone.tenantId,
    // A payout is against the FREELANCER's user account — the same account
    // `PayoutAccountService` pays from, so earned and paid stay subtractable. A hold or
    // refund is against the client's tenant.
    accountKind: movement.accountKind,
    accountRef: movement.accountKind === 'user'
      ? (milestone.freelancerUserId ?? '')
      : String(milestone.tenantId),
    denomination: USD_CENTS,
    amount: String(amount),
    entryKind: movement.entryKind,
    reference,
    memo: `Escrow ${action} — ${milestone.title}`,
    metadata: { source: 'engagement_milestone', milestoneId: milestone.id, engagementId: milestone.engagementId },
  }).onConflictDoNothing();
}

/** Tell the other side. Best-effort — a notification failure must never undo money. */
async function announce(env: Env, db: Db, milestone: Milestone, input: MoveMilestoneInput): Promise<void> {
  // The party that did NOT act is the one who needs telling.
  const recipient = input.party === 'client' ? milestone.freelancerUserId : null;
  if (!recipient) return;
  const money = `${(milestone.amountCents / 100).toFixed(2)} ${milestone.currency}`;
  const titles: Partial<Record<MilestoneAction, string>> = {
    fund: `Funded: ${milestone.title} (${money} held)`,
    approve: `Approved: ${milestone.title}`,
    reject: `Changes requested: ${milestone.title}`,
    release: `Paid: ${milestone.title} (${money})`,
    cancel: `Cancelled: ${milestone.title}`,
  };
  const title = titles[input.action];
  if (!title) return;
  await notify(db, env, {
    userId: recipient,
    tenantId: milestone.tenantId,
    kind: `milestone_${input.action}`,
    title,
    body: input.note ?? milestone.description ?? null,
    ref: milestone.engagementId,
  });
}

/**
 * MAY THIS FREELANCER START?
 *
 * The gate, resolved against the database, for callers that hold an engagement id and
 * nothing else. One query — the milestones — because `evaluateWorkGate` needs only
 * their statuses.
 */
export async function workIsAuthorised(db: Db, tenantId: number, engagementId: string): Promise<WorkGateVerdict> {
  const [rows, [engagement]] = await Promise.all([
    db.select({ status: engagementMilestones.status, amountCents: engagementMilestones.amountCents })
      .from(engagementMilestones)
      .where(and(
        eq(engagementMilestones.tenantId, tenantId),
        eq(engagementMilestones.engagementId, engagementId),
      )),
    db.select({ engagementType: freelancerEngagements.engagementType })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.tenantId, tenantId),
        eq(freelancerEngagements.id, engagementId),
      ))
      .limit(1),
  ]);
  return evaluateWorkGate(
    engagement?.engagementType ?? null,
    rows as { status: MilestoneStatus; amountCents: number }[],
  );
}

/**
 * The tenant a milestone belongs to, IF this freelancer is the one engaged on it.
 *
 * The freelancer half of the API holds a web JWT and therefore no tenant, so it cannot
 * scope its own reads. Rather than let those routes pass a tenant the caller supplied —
 * which is an IDOR wearing a parameter — the milestone is resolved BY the acting user,
 * and the tenant comes back from the row. A freelancer who is not on this milestone
 * gets null and the route 404s.
 */
export async function milestoneTenantForFreelancer(db: Db, milestoneId: string, userId: string): Promise<number | null> {
  const [row] = await db
    .select({ tenantId: engagementMilestones.tenantId })
    .from(engagementMilestones)
    // Cross-tenant for the same reason `readFreelancerMilestones` is, and declared the
    // same way: the caller has no tenant, and the subject predicate is what makes the
    // read safe. Resolving the tenant here is precisely what stops the route having to
    // accept one from the request.
    .where(acrossTenants(
      engagementMilestones,
      'subject_own_rows',
      and(
        eq(engagementMilestones.id, milestoneId),
        eq(engagementMilestones.freelancerUserId, userId),
      )!,
    ))
    .limit(1);
  return row ? Number(row.tenantId) : null;
}

/**
 * Every milestone this freelancer is engaged on — the worker's own "what am I owed"
 * view, served by `idx_engagement_milestones_freelancer`.
 *
 * Cross-tenant BY DESIGN and declared as such: a for-hire account works for many client
 * workspaces and is a member of none, so this question's answer spans every tenant that
 * has hired them. `userId` must be the verified subject from the web JWT — the whole
 * safety of `subject_own_rows` is that the predicate names one authenticated person,
 * which is a strictly narrower filter than a tenant would be.
 */
export async function readFreelancerMilestones(db: Db, userId: string): Promise<Milestone[]> {
  const rows = await db.select(columns).from(engagementMilestones)
    .where(acrossTenants(engagementMilestones, 'subject_own_rows', eq(engagementMilestones.freelancerUserId, userId)))
    .orderBy(asc(engagementMilestones.sequence), asc(engagementMilestones.createdAt))
    .limit(500);
  return rows as Milestone[];
}

/** Delete a draft milestone. Only ever a draft: once money has moved, the row is a
 *  financial record and stops being editable. */
export async function deleteDraftMilestone(db: Db, tenantId: number, milestoneId: string): Promise<boolean> {
  const rows = await db.delete(engagementMilestones)
    .where(and(
      eq(engagementMilestones.tenantId, tenantId),
      eq(engagementMilestones.id, milestoneId),
      inArray(engagementMilestones.status, ['draft']),
    ))
    .returning({ id: engagementMilestones.id });
  return rows.length > 0;
}
