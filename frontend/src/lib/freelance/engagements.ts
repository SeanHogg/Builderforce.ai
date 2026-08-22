/**
 * ENGAGEMENTS — a hire, and everything that happens because of one.
 *
 * The engagement is the relationship: invited → interviewing → active →
 * terminated. Timecards, logged meetings, the portal's activity signals, the
 * two-way reviews and the worker's read view of the project board all hang off it,
 * and none of them means anything without one.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { getStoredWebToken } from '@/lib/auth';
import { apiRequestStream, jsonOrThrow } from './transport';

export interface EngagementBoard {
  engagementId: string;
  tenantId: number;
  tenantName: string | null;
  projectId: number | null;
  projectName: string | null;
  projectKey: string | null;
  title: string | null;
  accessScope: string;
}

/** A task on an engagement board (worker view). */
export interface EngagementTask {
  id: number;
  key: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  taskType: string;
}

export interface Engagement {
  id: string;
  tenantId: number;
  tenantName: string | null;
  projectId: number | null;
  freelancerUserId: string;
  freelancerName: string | null;
  status: 'invited' | 'interviewing' | 'active' | 'declined' | 'terminated';
  rateCents: number | null;
  currency: string;
  title: string | null;
  note: string | null;
  invitedAt: string | null;
  hiredAt: string | null;
  terminatedAt: string | null;
}

// ---- Employer: engagements ----------------------------------------------

export async function hireFreelancer(input: { freelancerUserId: string; projectId?: number; rateCents?: number; title?: string; note?: string; status?: 'invited' | 'interviewing' | 'active' }): Promise<{ id: string; status: string }> {
  const res = await apiRequestStream(`/api/engagements`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to hire');
}

export async function listEngagements(): Promise<Engagement[]> {
  const res = await apiRequestStream(`/api/engagements`, { auth: 'tenant' });
  return jsonOrThrow<Engagement[]>(res, 'Failed to load engagements');
}

export async function listMyEngagements(): Promise<Engagement[]> {
  const res = await apiRequestStream(`/api/engagements/mine`, { auth: 'web' });
  return jsonOrThrow<Engagement[]>(res, 'Failed to load engagements');
}

export async function updateEngagement(id: string, patch: { status?: string; rateCents?: number; title?: string }): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/${id}`, { method: 'PATCH', auth: 'tenant', body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to update engagement');
}

export async function terminateEngagement(id: string, reason?: string): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/${id}`, { method: 'DELETE', auth: 'tenant', body: JSON.stringify({ reason }) });
  await jsonOrThrow(res, 'Failed to terminate engagement');
}

// ---- Timecards ----------------------------------------------------------

// Worker: log a meeting as paid time (emits a billable meeting span).
export async function logMeeting(input: { engagementId: string; occurredAt?: string; durationMinutes: number; note?: string }): Promise<void> {
  const res = await apiRequestStream(`/api/activity/meeting`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  await jsonOrThrow(res, 'Failed to log meeting');
}

// ---- Activity signals (portal capture) ----------------------------------

export interface ActivitySignalInput {
  source?: 'portal' | 'vscode' | 'agent' | 'meeting' | 'system';
  kind: string;
  ref?: string;
  weight?: number;
  durationSeconds?: number;
  projectId?: number;
  tenantId?: number;
  engagementId?: string;
  sessionId?: string;
  occurredAt?: string;
  metadata?: unknown;
}

export async function sendActivitySignals(signals: ActivitySignalInput[]): Promise<void> {
  if (!getStoredWebToken() || signals.length === 0) return;
  await apiRequestStream(`/api/activity/signals`, {
    method: 'POST',
    auth: 'web',
    body: JSON.stringify({ signals }),
    keepalive: true,
    // Capture is best-effort and fires on unload — a failure here must not raise
    // the global error toast, so every status is "expected".
    expectedErrors: [400, 401, 403, 404, 429, 500, 502, 503],
  }).catch(() => { /* activity capture is best-effort */ });
}

export async function getTodayActivity(): Promise<{ signalCount: number; minutes: number; byKind: Record<string, number> }> {
  const res = await apiRequestStream(`/api/activity/today`, { auth: 'web' });
  return jsonOrThrow(res, 'Failed to load activity');
}

// ---- Worker: respond to an invite/interview -----------------------------
export async function respondEngagement(id: string, accept: boolean): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/${id}/respond`, { method: 'POST', auth: 'web', body: JSON.stringify({ accept }) });
  await jsonOrThrow(res, 'Failed to respond');
}

// ---- Two-way reviews -----------------------------------------------------
export async function reviewFreelancer(engagementId: string, rating: number, comment?: string, wouldWorkAgain?: boolean): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/${engagementId}/review`, { method: 'POST', auth: 'tenant', body: JSON.stringify({ rating, comment, wouldWorkAgain }) });
  await jsonOrThrow(res, 'Failed to submit review');
}

/** Freelancer rates the CLIENT (reverse direction) for an engagement they were hired on. */
export async function reviewClient(engagementId: string, rating: number, comment?: string, wouldWorkAgain?: boolean): Promise<void> {
  const res = await apiRequestStream(`/api/engagements/${engagementId}/review-client`, { method: 'POST', auth: 'web', body: JSON.stringify({ rating, comment, wouldWorkAgain }) });
  await jsonOrThrow(res, 'Failed to submit review');
}

// ---- Worker: engagement board (delivering work) -------------------------
export async function listEngagementBoard(): Promise<EngagementBoard[]> {
  const res = await apiRequestStream(`/api/engagement-board`, { auth: 'web' });
  const { engagements } = await jsonOrThrow<{ engagements: EngagementBoard[] }>(res, 'Failed to load engagements');
  return engagements;
}

export async function listEngagementTasks(engagementId: string): Promise<EngagementTask[]> {
  const res = await apiRequestStream(`/api/engagement-board/${engagementId}/tasks`, { auth: 'web' });
  const { tasks } = await jsonOrThrow<{ tasks: EngagementTask[] }>(res, 'Failed to load tasks');
  return tasks;
}

export async function requestReview(engagementId: string, taskId: number): Promise<void> {
  const res = await apiRequestStream(`/api/engagement-board/${engagementId}/tasks/${taskId}/request-review`, { method: 'POST', auth: 'web' });
  await jsonOrThrow(res, 'Failed to request review');
}

// ---- Meetings (employer schedules a review / interview) ------------------
export async function scheduleMeeting(input: {
  title: string; kind: 'review' | 'interview'; scheduledAt?: string; durationMinutes?: number;
  ticketId?: number; jobId?: string; engagementId?: string; projectId?: number;
}): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/meetings`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to schedule meeting');
}

