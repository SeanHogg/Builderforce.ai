/**
 * MATCHING — the cached match query, both directions, and the lens over its scores.
 *
 * Talent for a posting and postings for a freelancer are ONE ranking asked from
 * two ends, which is why they share `MatchReason`. The proposal-evaluation lens
 * reads the same scores in aggregate, so it belongs beside them rather than in the
 * insights folder: a band is a histogram of this module's numbers.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { apiRequestStream, jsonOrThrow } from './transport';
import type { FreelancerProfile } from './talentProfile';
import type { EngagementType, ExperienceLevel, JobPosting, ProjectLength } from './postings';

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

