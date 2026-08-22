/**
 * JOB POSTINGS and the proposals against them — the demand side.
 *
 * A posting is one shape offered to three kinds of demand (`postingType`: an open
 * project bid, a design gig, a full-time role), and a proposal is the answer to
 * it. Screening questions, attachments and the AI evaluation scores belong here
 * because they are parts of a posting or of a proposal, not surfaces of their own.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { apiRequestStream, jsonOrThrow } from './transport';
import type { MilestoneDraft, MilestoneRow } from '@/lib/milestonesApi';
import type { JobInvite } from './invites';

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

