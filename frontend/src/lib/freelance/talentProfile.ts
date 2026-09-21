/**
 * Talent PROFILE — the supply side's own record, and the public browse over it.
 *
 * One bounded context: who a freelancer is (identity, rates, availability, career
 * intent), the résumé object their profile points at, and the marketplace search
 * that reads those profiles. It owns `FreelancerProfile` because it is the module
 * that writes it; every other module in this folder references a freelancer by id.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { apiRequestStream, jsonOrThrow } from './transport';
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
  /**
   * Session price in CENTS — the pro-bono source of truth (#2528,
   * `freelancer_profiles.session_price_cents`).
   *
   * Three states, and they are NOT interchangeable:
   *   `0`       — volunteer / complimentary. This is what puts the Pro bono badge
   *               on a card; see `isProBonoSession`.
   *   `null`    — the advisor has not set a session price; no badge, no price row.
   *   absent    — the field is not on this payload at all (a deploy predating the
   *               #2528 migration, or an endpoint that does not select it). Optional
   *               for exactly that reason: the badge fails closed rather than
   *               forcing every caller to invent a value.
   *
   * Never coerce this (`?? 0` turns "unknown" into "free"). Never substitute
   * `hourlyRateCents` — an advisor can bill hourly and still take unpaid sessions.
   */
  sessionPriceCents?: number | null;
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
  /** True when this person hosts an active booking_service (marketplace Book). */
  bookable?: boolean;

  // ---- Advisor mode (PRD 21 / #2530 / #2527) ---------------------------
  /** Master toggle for advisor/hire-me mode. False = not in setup; no gating. */
  advisorMode?: boolean;
  /** Areas of expertise (required when advisorMode=true). */
  advisorExpertise?: string[];
  /** Industries served (optional). */
  advisorIndustries?: string[];
  /** Languages for sessions (optional). */
  advisorLanguages?: string[];
  /** Booking methods (required when advisorMode=true). */
  advisorMethods?: ('video' | 'phone' | 'email' | 'in-person')[];
  /** Business stages served (optional). */
  advisorStages?: ('start' | 'grow' | 'exit')[];
  /** Typical session length in minutes. */
  advisorSessionLengthMinutes?: number | null;
  /** Price per session in cents (0 = volunteer). */
  advisorSessionPriceCents?: number | null;
  /** Location/timezone for in-person sessions. */
  advisorLocation?: string | null;
  /** Whether sessions default to confidential. */
  advisorConfidentialityDefault?: boolean;
}

/**
 * Is this listing's session unpaid — the ONE definition of pro-bono (#2584).
 *
 * Strict `=== 0` against the JSON number, and deliberately nothing else. Every
 * other input is a hide:
 *
 *   `null` / `undefined` / absent  — unknown, not free
 *   any positive or negative int   — priced (a negative is a stale row; still hide)
 *   `NaN`, `""`, `"0"`, `"free"`   — not the number 0
 *
 * The asymmetry is the point: showing "Pro bono" on an advisor who charges is a
 * broken promise a seeker acts on, whereas omitting it on a genuine volunteer is
 * merely a missed signal. So the predicate fails CLOSED — no coercion, no `??`,
 * no `Number(...)`, no truthiness. A single exported function rather than an
 * inline check at each call site, so all card surfaces provably agree and this
 * rule can be tested once.
 */
export function isProBonoSession(sessionPriceCents: number | null | undefined): boolean {
  return sessionPriceCents === 0;
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

