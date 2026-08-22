/**
 * DELIVERABLES — what a freelancer hands back, and how it is judged.
 *
 * Separate from the engagement because a deliverable can also answer a JOB, and
 * separate from postings because acceptance is a delivery decision rather than a
 * hiring one. `evaluateDeliverable` returns the same `EvalScores` shape a
 * proposal is scored with — one vocabulary for "how good is this", two subjects.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { apiRequestStream, jsonOrThrow } from './transport';
import type { EvalScores } from './postings';

/** A freelancer-submitted deliverable against an engagement/job. */
export interface Deliverable {
  id: string;
  engagementId: string | null;
  jobId: string | null;
  ticketId: number | null;
  freelancerUserId: string;
  freelancerName: string | null;
  title: string;
  body: string | null;
  status: 'submitted' | 'in_review' | 'accepted' | 'changes_requested';
  lastEvalOverall: number | null;
  createdAt: string | null;
}

// ---- Deliverables --------------------------------------------------------
export async function submitDeliverable(input: { engagementId: string; title: string; body: string; ticketId?: number }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/deliverables`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to submit deliverable');
}

export async function listMyDeliverables(engagementId?: string): Promise<Deliverable[]> {
  const qs = engagementId ? `?engagementId=${encodeURIComponent(engagementId)}` : '';
  const res = await apiRequestStream(`/api/deliverables/mine${qs}`, { auth: 'web' });
  return jsonOrThrow<Deliverable[]>(res, 'Failed to load deliverables');
}

export async function listEngagementDeliverables(engagementId: string): Promise<Deliverable[]> {
  const res = await apiRequestStream(`/api/deliverables/for-engagement/${engagementId}`, { auth: 'tenant' });
  return jsonOrThrow<Deliverable[]>(res, 'Failed to load deliverables');
}

export async function listJobDeliverables(jobId: string): Promise<Deliverable[]> {
  const res = await apiRequestStream(`/api/deliverables/for-job/${jobId}`, { auth: 'tenant' });
  return jsonOrThrow<Deliverable[]>(res, 'Failed to load deliverables');
}

export async function evaluateDeliverable(id: string): Promise<EvalScores> {
  const res = await apiRequestStream(`/api/deliverables/${id}/evaluate`, { method: 'POST', auth: 'tenant' });
  return jsonOrThrow<EvalScores>(res, 'Failed to evaluate deliverable');
}

export async function setDeliverableStatus(id: string, status: 'accepted' | 'changes_requested'): Promise<void> {
  const res = await apiRequestStream(`/api/deliverables/${id}/status`, { method: 'POST', auth: 'tenant', body: JSON.stringify({ status }) });
  await jsonOrThrow(res, 'Failed to update deliverable');
}

