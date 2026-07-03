/**
 * Freelance marketplace API client.
 *
 * Worker-facing calls use the WEB token (a freelancer may have no tenant); employer
 * engagement + timecard-approval calls use the TENANT token. All endpoints live in
 * the api worker (see api/src/presentation/routes/freelancerRoutes.ts + activityRoutes.ts).
 */
import { AUTH_API_URL, getStoredWebToken, getStoredTenantToken } from './auth';

export interface FreelancerProfile {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  discipline: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  currency: string;
  visibility: 'public' | 'private';
  availability: 'open' | 'limited' | 'unavailable';
  location: string | null;
  timezone: string | null;
  hasResume?: boolean;
  published?: boolean;
  hiredVideoConnected?: boolean;
  hiredVideoClaimUrl?: string | null;
  resumeFilename?: string | null;
  email?: string;
  embedUrl?: string | null;
  updatedAt?: string | null;
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

export interface Timecard {
  id: string;
  engagementId: string;
  tenantId: number;
  tenantName: string | null;
  freelancerName: string | null;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
  totalMinutes: number;
  billableMinutes: number;
  rateCents: number | null;
  currency: string;
  amountCents: number;
  submittedAt: string | null;
  approvedAt: string | null;
}

function webHeaders(json = true): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${getStoredWebToken() ?? ''}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
function tenantHeaders(json = true): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${getStoredTenantToken() ?? ''}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? fallback);
  }
  return res.json() as Promise<T>;
}

// ---- Worker: own profile -------------------------------------------------

export async function getMyFreelancerProfile(): Promise<FreelancerProfile> {
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me`, { headers: webHeaders(false) });
  return jsonOrThrow<FreelancerProfile>(res, 'Failed to load profile');
}

export async function updateMyFreelancerProfile(patch: Partial<FreelancerProfile>): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me`, { method: 'PATCH', headers: webHeaders(), body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to save profile');
}

export async function uploadMyResume(file: File): Promise<{ resumeFilename: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/resume`, { method: 'POST', headers: webHeaders(false), body: fd });
  return jsonOrThrow<{ resumeFilename: string }>(res, 'Failed to upload resume');
}

export async function getMyEmbedToken(kind: 'profile' | 'resume' = 'profile'): Promise<{ configured: boolean; embedUrl: string | null }> {
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/embed-token?kind=${kind}`, { headers: webHeaders(false) });
  return jsonOrThrow(res, 'Failed to get embed token');
}

// ---- Marketplace: browse ------------------------------------------------

export async function listFreelancers(): Promise<FreelancerProfile[]> {
  const token = getStoredWebToken();
  const res = await fetch(`${AUTH_API_URL}/api/freelancers`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return jsonOrThrow<FreelancerProfile[]>(res, 'Failed to load freelancers');
}

export async function getFreelancer(userId: string): Promise<FreelancerProfile> {
  const token = getStoredWebToken();
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/${userId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return jsonOrThrow<FreelancerProfile>(res, 'Failed to load freelancer');
}

// ---- Employer: engagements ----------------------------------------------

export async function hireFreelancer(input: { freelancerUserId: string; projectId?: number; rateCents?: number; title?: string; note?: string; status?: 'invited' | 'interviewing' | 'active' }): Promise<{ id: string; status: string }> {
  const res = await fetch(`${AUTH_API_URL}/api/engagements`, { method: 'POST', headers: tenantHeaders(), body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to hire');
}

export async function listEngagements(): Promise<Engagement[]> {
  const res = await fetch(`${AUTH_API_URL}/api/engagements`, { headers: tenantHeaders(false) });
  return jsonOrThrow<Engagement[]>(res, 'Failed to load engagements');
}

export async function listMyEngagements(): Promise<Engagement[]> {
  const res = await fetch(`${AUTH_API_URL}/api/engagements/mine`, { headers: webHeaders(false) });
  return jsonOrThrow<Engagement[]>(res, 'Failed to load engagements');
}

export async function updateEngagement(id: string, patch: { status?: string; rateCents?: number; title?: string }): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/engagements/${id}`, { method: 'PATCH', headers: tenantHeaders(), body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to update engagement');
}

export async function terminateEngagement(id: string, reason?: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/engagements/${id}`, { method: 'DELETE', headers: tenantHeaders(), body: JSON.stringify({ reason }) });
  await jsonOrThrow(res, 'Failed to terminate engagement');
}

// ---- Timecards ----------------------------------------------------------

export async function resolveTimecard(input: { engagementId: string; periodStart: string; periodEnd: string }): Promise<{ id: string; totalMinutes: number; billableMinutes: number }> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/resolve`, { method: 'POST', headers: webHeaders(), body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to resolve timecard');
}

export async function listMyTimecards(): Promise<Timecard[]> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/mine`, { headers: webHeaders(false) });
  return jsonOrThrow<Timecard[]>(res, 'Failed to load timecards');
}

export async function listEmployerTimecards(): Promise<Timecard[]> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards`, { headers: tenantHeaders(false) });
  return jsonOrThrow<Timecard[]>(res, 'Failed to load timecards');
}

export async function submitTimecard(id: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/submit`, { method: 'POST', headers: webHeaders(false) });
  await jsonOrThrow(res, 'Failed to submit');
}

export async function approveTimecard(id: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/approve`, { method: 'POST', headers: tenantHeaders(false) });
  await jsonOrThrow(res, 'Failed to approve');
}

export async function rejectTimecard(id: string, reason?: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/reject`, { method: 'POST', headers: tenantHeaders(), body: JSON.stringify({ reason }) });
  await jsonOrThrow(res, 'Failed to reject');
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
  const token = getStoredWebToken();
  if (!token || signals.length === 0) return;
  await fetch(`${AUTH_API_URL}/api/activity/signals`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signals }),
    keepalive: true,
  }).catch(() => { /* activity capture is best-effort */ });
}

export async function getTodayActivity(): Promise<{ signalCount: number; minutes: number; byKind: Record<string, number> }> {
  const res = await fetch(`${AUTH_API_URL}/api/activity/today`, { headers: webHeaders(false) });
  return jsonOrThrow(res, 'Failed to load activity');
}
