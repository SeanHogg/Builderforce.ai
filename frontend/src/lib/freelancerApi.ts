/**
 * Freelance marketplace API client.
 *
 * Worker-facing calls use the WEB token (a freelancer may have no tenant); employer
 * engagement + timecard-approval calls use the TENANT token. All endpoints live in
 * the api worker (see api/src/presentation/routes/freelancerRoutes.ts + activityRoutes.ts).
 */
import { getStoredWebToken } from './auth';
import type { MilestoneDraft, MilestoneRow } from './milestonesApi';
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import type {
  CanvasResumeFamily,
  ResumePrivacy as ResumePrivacyLevel,
  ResumeTemplateId,
} from '@builderforce/creation-canvas-contract';

export type { ResumePrivacyLevel, ResumeTemplateId, CanvasResumeFamily };

const MY_PROFILE_CACHE_KEY = 'talent-profile:mine';

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

/** The seniority a posting is pitched at (0985). */
export const EXPERIENCE_LEVELS = ['entry', 'intermediate', 'expert'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** Expected duration. `ongoing` is the absence of an end, not a length. */
export const PROJECT_LENGTHS = ['lt_1_month', '1_3_months', '3_6_months', 'gt_6_months', 'ongoing'] as const;
export type ProjectLength = (typeof PROJECT_LENGTHS)[number];

/**
 * The category tree, as DATA — mirroring `api/src/application/marketplace/jobFilters.ts`.
 *
 * Deepening the tree is an edit to this literal and to its server twin, never a
 * migration: `job_postings.specialty` is a plain column that stores whichever leaf the
 * registry named. The two copies exist because a browser cannot import a Worker module;
 * they are asserted equal by neither side, so the server is the authority and this list
 * is what the picker OFFERS.
 */
export const JOB_SPECIALTIES: Record<string, readonly string[]> = {
  developer: ['frontend', 'backend', 'fullstack', 'mobile', 'games', 'embedded', 'blockchain', 'ai_engineering'],
  dba: ['postgres', 'mysql', 'sql_server', 'nosql', 'data_warehouse'],
  designer: ['product_design', 'brand_identity', 'motion', 'illustration', 'ux_research', 'presentation'],
  devops: ['cloud_infrastructure', 'kubernetes', 'ci_cd', 'observability', 'cost_optimisation'],
  qa: ['manual_testing', 'test_automation', 'performance_testing', 'accessibility'],
  pm: ['product_management', 'delivery_management', 'business_analysis', 'scrum_coaching'],
  data: ['data_engineering', 'analytics', 'machine_learning', 'data_science', 'bi_reporting'],
  security: ['appsec', 'penetration_testing', 'compliance', 'incident_response'],
  other: ['technical_writing', 'devrel', 'localisation', 'support'],
};

/** One question every bidder on a posting is asked. */
export interface ScreeningQuestion {
  id: string;
  prompt: string;
  type: 'text' | 'yes_no' | 'number';
  required: boolean;
}

/** A bidder's answer, carrying the prompt AS ASKED so a later edit to the posting cannot
 *  rewrite the question this person actually answered. */
export interface ScreeningAnswer {
  questionId: string;
  prompt: string;
  answer: string;
}

/** A file on a posting or a proposal. Metadata only — the bytes are streamed from the
 *  attachment route, never embedded. */
export interface PostingAttachment {
  id: string;
  key: string;
  name: string;
  mime: string | null;
  size: number;
}

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
  /** The WHOLE-JOB total for fixed-price work. Never a rate: `rateMinCents`/`rateMaxCents`
   *  are a per-hour band, and `engagementType` says which of the two to read. */
  budgetTotalCents?: number | null;
  experienceLevel?: ExperienceLevel | null;
  projectLength?: ProjectLength | null;
  /** The sub-category beneath `discipline` (0985). */
  specialty?: string | null;
  screeningQuestions?: ScreeningQuestion[];
  attachments?: PostingAttachment[];
  proposalCount?: number;
  createdAt: string | null;
  myProposal?: { id: string; status: string; milestones?: MilestoneRow[] } | null;
  /** The invite the VIEWER holds on this posting, when they hold one. Present on the
   *  detail read so the page can offer "accept and bid" instead of a bare bid button. */
  myInvite?: JobInvite | null;
  /** The posting's PUBLISHED payment schedule — part of the offer, returned on detail. */
  milestones?: MilestoneRow[];
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
  /** The bidder's answers to the posting's screening questions. */
  screeningAnswers?: ScreeningAnswer[];
  /** Work samples the bidder attached. */
  attachments?: PostingAttachment[];
  /** The payment schedule this bidder COUNTER-PROPOSED, on the surfaces that read it.
   *  Absent (rather than empty) where schedules were not loaded, so a caller can tell
   *  "proposed nothing" from "not asked for". Accepting the bid binds this schedule in
   *  preference to the posting's — see `bindScheduleToEngagement`. */
  milestones?: MilestoneRow[];
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
export interface JobBrowseFilters {
  q?: string;
  discipline?: string;
  skill?: string;
  /** 0985 — the four criteria the browse surface and the alert sweep now share. */
  specialty?: string;
  experienceLevel?: string;
  projectLength?: string;
  engagementType?: string;
}

export async function listJobs(filters: JobBrowseFilters = {}): Promise<JobPosting[]> {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.discipline) p.set('discipline', filters.discipline);
  if (filters.skill) p.set('skill', filters.skill);
  if (filters.specialty) p.set('specialty', filters.specialty);
  if (filters.experienceLevel) p.set('experienceLevel', filters.experienceLevel);
  if (filters.projectLength) p.set('projectLength', filters.projectLength);
  if (filters.engagementType) p.set('engagementType', filters.engagementType);
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

export interface JobPostingDraft {
  title: string;
  description?: string;
  requirements?: string;
  discipline?: string;
  specialty?: string;
  skills?: string[];
  postingType?: PostingType;
  engagementType?: EngagementType;
  rateMinCents?: number;
  rateMaxCents?: number;
  /** Fixed-price TOTAL. The API refuses this on hourly work rather than storing a number
   *  whose unit contradicts the posting's shape. */
  budgetTotalCents?: number;
  experienceLevel?: ExperienceLevel;
  projectLength?: ProjectLength;
  screeningQuestions?: Array<Omit<ScreeningQuestion, 'id'> & { id?: string }>;
  projectId?: number;
  visibility?: 'public' | 'private';
  /** When present, the posting is the one this ticket owns — created or reopened, never
   *  duplicated. The same service `POST /api/marketplace/publish` calls. */
  sourceTicketId?: number;
}

export async function postJob(input: JobPostingDraft): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/jobs`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to post job');
}

export async function updateJob(id: string, patch: Partial<JobPostingDraft> & { status?: string }): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${id}`, { method: 'PATCH', auth: 'tenant', body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to update job');
}

export async function listJobProposals(jobId: string): Promise<JobProposal[]> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/proposals`, { auth: 'tenant' });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load proposals');
}

export async function bidJob(
  jobId: string,
  // `milestones` is the bidder's COUNTER-OFFER: deliverables and amounts they propose
  // instead of (or in the absence of) the posting's published schedule. Sent WITH the
  // bid rather than written afterwards, because the proposal row does not exist until
  // this call returns and a two-step would leave a bid whose schedule never landed.
  input: { coverNote?: string; rateCents?: number; milestones?: MilestoneDraft[]; screeningAnswers?: Array<{ questionId: string; answer: string }> },
): Promise<{ id: string; proposedMilestones?: number }> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/proposals`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to submit proposal');
}

export async function listMyProposals(): Promise<JobProposal[]> {
  const res = await apiRequestStream(`/api/jobs/proposals/mine`, { auth: 'web' });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load proposals');
}

// ---- Job seeker: saved jobs, alerts, and reading a job description -------------

/** Jobs the seeker shortlisted. A saved job is a proposal in the `saved` state, so
 *  saving and applying are one lifecycle rather than two tables that can disagree. */
export async function listSavedJobs(): Promise<JobProposal[]> {
  const res = await apiRequestStream(`/api/jobs/saved`, { auth: 'web' });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load saved jobs');
}

export async function saveJob(jobId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/save`, { method: 'POST', auth: 'web' });
  await jsonOrThrow(res, 'Failed to save job');
}

export async function unsaveJob(jobId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/save`, { method: 'DELETE', auth: 'web' });
  await jsonOrThrow(res, 'Failed to remove saved job');
}

/** A standing search that tells the seeker when matching work appears. */
export interface JobAlert {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  resultCount: number | null;
}

export async function listJobAlerts(): Promise<JobAlert[]> {
  const res = await apiRequestStream(`/api/jobs/alerts`, { auth: 'web' });
  return jsonOrThrow<JobAlert[]>(res, 'Failed to load alerts');
}

export async function createJobAlert(input: { name: string; filters?: Record<string, unknown>; enabled?: boolean }): Promise<JobAlert> {
  const res = await apiRequestStream(`/api/jobs/alerts`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow<JobAlert>(res, 'Failed to create alert');
}

export async function updateJobAlert(id: string, patch: { name?: string; filters?: Record<string, unknown>; enabled?: boolean }): Promise<JobAlert> {
  const res = await apiRequestStream(`/api/jobs/alerts/${id}`, { method: 'PATCH', auth: 'web', body: JSON.stringify(patch) });
  return jsonOrThrow<JobAlert>(res, 'Failed to update alert');
}

export async function deleteJobAlert(id: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/alerts/${id}`, { method: 'DELETE', auth: 'web' });
  await jsonOrThrow(res, 'Failed to delete alert');
}

/** A job description read out of pasted text or an uploaded file. */
export interface JobDescriptionDocument {
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: 'remote' | 'hybrid' | 'onsite' | null;
  employmentType: string | null;
  salaryText: string | null;
  requirements: string[];
  responsibilities: string[];
  benefits: string[];
  skills: string[];
  text: string;
}

/** How the seeker's résumé scores against one posting, and what to change. */
export interface JobExtractResult {
  job: JobDescriptionDocument;
  match: { score: number; matched: string[]; missing: string[]; summary?: string } | null;
  tailor: { changes: Array<{ section?: string; action?: string; detail?: string }>; summary?: string } | null;
}

/** Read a JD from pasted text, or from an uploaded file when `source` is a File. */
export async function extractJobDescription(source: string | File): Promise<JobExtractResult> {
  const init = source instanceof File
    ? { method: 'POST' as const, auth: 'web' as const, body: (() => { const fd = new FormData(); fd.append('file', source); return fd; })() }
    : { method: 'POST' as const, auth: 'web' as const, body: JSON.stringify({ text: source }) };
  const res = await apiRequestStream(`/api/jobs/extract`, init);
  return jsonOrThrow<JobExtractResult>(res, 'Failed to read job description');
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

// ---- Notifications feed --------------------------------------------------
export async function listNotifications(): Promise<{ unread: number; items: Notification[] }> {
  const res = await apiRequestStream(`/api/notifications`, { auth: 'web' });
  return jsonOrThrow(res, 'Failed to load notifications');
}

export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const res = await apiRequestStream(`/api/notifications/read`, { method: 'POST', auth: 'web', body: JSON.stringify({ ids }) });
  await jsonOrThrow(res, 'Failed');
}


// ---- Attachments (0985) --------------------------------------------------
//
// Uploaded to the SAME R2 bucket the résumé and avatar uploads use — there is no second
// blob store, and there is deliberately no direct-to-bucket URL: an attachment is served
// only after its id has been found on a row the caller is entitled to read.

export async function uploadJobAttachment(jobId: string, file: File): Promise<{ attachment: PostingAttachment; attachments: PostingAttachment[] }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiRequestStream(`/api/jobs/${jobId}/attachments`, { method: 'POST', auth: 'tenant', body: fd });
  return jsonOrThrow(res, 'Failed to attach file');
}

/**
 * Fetch one attachment's bytes and hand back an object URL.
 *
 * NOT an `<a href>` to the API route: the attachment endpoints are authenticated, and a
 * plain link carries no Bearer token — it would 401 for the very people entitled to the
 * file. Fetching through the same transport as every other call and wrapping the blob is
 * what makes "open the brief" work for a signed-in client and impossible for anybody
 * else. The caller MUST revoke the URL when it is finished with it.
 */
async function attachmentObjectUrl(path: string, auth: 'tenant' | 'web'): Promise<string> {
  const res = await apiRequestStream(path, { auth });
  if (!res.ok) throw new Error('Failed to open attachment');
  return URL.createObjectURL(await res.blob());
}

/** A posting's brief. As public as the posting's description — a bidder who can read the
 *  scope must be able to read the spec they are being asked to price. */
export function openJobAttachment(jobId: string, attachmentId: string): Promise<string> {
  return attachmentObjectUrl(`/api/jobs/${jobId}/attachments/${attachmentId}`, 'web');
}

export function openProposalAttachmentAsEmployer(jobId: string, proposalId: string, attachmentId: string): Promise<string> {
  return attachmentObjectUrl(`/api/jobs/${jobId}/proposals/${proposalId}/attachments/${attachmentId}`, 'tenant');
}

/** The BIDDER reading back their own work sample. */
export function openMyProposalAttachment(proposalId: string, attachmentId: string): Promise<string> {
  return attachmentObjectUrl(`/api/jobs/proposals/${proposalId}/attachments/${attachmentId}`, 'web');
}

export async function deleteJobAttachment(jobId: string, attachmentId: string): Promise<{ attachments: PostingAttachment[] }> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/attachments/${attachmentId}`, { method: 'DELETE', auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to remove attachment');
}

export async function uploadProposalAttachment(proposalId: string, file: File): Promise<{ attachment: PostingAttachment; attachments: PostingAttachment[] }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiRequestStream(`/api/jobs/proposals/${proposalId}/attachments`, { method: 'POST', auth: 'web', body: fd });
  return jsonOrThrow(res, 'Failed to attach file');
}

export async function deleteProposalAttachment(proposalId: string, attachmentId: string): Promise<{ attachments: PostingAttachment[] }> {
  const res = await apiRequestStream(`/api/jobs/proposals/${proposalId}/attachments/${attachmentId}`, { method: 'DELETE', auth: 'web' });
  return jsonOrThrow(res, 'Failed to remove attachment');
}

// ---- Job invites (0985) --------------------------------------------------

/** An invitation to ONE named freelancer to bid on ONE posting. A state machine with an
 *  expiry and an outcome — not a notification. */
export interface JobInvite {
  id: string;
  jobId: string;
  jobTitle: string | null;
  tenantId: number;
  tenantName: string | null;
  freelancerUserId: string;
  freelancerName: string | null;
  message: string | null;
  status: 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired';
  expiresAt: string | null;
  respondedAt: string | null;
  /** The proposal an acceptance opened — the reason this lands in the bid flow. */
  proposalId: string | null;
  createdAt: string | null;
}

/** The invitee's side of the marketplace. */
export async function listMyInvites(liveOnly = false): Promise<JobInvite[]> {
  const res = await apiRequestStream(`/api/jobs/invites/mine${liveOnly ? '?live=1' : ''}`, { auth: 'web' });
  return jsonOrThrow<JobInvite[]>(res, 'Failed to load invitations');
}

export async function markInviteViewed(inviteId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/invites/${inviteId}/viewed`, { method: 'POST', auth: 'web' });
  await jsonOrThrow(res, 'Failed');
}

/** Accept or decline. Accepting returns the `proposalId` it opened, so the caller can go
 *  straight to the bid form rather than back to a list. */
export async function respondToInvite(inviteId: string, accept: boolean): Promise<{ invite: JobInvite; proposalId: string | null }> {
  const res = await apiRequestStream(`/api/jobs/invites/${inviteId}/respond`, { method: 'POST', auth: 'web', body: JSON.stringify({ accept }) });
  return jsonOrThrow(res, 'Failed to respond to the invitation');
}

/** The employer's side: who this posting has invited, and what they said. */
export async function listJobInvites(jobId: string): Promise<JobInvite[]> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/invites`, { auth: 'tenant' });
  return jsonOrThrow<JobInvite[]>(res, 'Failed to load invitations');
}

export async function inviteToJob(jobId: string, input: { freelancerUserId: string; message?: string; expiresInDays?: number }): Promise<JobInvite> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/invites`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow<JobInvite>(res, 'Failed to send the invitation');
}

export async function withdrawJobInvite(jobId: string, inviteId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/invites/${inviteId}`, { method: 'DELETE', auth: 'tenant' });
  await jsonOrThrow(res, 'Failed to withdraw the invitation');
}

// ---- Saved talent — the client's shortlist (0985) -------------------------

export interface SavedTalentEntry {
  id: string;
  freelancerUserId: string;
  listName: string;
  note: string | null;
  createdAt: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  discipline: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  currency: string;
  availability: string | null;
  rating: number | null;
  ratingCount: number;
}

export async function listSavedTalent(list?: string): Promise<{ items: SavedTalentEntry[]; lists: Array<{ name: string; count: number }> }> {
  const res = await apiRequestStream(`/api/marketplace/saved-talent${list ? `?list=${encodeURIComponent(list)}` : ''}`, { auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to load your shortlist');
}

export async function saveTalent(input: { freelancerUserId: string; list?: string; note?: string }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/marketplace/saved-talent`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to shortlist');
}

export async function unsaveTalent(freelancerUserId: string, list?: string): Promise<void> {
  const res = await apiRequestStream(`/api/marketplace/saved-talent/${freelancerUserId}${list ? `?list=${encodeURIComponent(list)}` : ''}`, { method: 'DELETE', auth: 'tenant' });
  await jsonOrThrow(res, 'Failed to remove from your shortlist');
}

// ---- Recommendations — the cached match query, both directions ------------

/** Why a match ranked where it did. A CODE, localised by the UI: the server never
 *  assembles an English sentence for a five-language product. */
export interface MatchReason {
  code: 'skills' | 'discipline' | 'specialty' | 'rate' | 'reputation' | 'available' | 'shape';
  points: number;
}

export interface TalentMatch {
  freelancerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  discipline: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  currency: string;
  availability: string | null;
  rating: number | null;
  ratingCount: number;
  completedEngagements: number;
  score: number;
  reasons: MatchReason[];
  matchedSkills: string[];
  missingSkills: string[];
  invited: boolean;
}

export interface PostingMatch {
  id: string;
  title: string;
  description: string | null;
  tenantId: number;
  tenantName: string | null;
  discipline: string | null;
  specialty: string | null;
  skills: string[];
  engagementType: EngagementType | null;
  experienceLevel: ExperienceLevel | null;
  projectLength: ProjectLength | null;
  rateMinCents: number | null;
  rateMaxCents: number | null;
  budgetTotalCents: number | null;
  currency: string;
  createdAt: string | null;
  score: number;
  reasons: MatchReason[];
  matchedSkills: string[];
  missingSkills: string[];
}

/** Who should be invited to bid on this posting. */
export async function listJobRecommendations(jobId: string): Promise<TalentMatch[]> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/recommendations`, { auth: 'tenant' });
  return jsonOrThrow<TalentMatch[]>(res, 'Failed to load recommendations');
}

/** What this freelancer should bid on. */
export async function listRecommendedJobs(): Promise<PostingMatch[]> {
  const res = await apiRequestStream(`/api/jobs/recommended`, { auth: 'web' });
  return jsonOrThrow<PostingMatch[]>(res, 'Failed to load recommendations');
}

// ---- The proposal-evaluation insights lens (0985) -------------------------

export interface EvalBand { from: number; to: number; count: number }

export interface EvalLensRow {
  proposalId: string;
  cachedOverall: number | null;
  latestOverall: number | null;
  method: 'llm' | 'lexical' | null;
  evaluatedAt: string | null;
  /** |cached − latest|. Non-zero means a list is showing a number the evidence no longer
   *  supports — the reading that decides whether the rest of the lens means anything. */
  drift: number;
}

export interface ProposalEvalLens {
  proposalCount: number;
  evaluatedCount: number;
  averageOverall: number | null;
  medianOverall: number | null;
  bands: EvalBand[];
  methodSplit: { llm: number; lexical: number };
  totalRuns: number;
  driftedCount: number;
  maxDrift: number;
  rows: EvalLensRow[];
}

export async function getProposalEvalLens(jobId: string): Promise<ProposalEvalLens> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/evaluations`, { auth: 'tenant' });
  return jsonOrThrow<ProposalEvalLens>(res, 'Failed to load evaluation insights');
}
