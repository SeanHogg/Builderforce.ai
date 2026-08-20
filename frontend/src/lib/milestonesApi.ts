/**
 * Fixed-price milestones + escrow — the typed client for both sides of the deal.
 *
 * ── WHY THE ACTIONS COME FROM THE SERVER ─────────────────────────────────────────
 * `MilestoneRow.actions` is a list the API computed with the same state machine that
 * will judge the request (`api/src/application/marketplace/escrow.ts`). Nothing in this
 * file — and nothing in the panel that renders it — decides who may fund, submit,
 * approve, reject, release or cancel. A second copy of that machine in the browser
 * would be a second place for the rule to drift, and the one that drifted would be the
 * one offering a button the server then refuses. So the surface renders what it is
 * handed and cannot offer an illegal move.
 *
 * ── WHY NOTHING HERE IS CACHED ───────────────────────────────────────────────────
 * These reads are the exception the caching rule allows for. An escrow balance is the
 * answer to "is my money safe" and "may I start work"; serving a stale one tells a
 * freelancer to begin against a hold that was already refunded, or tells a client their
 * funds are held when a release has moved them. Every read here is a single indexed
 * query behind a click, and correctness beats the round-trip.
 *
 * ── THE AUTHORITY SPLIT ──────────────────────────────────────────────────────────
 * The client acts with the TENANT token and the freelancer with the WEB token, which is
 * what makes "only the freelancer may submit" structural rather than a role check a
 * surface could forget. That split is mirrored one-for-one in the `auth:` argument
 * below; there is no endpoint here that accepts either.
 */
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';

/** Where a milestone is. Mirrors the CHECK constraint in migration 0924. */
export type MilestoneStatus =
  | 'draft' | 'funded' | 'submitted' | 'approved' | 'released' | 'cancelled' | 'disputed';

/** What somebody is trying to do to a milestone. */
export type MilestoneAction = 'fund' | 'submit' | 'approve' | 'reject' | 'release' | 'cancel';

export interface MilestoneRow {
  id: string;
  jobId: string | null;
  engagementId: string | null;
  /** Set while this row is one bidder's counter-proposal rather than an agreed line. */
  proposalId: string | null;
  freelancerUserId: string | null;
  title: string;
  description: string | null;
  sequence: number;
  amountCents: number;
  currency: string;
  status: MilestoneStatus;
  dueAt: string | null;
  fundedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  submissionNote: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  /** Every move the ASKING party may make right now — decided by the server's machine. */
  actions?: MilestoneAction[];
  /** Worker view only: which engagement and which client this line belongs to. */
  engagementTitle?: string | null;
  clientName?: string | null;
}

/** The five numbers both sides ask about, computed server-side from the rows —
 *  never stored, so it can never disagree with the schedule printed beneath it. */
export interface EscrowSummary {
  agreedCents: number;
  heldCents: number;
  releasedCents: number;
  owedCents: number;
  unfundedCents: number;
}

/** The funded-before-work gate, resolved for one engagement. */
export type WorkGate =
  | { authorised: true; reason: 'funded' | 'not_fixed_price' }
  | { authorised: false; reason: 'nothing_funded' | 'no_milestones' };

export interface MilestoneSchedule {
  milestones: MilestoneRow[];
  summary: EscrowSummary;
  gate: WorkGate;
}

/** One line as somebody authors it, on a posting, a bid or an engagement. */
export interface MilestoneDraft {
  title: string;
  description?: string | null;
  amountCents: number;
  dueAt?: string | null;
}

// ---- Client (tenant token) ------------------------------------------------

export async function getEngagementSchedule(engagementId: string): Promise<MilestoneSchedule> {
  const res = await apiRequestStream(`/api/engagements/${engagementId}/milestones`, { auth: 'tenant' });
  return jsonOrThrow<MilestoneSchedule>(res, 'Failed to load the payment schedule');
}

export async function addEngagementMilestone(engagementId: string, draft: MilestoneDraft & { sequence?: number }): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/${engagementId}/milestones`, {
    method: 'POST', auth: 'tenant', body: JSON.stringify(draft),
  });
  await jsonOrThrow(res, 'Failed to add the milestone');
}

/**
 * Fund, approve, reject, release or cancel.
 *
 * ONE function rather than five, for the same reason the API is one route: the five
 * differ only in a word the state machine already understands, and five wrappers would
 * be five places to forget the gate.
 */
export async function moveMilestone(milestoneId: string, action: MilestoneAction, note?: string): Promise<{ payoutConfigured?: boolean }> {
  const res = await apiRequestStream(`/api/engagements/milestones/${milestoneId}/${action}`, {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ note: note ?? null }),
  });
  return jsonOrThrow(res, 'That move was refused');
}

export async function deleteMilestone(milestoneId: string): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/milestones/${milestoneId}`, { method: 'DELETE', auth: 'tenant' });
  await jsonOrThrow(res, 'Failed to remove the milestone');
}

// ---- The posting's published schedule (tenant token) ----------------------

export async function getJobSchedule(jobId: string): Promise<{ milestones: MilestoneRow[]; summary: EscrowSummary }> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/milestones`, { auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to load the payment schedule');
}

export async function addJobMilestone(jobId: string, draft: MilestoneDraft & { sequence?: number }): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/milestones`, {
    method: 'POST', auth: 'tenant', body: JSON.stringify(draft),
  });
  await jsonOrThrow(res, 'Failed to add the milestone');
}

// ---- Freelancer (web token) ----------------------------------------------

export async function listMyMilestones(): Promise<{ milestones: MilestoneRow[]; summary: EscrowSummary }> {
  const res = await apiRequestStream(`/api/engagements/mine/milestones`, { auth: 'web' });
  return jsonOrThrow(res, 'Failed to load your milestones');
}

export async function submitMilestone(milestoneId: string, note?: string): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/mine/milestones/${milestoneId}/submit`, {
    method: 'POST', auth: 'web', body: JSON.stringify({ note: note ?? null }),
  });
  await jsonOrThrow(res, 'Failed to submit the milestone');
}

/**
 * Run one action for whichever party is acting.
 *
 * `submit` is the freelancer's only move and no client schedule ever offers it — that is
 * the machine's guarantee, not this module's assumption — so the action itself names the
 * endpoint and the token. Keeping the fan-out here means the panel that renders the
 * buttons stays party-agnostic and there is one place that knows the split.
 */
export function runMilestoneAction(milestoneId: string, action: MilestoneAction, note?: string): Promise<unknown> {
  return action === 'submit'
    ? submitMilestone(milestoneId, note)
    : moveMilestone(milestoneId, action, note);
}

/** Money held or already paid — the rows a schedule can no longer be rewritten from. */
export function isTransacted(status: MilestoneStatus): boolean {
  return status !== 'draft' && status !== 'cancelled';
}
