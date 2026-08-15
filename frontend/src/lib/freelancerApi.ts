/**
 * Freelance marketplace API client.
 *
 * Worker-facing calls use the WEB token (a freelancer may have no tenant); employer
 * engagement + timecard-approval calls use the TENANT token. All endpoints live in
 * the api worker (see api/src/presentation/routes/freelancerRoutes.ts + activityRoutes.ts).
 */
import { getStoredWebToken } from './auth';
import { apiRequestStream, type AuthMode } from './apiClient';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import type {
  CanvasResumeFamily,
  ResumePrivacy as ResumePrivacyLevel,
  ResumeTemplateId,
} from '@builderforce/creation-canvas-contract';

export type { ResumePrivacyLevel, ResumeTemplateId, CanvasResumeFamily };

const MY_PROFILE_CACHE_KEY = 'talent-profile:mine';

/**
 * Which credential a messaging call carries. A freelancer may have no workspace
 * at all, so their side of a conversation uses the person-level web JWT while the
 * employer's side uses the workspace JWT.
 */
const authFor = (side: MessagingSide): AuthMode => (side === 'freelancer' ? 'web' : 'tenant');

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
  /** Career intent (0462) — the SAME listing, offered to two kinds of demand.
   *
   *  A full-time job is a `job_postings` row with postingType 'fte' and an application
   *  is a `job_proposals` row, so employment needed no second profile and no second
   *  pipeline — only the supply side saying which kind of demand it wants. `seeking`
   *  is that statement; the rest are what an employment search matches on. */
  seeking?: 'services' | 'employment' | 'both' | 'not_looking';
  targetRoles?: string[];
  seniority?: string | null;
  desiredSalaryMinCents?: number | null;
  desiredSalaryMaxCents?: number | null;
  workMode?: 'remote' | 'hybrid' | 'onsite' | null;
  noticePeriodDays?: number | null;
  openToRelocation?: boolean;
  hasResume?: boolean;
  published?: boolean;
  /** Summary of the OWNER's résumé object (own profile only). The full revision
   *  family is fetched separately by `getMyResume`. */
  resume?: ProfileResumeSummary | null;
  /** True when the stored résumé parsed into something we can prefill fields from. */
  canAutofill?: boolean;
  email?: string;
  /** The PUBLIC résumé projection on someone else's profile — one revision, no history. */
  publicResume?: PublicResume | null;
  rating?: number | null;
  ratingCount?: number;
  /** Trust badge + JSS on the BROWSE projection (detail carries them under `stats`). */
  badge?: 'top_rated' | 'rising_talent' | null;
  jss?: number | null;
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
  /** Average received (employer→freelancer) rating, or null when never reviewed. */
  avgReceivedRating: number | null;
  /** Number of received reviews. */
  reviewCount: number;
  /** Job Success Score 0..100 — null until there are 2+ reviews to score honestly. */
  jss: number | null;
  /** Derived trust badge from JSS + track record. */
  badge: 'top_rated' | 'rising_talent' | null;
}

export interface FreelancerReview {
  rating: number;
  comment: string | null;
  createdAt: string | null;
  reviewerName: string | null;
}

/** How a job is posted: an open project bid, a design gig, or a full-time role. */
export type PostingType = 'project_bid' | 'design' | 'fte';
/** How the work is billed once hired. */
export type EngagementType = 'fixed_bid' | 'hourly' | 'fte';

/** RAG-style AI evaluation scores (0..1) plus a 0..100 headline the UI shows as a chip. */
export interface EvalScores {
  faithfulness: number;
  answerRelevance: number;
  contextRelevance: number;
  hallucinationRate: number;
  overall: number;
  method: string;
  overall100: number;
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
  /** Marketplace posting shape — returned by GET /api/jobs/mine and /:id. */
  postingType?: PostingType | null;
  engagementType?: EngagementType | null;
  requirements?: string | null;
  /** Work item this job was published from, when minted via /marketplace/publish. */
  sourceTicketId?: number | null;
  /** The posting client's two-way reputation (freelancer→employer reviews). */
  clientRating?: number | null;
  clientRatingCount?: number;
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
  /** Latest AI-evaluation headline score (0..100), or null when never evaluated. */
  lastEvalOverall?: number | null;
  /** Courteous note left when the proposal was declined. */
  declineReason?: string | null;
}

/** A marketplace posting attached to a work item (from /marketplace/publish). */
export interface TicketPosting {
  jobId: string;
  ticketId: number;
  title: string;
  status: 'open' | 'closed' | 'filled';
  postingType: PostingType | null;
  engagementType: EngagementType | null;
  visibility: 'public' | 'private';
  createdAt: string | null;
}

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

/** A hired freelancer's read view of an engagement's project board. */
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

/**
 * Every call in this module goes through `apiClient.apiRequestStream`, which
 * supplies the Authorization header (per `auth` mode), the locale header, the
 * emulation token, the 401→login redirect and the global error report.
 *
 * It used to build its own headers and call `fetch` directly at 72 sites, which
 * meant none of those behaviours applied here: an emulating superadmin saw their
 * own data on the whole talent/freelance surface, and the API never learned the
 * user's language. `apiRequestStream` (rather than `apiRequest`) is the right
 * seam because this module reads its own error envelopes via {@link jsonOrThrow}.
 */
async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? fallback);
  }
  return res.json() as Promise<T>;
}

// ---- Worker: own profile -------------------------------------------------

export async function getMyFreelancerProfile(): Promise<FreelancerProfile> {
  const res = await apiRequestStream(`/api/freelancers/me`, { auth: 'web' });
  return jsonOrThrow<FreelancerProfile>(res, 'Failed to load profile');
}

/** Shared wizard read: step changes reuse one profile request until a write. */
export function getMyFreelancerProfileCached(force = false): Promise<FreelancerProfile> {
  if (force) invalidateClientCache(MY_PROFILE_CACHE_KEY);
  return getOrSetClientCached(MY_PROFILE_CACHE_KEY, () => getMyFreelancerProfile());
}

export function invalidateMyFreelancerProfile(): void {
  invalidateClientCache(MY_PROFILE_CACHE_KEY);
}

export async function updateMyFreelancerProfile(patch: Partial<FreelancerProfile>): Promise<void> {
  const res = await apiRequestStream(`/api/freelancers/me`, { method: 'PATCH', auth: 'web', body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to save profile');
}

/** Summary of the résumé object a profile points at. */
export interface ProfileResumeSummary {
  objectId: string;
  title: string;
  privacy: ResumePrivacyLevel;
  templateId: ResumeTemplateId;
  revisionCount: number;
  updatedAt: string;
}

/** The owner's own résumé: the object plus its whole revision family. */
export interface MyResume {
  objectId: string;
  sessionId: string;
  title: string;
  family: CanvasResumeFamily;
}

/** What a visitor sees — one revision, no history, no source-file key. */
export interface PublicResume {
  title: string;
  family: CanvasResumeFamily;
}

export async function uploadMyResume(file: File): Promise<{ resumeTitle: string; canAutofill?: boolean }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiRequestStream(`/api/freelancers/me/resume`, { method: 'POST', auth: 'web', body: fd });
  return jsonOrThrow<{ resumeTitle: string; canAutofill?: boolean }>(res, 'Failed to upload resume');
}

/** The owner's full résumé — every revision, for the profile's viewer and editor. */
export async function getMyResume(): Promise<MyResume | null> {
  const res = await apiRequestStream(`/api/freelancers/me/resume`, { auth: 'web' });
  const body = await jsonOrThrow<{ resume: MyResume | null }>(res, 'Failed to load resume');
  return body.resume;
}

/** Choose the design, the visibility, or which variant the profile shows. */
export async function updateMyResume(patch: {
  templateId?: ResumeTemplateId;
  privacy?: ResumePrivacyLevel;
  masterRevisionId?: string;
}): Promise<{ family: CanvasResumeFamily }> {
  const res = await apiRequestStream(`/api/freelancers/me/resume`, { method: 'PATCH', auth: 'web', body: JSON.stringify(patch) });
  return jsonOrThrow<{ family: CanvasResumeFamily }>(res, 'Failed to update resume');
}

export async function uploadMyAvatar(file: File): Promise<{ avatarUrl: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiRequestStream(`/api/freelancers/me/avatar`, { method: 'POST', auth: 'web', body: fd });
  return jsonOrThrow<{ avatarUrl: string }>(res, 'Failed to upload avatar');
}

export interface SlugCheck { slug: string; valid: boolean; available: boolean; reason?: string; suggestions: string[] }

export async function checkMySlug(slug: string): Promise<SlugCheck> {
  const res = await apiRequestStream(`/api/freelancers/me/slug-check?slug=${encodeURIComponent(slug)}`, { auth: 'web' });
  return jsonOrThrow<SlugCheck>(res, 'Failed to check alias');
}

export interface ResumeSuggestions { available: boolean; headline: string | null; summary: string | null; skills: string[]; discipline: string | null }

export async function getResumeSuggestions(): Promise<ResumeSuggestions> {
  const res = await apiRequestStream(`/api/freelancers/me/resume/suggestions`, { auth: 'web' });
  return jsonOrThrow<ResumeSuggestions>(res, 'Failed to read résumé');
}

// ---- Marketplace: browse ------------------------------------------------

export interface TalentFilters { q?: string; discipline?: string; skill?: string; minRate?: number; maxRate?: number; sort?: string; page?: number; pageSize?: number }

export async function listFreelancers(filters: TalentFilters = {}): Promise<{ items: FreelancerProfile[]; total: number; page: number; pageSize: number }> {
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
  const res = await apiRequestStream(`/api/freelancers${qs ? `?${qs}` : ''}`, { auth: 'web' });
  return jsonOrThrow(res, 'Failed to load freelancers');
}

export async function getFreelancer(userId: string): Promise<FreelancerProfile> {
  const res = await apiRequestStream(`/api/freelancers/${userId}`, { auth: 'web' });
  return jsonOrThrow<FreelancerProfile>(res, 'Failed to load freelancer');
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

// ---- Jobs + proposals (bidding) -----------------------------------------
export async function listJobs(filters: { q?: string; discipline?: string; skill?: string } = {}): Promise<JobPosting[]> {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.discipline) p.set('discipline', filters.discipline);
  if (filters.skill) p.set('skill', filters.skill);
  const res = await apiRequestStream(`/api/jobs${p.toString() ? `?${p}` : ''}`, { auth: 'web' });
  return jsonOrThrow<JobPosting[]>(res, 'Failed to load jobs');
}

export async function getJob(id: string): Promise<JobPosting> {
  const res = await apiRequestStream(`/api/jobs/${id}`, { auth: 'web' });
  return jsonOrThrow<JobPosting>(res, 'Failed to load job');
}

export async function listMyJobs(): Promise<JobPosting[]> {
  const res = await apiRequestStream(`/api/jobs/mine`, { auth: 'tenant' });
  return jsonOrThrow<JobPosting[]>(res, 'Failed to load jobs');
}

export async function postJob(input: { title: string; description?: string; requirements?: string; discipline?: string; skills?: string[]; postingType?: PostingType; engagementType?: EngagementType; rateMinCents?: number; rateMaxCents?: number; projectId?: number; visibility?: 'public' | 'private' }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/jobs`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to post job');
}

export async function updateJob(id: string, patch: { status?: string; title?: string; description?: string }): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${id}`, { method: 'PATCH', auth: 'tenant', body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to update job');
}

export async function listJobProposals(jobId: string): Promise<JobProposal[]> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/proposals`, { auth: 'tenant' });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load proposals');
}

export async function bidJob(jobId: string, input: { coverNote?: string; rateCents?: number }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/proposals`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to submit proposal');
}

export async function listMyProposals(): Promise<JobProposal[]> {
  const res = await apiRequestStream(`/api/jobs/proposals/mine`, { auth: 'web' });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load proposals');
}

export async function withdrawProposal(pid: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/proposals/${pid}/withdraw`, { method: 'POST', auth: 'web' });
  await jsonOrThrow(res, 'Failed to withdraw');
}

export async function acceptProposal(pid: string): Promise<{ engagementId: string }> {
  const res = await apiRequestStream(`/api/jobs/proposals/${pid}/accept`, { method: 'POST', auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to accept proposal');
}

export async function declineProposal(pid: string, reason?: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/proposals/${pid}/decline`, { method: 'POST', auth: 'tenant', body: JSON.stringify({ reason }) });
  await jsonOrThrow(res, 'Failed to decline proposal');
}

/** Run the AI evaluator over a proposal; returns RAG scores + a 0..100 headline. */
export async function evaluateProposal(pid: string): Promise<EvalScores> {
  const res = await apiRequestStream(`/api/jobs/proposals/${pid}/evaluate`, { method: 'POST', auth: 'tenant' });
  return jsonOrThrow<EvalScores>(res, 'Failed to evaluate proposal');
}

/** Move a proposal to the shortlist (candidate advances). */
export async function shortlistProposal(pid: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/proposals/${pid}/shortlist`, { method: 'POST', auth: 'tenant' });
  await jsonOrThrow(res, 'Failed to shortlist proposal');
}

// ---- Marketplace: publish a work item -----------------------------------
export async function publishTicket(input: {
  ticketId: number; postingType?: PostingType; engagementType?: EngagementType;
  requirements?: string; rateMinCents?: number; rateMaxCents?: number; visibility?: 'public' | 'private';
}): Promise<{ jobId: string; posting: TicketPosting }> {
  const res = await apiRequestStream(`/api/marketplace/publish`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to publish to marketplace');
}

export async function unpublishTicket(ticketId: number): Promise<void> {
  const res = await apiRequestStream(`/api/marketplace/unpublish`, { method: 'POST', auth: 'tenant', body: JSON.stringify({ ticketId }) });
  await jsonOrThrow(res, 'Failed to unpublish');
}

export async function getTicketPosting(taskId: number): Promise<TicketPosting | null> {
  const res = await apiRequestStream(`/api/marketplace/ticket/${taskId}/posting`, { auth: 'tenant' });
  const { posting } = await jsonOrThrow<{ posting: TicketPosting | null }>(res, 'Failed to load posting');
  return posting;
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

// ---- Meetings (employer schedules a review / interview) ------------------
export async function scheduleMeeting(input: {
  title: string; kind: 'review' | 'interview'; scheduledAt?: string; durationMinutes?: number;
  ticketId?: number; jobId?: string; engagementId?: string; projectId?: number;
}): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/meetings`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to schedule meeting');
}

// ---- Invoices + payments -------------------------------------------------
export async function listEmployerInvoices(): Promise<Invoice[]> {
  const res = await apiRequestStream(`/api/timecards/invoices`, { auth: 'tenant' });
  return jsonOrThrow<Invoice[]>(res, 'Failed to load invoices');
}

export async function listMyInvoices(): Promise<Invoice[]> {
  const res = await apiRequestStream(`/api/timecards/invoices/mine`, { auth: 'web' });
  return jsonOrThrow<Invoice[]>(res, 'Failed to load invoices');
}

/** Settle an invoice: uses the payout provider when configured, else falls back to
 *  a manual record. Returns whether the provider path ran. */
export async function payInvoice(invId: string): Promise<{ paid: boolean; manual: boolean }> {
  const res = await apiRequestStream(`/api/timecards/invoices/${invId}/pay`, { method: 'POST', auth: 'tenant' });
  if (res.status === 409) { // no payout provider — fall back to manual record
    const m = await apiRequestStream(`/api/timecards/invoices/${invId}/mark-paid`, { method: 'POST', auth: 'tenant' });
    await jsonOrThrow(m, 'Failed to mark paid');
    return { paid: true, manual: true };
  }
  await jsonOrThrow(res, 'Failed to pay');
  return { paid: true, manual: false };
}

// ---- In-platform messaging (conversations) ------------------------------
// Two-party employer<->freelancer threads. The freelancer uses the WEB token
// (/mine endpoints); the employer uses the TENANT token. Feeds mutate on every
// send, so they are polled — never cached.

export interface ConversationSummary {
  id: string;
  tenantId: number;
  tenantName: string | null;
  freelancerUserId: string;
  freelancerName: string | null;
  employerUserId: string | null;
  subjectType: 'engagement' | 'job' | 'proposal' | 'direct';
  engagementId: string | null;
  jobId: string | null;
  proposalId: string | null;
  projectId: number | null;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  updatedAt: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string | null;
  /** True when the freelancer authored it (drives left/right bubble alignment). */
  fromFreelancer: boolean;
  body: string;
  attachmentName: string | null;
  attachmentType: string | null;
  hasAttachment: boolean;
  createdAt: string | null;
}

export type MessagingSide = 'employer' | 'freelancer';

const convBase = (side: MessagingSide, path = '') =>
  `/api/conversations${side === 'freelancer' ? '/mine' : ''}${path}`;

/** List my conversations for the given side, with per-thread + total unread counts. */
export async function listConversations(side: MessagingSide): Promise<{ items: ConversationSummary[]; unread: number }> {
  const res = await apiRequestStream(convBase(side), { auth: authFor(side) });
  return jsonOrThrow(res, 'Failed to load messages');
}

export async function getConversationThread(side: MessagingSide, id: string): Promise<{ conversation: ConversationSummary; messages: ConversationMessage[] }> {
  const res = await apiRequestStream(`/api/conversations/${side === 'freelancer' ? 'mine/' : ''}${id}/messages`, { auth: authFor(side) });
  return jsonOrThrow(res, 'Failed to load thread');
}

/** Send a message (text, and optionally an attachment) into a conversation. */
export async function sendConversationMessage(side: MessagingSide, id: string, input: { body: string; file?: File | null }): Promise<{ id: string }> {
  const url = `/api/conversations/${side === 'freelancer' ? 'mine/' : ''}${id}/messages`;
  if (input.file) {
    const fd = new FormData();
    fd.append('body', input.body);
    fd.append('file', input.file);
    const res = await apiRequestStream(url, { method: 'POST', auth: authFor(side), body: fd });
    return jsonOrThrow(res, 'Failed to send');
  }
  const res = await apiRequestStream(url, { method: 'POST', auth: authFor(side), body: JSON.stringify({ body: input.body }) });
  return jsonOrThrow(res, 'Failed to send');
}

export async function markConversationRead(side: MessagingSide, id: string): Promise<void> {
  const res = await apiRequestStream(`/api/conversations/${side === 'freelancer' ? 'mine/' : ''}${id}/read`, { method: 'POST', auth: authFor(side) });
  await jsonOrThrow(res, 'Failed');
}

/** Employer opens (or reuses) a thread with a freelancer, optionally scoped + seeded. */
export async function startEmployerConversation(input: { freelancerUserId: string; engagementId?: string; jobId?: string; proposalId?: string; subjectType?: string; title?: string; body?: string }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/conversations`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to start conversation');
}

/** Freelancer opens (or reuses) a thread with an engaged tenant. */
export async function startFreelancerConversation(input: { engagementId: string; title?: string; body?: string }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/conversations/mine`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to start conversation');
}

/** Fetch a message attachment as a blob (the serve route requires an auth header, so
 *  it can't be a plain <img src>) and hand back an object URL the caller opens/revokes. */
export async function fetchConversationAttachment(side: MessagingSide, messageId: string): Promise<string> {
  const res = await apiRequestStream(`/api/conversations/attachment/${messageId}`, { auth: authFor(side) });
  if (!res.ok) throw new Error('Failed to load attachment');
  return URL.createObjectURL(await res.blob());
}

// ---- Notifications feed --------------------------------------------------
export async function listNotifications(): Promise<{ unread: number; items: Notification[] }> {
  const res = await apiRequestStream(`/api/notifications`, { auth: 'web' });
  return jsonOrThrow(res, 'Failed to load notifications');
}

export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const res = await apiRequestStream(`/api/notifications/read`, { method: 'POST', auth: 'web', body: JSON.stringify({ ids }) });
  await jsonOrThrow(res, 'Failed');
}
