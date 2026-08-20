/**
 * Escrow disputes and mediation — the typed client for all three parties.
 *
 * ── THE AUTHORITY SPLIT IS IN THE FUNCTION SIGNATURES ────────────────────────────
 * The client and the mediator act with the TENANT token (`/api/disputes`); the
 * freelancer acts with the WEB token (`/api/engagements/mine/...`). That split is
 * mirrored one-for-one below and there is no endpoint here that accepts either — which
 * is what makes "the freelancer filed as the freelancer" structural rather than a field
 * in a request body that a surface could set wrong.
 *
 * Both sides may RAISE a dispute, which is the one escrow-shaped move that is not
 * one-sided. Each door supplies its own party server-side; neither reads it from here.
 *
 * ── WHY `mediatorAuthority` COMES FROM THE SERVER ────────────────────────────────
 * The same reason a milestone's `actions` do (`milestonesApi.ts`): a second copy of
 * "who may rule" in the browser is a second place for the rule to drift, and the one
 * that drifted would be the one offering a Resolve button the server then refuses.
 */
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';
import type { MilestoneStatus } from './milestonesApi';
import type { SettlementMode } from './earningsApi';

export type DisputeStatus = 'open' | 'mediating' | 'resolved' | 'withdrawn';

/** The four places a dispute can end. A closed set, so two rulings of the same shape
 *  always produce the same ledger movements. */
export type DisputeOutcome = 'release_full' | 'refund_full' | 'split' | 'restore';
export const DISPUTE_OUTCOMES: DisputeOutcome[] = ['release_full', 'refund_full', 'split', 'restore'];

export type StatementParty = 'client' | 'freelancer' | 'mediator';

/**
 * Who may rule.
 *
 * `platform` — a platform operator, the only genuinely neutral mediator: both parties
 *   to an escrow dispute sit inside the engagement, and the client IS the workspace.
 * `workspace` — the workspace owner, allowed because a self-hosted deployment has no
 *   platform operator and a dispute nobody can resolve is worse. Shown as such rather
 *   than as plain "mediator", so the freelancer can see which ruled.
 * `none` — this caller may not rule.
 */
export type MediatorAuthority = 'platform' | 'workspace' | 'none';

export interface DisputeEvidence {
  label: string;
  url: string;
}

export interface DisputeStatement {
  party: StatementParty;
  authorRef: string;
  position: string;
  evidence: DisputeEvidence[];
  filedAtISO: string;
}

export interface Dispute {
  id: number;
  tenantId: number;
  workspaceName: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  amountCents: number;
  currency: string;
  raisedByRef: string;
  raisedByParty: 'client' | 'freelancer';
  reason: string;
  detail: string | null;
  priorStatus: MilestoneStatus | null;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  awardFreelancerCents: number;
  awardClientCents: number;
  mediatorUserId: string | null;
  resolution: string | null;
  resolvedAtISO: string | null;
  createdAtISO: string;
  statements: DisputeStatement[];
  settlement: SettlementMode;
}

/** True while the dispute can still be acted on. */
export function isDisputeLive(status: DisputeStatus): boolean {
  return status === 'open' || status === 'mediating';
}

// ---- Client + mediator (tenant token) -------------------------------------

export async function listWorkspaceDisputes(): Promise<{
  disputes: Dispute[];
  openCount: number;
  mediatorAuthority: MediatorAuthority;
}> {
  const res = await apiRequestStream('/api/disputes', { auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to load disputes');
}

export async function raiseClientDispute(milestoneId: string, reason: string, detail?: string): Promise<Dispute> {
  const res = await apiRequestStream(`/api/engagements/milestones/${milestoneId}/dispute`, {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ reason, detail: detail ?? null }),
  });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'That dispute was refused');
  return body.dispute;
}

export async function fileClientStatement(
  disputeId: number,
  position: string,
  evidence: DisputeEvidence[],
  asMediator = false,
): Promise<Dispute> {
  const res = await apiRequestStream(`/api/disputes/${disputeId}/statement`, {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ position, evidence, asMediator }),
  });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'Failed to file that position');
  return body.dispute;
}

export async function startMediation(disputeId: number): Promise<Dispute> {
  const res = await apiRequestStream(`/api/disputes/${disputeId}/mediate`, { method: 'POST', auth: 'tenant' });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'Failed to start mediation');
  return body.dispute;
}

/**
 * Rule.
 *
 * `splitFreelancerCents` is the freelancer's share ONLY — the client's is the remainder,
 * computed on the server. Two independently supplied halves are two numbers that can
 * fail to add up, and the pot they must add up to is somebody's held money.
 */
export async function resolveDispute(input: {
  disputeId: number;
  outcome: DisputeOutcome;
  splitFreelancerCents?: number | null;
  resolution?: string | null;
}): Promise<Dispute> {
  const res = await apiRequestStream(`/api/disputes/${input.disputeId}/resolve`, {
    method: 'POST',
    auth: 'tenant',
    body: JSON.stringify({
      outcome: input.outcome,
      splitFreelancerCents: input.splitFreelancerCents ?? null,
      resolution: input.resolution ?? null,
    }),
  });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'That ruling was refused');
  return body.dispute;
}

export async function withdrawClientDispute(disputeId: number): Promise<Dispute> {
  const res = await apiRequestStream(`/api/disputes/${disputeId}/withdraw`, { method: 'POST', auth: 'tenant' });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'Failed to withdraw that dispute');
  return body.dispute;
}

// ---- Freelancer (web token) ----------------------------------------------

export async function listMyDisputes(): Promise<Dispute[]> {
  const res = await apiRequestStream('/api/engagements/mine/disputes', { auth: 'web' });
  const body = await jsonOrThrow<{ disputes: Dispute[] }>(res, 'Failed to load your disputes');
  return body.disputes;
}

export async function raiseMyDispute(milestoneId: string, reason: string, detail?: string): Promise<Dispute> {
  const res = await apiRequestStream(`/api/engagements/mine/milestones/${milestoneId}/dispute`, {
    method: 'POST', auth: 'web', body: JSON.stringify({ reason, detail: detail ?? null }),
  });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'That dispute was refused');
  return body.dispute;
}

export async function fileMyStatement(
  disputeId: number,
  position: string,
  evidence: DisputeEvidence[],
): Promise<Dispute> {
  const res = await apiRequestStream(`/api/engagements/mine/disputes/${disputeId}/statement`, {
    method: 'POST', auth: 'web', body: JSON.stringify({ position, evidence }),
  });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'Failed to file your position');
  return body.dispute;
}

export async function withdrawMyDispute(disputeId: number): Promise<Dispute> {
  const res = await apiRequestStream(`/api/engagements/mine/disputes/${disputeId}/withdraw`, {
    method: 'POST', auth: 'web',
  });
  const body = await jsonOrThrow<{ dispute: Dispute }>(res, 'Failed to withdraw that dispute');
  return body.dispute;
}
