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
  slug: string | null;
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
  /** True when we can auto-fill fields from the résumé (hired.video link or a cached extract). */
  canAutofill?: boolean;
  email?: string;
  embedUrl?: string | null;
  rating?: number | null;
  ratingCount?: number;
  reviews?: FreelancerReview[];
  stats?: FreelancerStats;
  updatedAt?: string | null;
}

/** Reputation numbers shown on a for-hire profile (server-computed + cached). */
export interface FreelancerStats {
  /** AI/agent-driven activity signals in the trailing 90 days. */
  aiActions: number;
  /** All activity signals in the trailing 90 days. */
  activitySignals: number;
  /** Distinct days with any activity in the trailing 90 days. */
  activeDays: number;
  /** Engagements ever hired (work won). */
  projectsAwarded: number;
  /** Engagements currently active. */
  activeEngagements: number;
  /** Open bids (proposals in submitted | shortlisted). */
  proposalsActive: number;
  /** Lifetime paid earnings, in cents. */
  earnedToDateCents: number;
  currency: string;
}

export interface FreelancerReview {
  rating: number;
  comment: string | null;
  createdAt: string | null;
  reviewerName: string | null;
}

export interface JobPosting {
  id: string;
  tenantId: number;
  tenantName: string | null;
  projectId: number | null;
  title: string;
  description: string | null;
  discipline: string | null;
  skills: string[];
  rateMinCents: number | null;
  rateMaxCents: number | null;
  currency: string;
  status: 'open' | 'closed' | 'filled';
  visibility: 'public' | 'private';
  proposalCount?: number;
  createdAt: string | null;
  myProposal?: { id: string; status: string } | null;
}

export interface JobProposal {
  id: string;
  jobId: string;
  jobTitle: string | null;
  freelancerUserId: string;
  freelancerName: string | null;
  coverNote: string | null;
  rateCents: number | null;
  currency: string;
  status: 'submitted' | 'shortlisted' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string | null;
}

export interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  ref: string | null;
  read: boolean;
  createdAt: string | null;
}

export interface Invoice {
  id: string;
  timecardId: string;
  engagementId: string;
  tenantId: number;
  tenantName?: string | null;
  freelancerName?: string | null;
  amountCents: number;
  currency: string;
  status: 'pending' | 'paid' | 'void';
  externalRef: string | null;
  issuedAt: string | null;
  paidAt: string | null;
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

export async function uploadMyResume(file: File): Promise<{ resumeFilename: string; canAutofill?: boolean }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/resume`, { method: 'POST', headers: webHeaders(false), body: fd });
  return jsonOrThrow<{ resumeFilename: string; canAutofill?: boolean }>(res, 'Failed to upload resume');
}

export async function uploadMyAvatar(file: File): Promise<{ avatarUrl: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/avatar`, { method: 'POST', headers: webHeaders(false), body: fd });
  return jsonOrThrow<{ avatarUrl: string }>(res, 'Failed to upload avatar');
}

export interface SlugCheck { slug: string; valid: boolean; available: boolean; reason?: string; suggestions: string[] }

export async function checkMySlug(slug: string): Promise<SlugCheck> {
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/slug-check?slug=${encodeURIComponent(slug)}`, { headers: webHeaders(false) });
  return jsonOrThrow<SlugCheck>(res, 'Failed to check alias');
}

export interface ResumeSuggestions { available: boolean; headline: string | null; summary: string | null; skills: string[]; discipline: string | null }

export async function getResumeSuggestions(): Promise<ResumeSuggestions> {
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/resume/suggestions`, { headers: webHeaders(false) });
  return jsonOrThrow<ResumeSuggestions>(res, 'Failed to read résumé');
}

/** Start the consent flow to connect an EXISTING hired.video account. Returns a
 *  consent URL to open (null when hired.video isn't configured server-side). */
export async function connectHiredVideo(input: { email?: string; redirectUrl?: string } = {}): Promise<{ configured: boolean; consentUrl: string | null }> {
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/connect`, { method: 'POST', headers: webHeaders(), body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to connect hired.video');
}

export async function getMyEmbedToken(kind: 'profile' | 'resume' = 'profile'): Promise<{ configured: boolean; embedUrl: string | null }> {
  const res = await fetch(`${AUTH_API_URL}/api/freelancers/me/embed-token?kind=${kind}`, { headers: webHeaders(false) });
  return jsonOrThrow(res, 'Failed to get embed token');
}

// ---- Marketplace: browse ------------------------------------------------

export interface TalentFilters { q?: string; discipline?: string; skill?: string; minRate?: number; maxRate?: number; sort?: string; page?: number; pageSize?: number }

export async function listFreelancers(filters: TalentFilters = {}): Promise<{ items: FreelancerProfile[]; total: number; page: number; pageSize: number }> {
  const token = getStoredWebToken();
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.discipline) p.set('discipline', filters.discipline);
  if (filters.skill) p.set('skill', filters.skill);
  if (filters.minRate != null) p.set('minRate', String(filters.minRate));
  if (filters.maxRate != null) p.set('maxRate', String(filters.maxRate));
  if (filters.sort) p.set('sort', filters.sort);
  if (filters.page) p.set('page', String(filters.page));
  if (filters.pageSize) p.set('pageSize', String(filters.pageSize));
  const qs = p.toString();
  const res = await fetch(`${AUTH_API_URL}/api/freelancers${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return jsonOrThrow(res, 'Failed to load freelancers');
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

export interface TimecardEntry {
  id: string;
  workDate: string;
  minutes: number;
  source: 'auto' | 'manual' | 'meeting';
  billable: boolean;
  description: string | null;
}

// Worker: view + edit the line items on a draft timecard.
export async function listTimecardEntries(id: string): Promise<TimecardEntry[]> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/entries`, { headers: webHeaders(false) });
  return jsonOrThrow<TimecardEntry[]>(res, 'Failed to load entries');
}

export async function addTimecardEntry(id: string, input: { workDate?: string; minutes: number; description?: string; billable?: boolean }): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/entries`, { method: 'POST', headers: webHeaders(), body: JSON.stringify(input) });
  await jsonOrThrow(res, 'Failed to add entry');
}

export async function updateTimecardEntry(id: string, entryId: string, patch: { minutes?: number; billable?: boolean; description?: string }): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/entries/${entryId}`, { method: 'PATCH', headers: webHeaders(), body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to update entry');
}

export async function deleteTimecardEntry(id: string, entryId: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/entries/${entryId}`, { method: 'DELETE', headers: webHeaders(false) });
  await jsonOrThrow(res, 'Failed to delete entry');
}

// Employer: the approval view (card + its entries), tenant-scoped.
export async function getTimecardReview(id: string): Promise<{ card: Timecard; entries: TimecardEntry[] }> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/${id}/review`, { headers: tenantHeaders(false) });
  return jsonOrThrow(res, 'Failed to load timecard');
}

// Worker: log a meeting as paid time (emits a billable meeting span).
export async function logMeeting(input: { engagementId: string; occurredAt?: string; durationMinutes: number; note?: string }): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/activity/meeting`, { method: 'POST', headers: webHeaders(), body: JSON.stringify(input) });
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

// ---- Worker: respond to an invite/interview -----------------------------
export async function respondEngagement(id: string, accept: boolean): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/engagements/${id}/respond`, { method: 'POST', headers: webHeaders(), body: JSON.stringify({ accept }) });
  await jsonOrThrow(res, 'Failed to respond');
}

// ---- Employer: rate a freelancer ----------------------------------------
export async function reviewFreelancer(engagementId: string, rating: number, comment?: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/engagements/${engagementId}/review`, { method: 'POST', headers: tenantHeaders(), body: JSON.stringify({ rating, comment }) });
  await jsonOrThrow(res, 'Failed to submit review');
}

// ---- Jobs + proposals (bidding) -----------------------------------------
export async function listJobs(filters: { q?: string; discipline?: string; skill?: string } = {}): Promise<JobPosting[]> {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.discipline) p.set('discipline', filters.discipline);
  if (filters.skill) p.set('skill', filters.skill);
  const token = getStoredWebToken();
  const res = await fetch(`${AUTH_API_URL}/api/jobs${p.toString() ? `?${p}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  return jsonOrThrow<JobPosting[]>(res, 'Failed to load jobs');
}

export async function getJob(id: string): Promise<JobPosting> {
  const token = getStoredWebToken();
  const res = await fetch(`${AUTH_API_URL}/api/jobs/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  return jsonOrThrow<JobPosting>(res, 'Failed to load job');
}

export async function listMyJobs(): Promise<JobPosting[]> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/mine`, { headers: tenantHeaders(false) });
  return jsonOrThrow<JobPosting[]>(res, 'Failed to load jobs');
}

export async function postJob(input: { title: string; description?: string; discipline?: string; skills?: string[]; rateMinCents?: number; rateMaxCents?: number; projectId?: number; visibility?: 'public' | 'private' }): Promise<{ id: string }> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs`, { method: 'POST', headers: tenantHeaders(), body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to post job');
}

export async function updateJob(id: string, patch: { status?: string; title?: string; description?: string }): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/${id}`, { method: 'PATCH', headers: tenantHeaders(), body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to update job');
}

export async function listJobProposals(jobId: string): Promise<JobProposal[]> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/${jobId}/proposals`, { headers: tenantHeaders(false) });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load proposals');
}

export async function bidJob(jobId: string, input: { coverNote?: string; rateCents?: number }): Promise<{ id: string }> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/${jobId}/proposals`, { method: 'POST', headers: webHeaders(), body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to submit proposal');
}

export async function listMyProposals(): Promise<JobProposal[]> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/proposals/mine`, { headers: webHeaders(false) });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load proposals');
}

export async function withdrawProposal(pid: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/proposals/${pid}/withdraw`, { method: 'POST', headers: webHeaders(false) });
  await jsonOrThrow(res, 'Failed to withdraw');
}

export async function acceptProposal(pid: string): Promise<{ engagementId: string }> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/proposals/${pid}/accept`, { method: 'POST', headers: tenantHeaders(false) });
  return jsonOrThrow(res, 'Failed to accept proposal');
}

export async function declineProposal(pid: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/jobs/proposals/${pid}/decline`, { method: 'POST', headers: tenantHeaders(false) });
  await jsonOrThrow(res, 'Failed to decline proposal');
}

// ---- Invoices + payments -------------------------------------------------
export async function listEmployerInvoices(): Promise<Invoice[]> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/invoices`, { headers: tenantHeaders(false) });
  return jsonOrThrow<Invoice[]>(res, 'Failed to load invoices');
}

export async function listMyInvoices(): Promise<Invoice[]> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/invoices/mine`, { headers: webHeaders(false) });
  return jsonOrThrow<Invoice[]>(res, 'Failed to load invoices');
}

/** Settle an invoice: uses the payout provider when configured, else falls back to
 *  a manual record. Returns whether the provider path ran. */
export async function payInvoice(invId: string): Promise<{ paid: boolean; manual: boolean }> {
  const res = await fetch(`${AUTH_API_URL}/api/timecards/invoices/${invId}/pay`, { method: 'POST', headers: tenantHeaders(false) });
  if (res.status === 409) { // no payout provider — fall back to manual record
    const m = await fetch(`${AUTH_API_URL}/api/timecards/invoices/${invId}/mark-paid`, { method: 'POST', headers: tenantHeaders(false) });
    await jsonOrThrow(m, 'Failed to mark paid');
    return { paid: true, manual: true };
  }
  await jsonOrThrow(res, 'Failed to pay');
  return { paid: true, manual: false };
}

// ---- Notifications feed --------------------------------------------------
export async function listNotifications(): Promise<{ unread: number; items: Notification[] }> {
  const res = await fetch(`${AUTH_API_URL}/api/notifications`, { headers: webHeaders(false) });
  return jsonOrThrow(res, 'Failed to load notifications');
}

export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/notifications/read`, { method: 'POST', headers: webHeaders(), body: JSON.stringify({ ids }) });
  await jsonOrThrow(res, 'Failed');
}
