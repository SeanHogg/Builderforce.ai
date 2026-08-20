/**
 * Model-assisted résumé work — the typed client for `/api/career-ai/*`.
 *
 * Its own module rather than a section of `builderforceApi.ts` for the reason
 * `referencesApi.ts` is its own module: this is one bounded surface with one audience,
 * and the shared client is already on the oversized-file allowlist.
 *
 * Every call carries the WORKSPACE token (the transport's default), because the model
 * spend, the plan resolution and the review queue are all workspace-scoped — a review
 * request is read by colleagues, and a person-level token names no workspace to file it
 * under.
 *
 * The shapes below mirror `api/src/application/career/resumeAiPrompts.ts` field for
 * field, including the ones a hopeful client would rather not model: `accepted`,
 * `refusedBecause` and `inventedNumbers` are the API telling the UI that a rewrite was
 * thrown away for asserting a figure the résumé does not contain. A client that typed
 * only the happy shape would render a fabricated metric as a suggestion.
 */
import { apiRequest } from '@/lib/apiClient';

/** "accomplished [X] as measured by [Y], by doing [Z]". */
export type XyzPart = 'X' | 'Y' | 'Z';

export type ScoreCategoryKey = 'ats' | 'content' | 'keywords' | 'format' | 'impact';

export interface ScoreCategory {
  key: ScoreCategoryKey;
  label: string;
  score: number;
  /** The measurement the score came from, in words a person can check. */
  evidence: string;
}

export interface ResumeScore {
  overall: number;
  categories: ScoreCategory[];
  strengths: string[];
  weaknesses: string[];
  recommendations: Array<{ title: string; detail: string; priority: 'high' | 'medium' | 'low' }>;
  measured: {
    words: number;
    bullets: number;
    quantifiedBullets: number;
    strongOpeners: number;
    weakOpeners: number;
    skills: number;
    sections: string[];
    dateStyles: string[];
  };
}

/** Why a piece of generated prose was discarded. */
export type RefusalReason = 'invented_metric' | 'unchanged' | 'empty' | 'not_answered';

export interface XyzRewrite {
  id: number;
  original: string;
  /** '' when the rewrite was refused — the original stands. */
  rewritten: string;
  /** Re-measured from the text that was actually written, never the model's claim. */
  missing: XyzPart[];
  accepted: boolean;
  refusedBecause?: RefusalReason;
  inventedNumbers?: string[];
  /** The question to put to the person, when something is still missing. */
  ask: string;
}

export interface XyzCandidate {
  id: number;
  original: string;
  section: string;
  missing: XyzPart[];
  reason: string;
}

export interface AiProvenance {
  model: string | null;
  /** True when only the deterministic half is present — the model call did not land. */
  degraded: boolean;
  degradedReason?: string;
  cached: boolean;
}

export interface XyzRewriteOutcome extends AiProvenance {
  brief: {
    score: ResumeScore;
    candidates: XyzCandidate[];
    evidence: string[];
    alreadyStrong: number;
    deferred: number;
  };
  result: {
    rewrites: XyzRewrite[];
    accepted: number;
    refusedForInventedMetric: number;
    instruction: string;
  };
}

export interface MergedBullet {
  id: number;
  variants: string[];
  merged: string;
  accepted: boolean;
  refusedBecause?: RefusalReason;
  inventedNumbers?: string[];
  /** The strongest existing variant, which stands when the merge was refused. */
  fallback: string;
}

export interface BulletMergeOutcome extends AiProvenance {
  brief: {
    consolidation: { sourceCount: number; duplicateGroups: Array<{ canonical: string; variants: string[] }>; uniqueBullets: string[]; mergedSkills: string[] };
    groups: Array<{ id: number; variants: string[] }>;
  };
  result: {
    merged: MergedBullet[];
    accepted: number;
    refusedForInventedMetric: number;
    uniqueBullets: string[];
    mergedSkills: string[];
    instruction: string;
  };
}

export interface GradeGap {
  gap: string;
  costsPoints: number | null;
  evidence: string;
}

export interface GradedCategory {
  key: ScoreCategoryKey;
  label: string;
  /** The count-derived score. Stable across calls. */
  measuredScore: number;
  /** The model's. Null when it did not grade this category. */
  modelScore: number | null;
  delta: number | null;
  disagrees: boolean;
  evidence: string;
  gaps: GradeGap[];
}

export interface ResumeGrade {
  measured: ResumeScore;
  modelOverall: number | null;
  categories: GradedCategory[];
  disagreements: string[];
  verdict: string;
}

export interface ResumeGradeOutcome extends AiProvenance {
  grade: ResumeGrade;
}

export type ResumeReviewStatus = 'open' | 'in_review' | 'answered' | 'closed';

export interface ResumeReviewMessage {
  id: number;
  authorKind: string;
  authorRef: string | null;
  role: string;
  body: string;
  createdAtISO: string;
  /** Present only on the model's own messages. */
  grade: ResumeGrade | null;
  mine: boolean;
}

export interface ResumeReviewSummary {
  id: string;
  title: string;
  status: ResumeReviewStatus;
  lastMessageAtISO: string | null;
  messageCount: number;
  unread: number;
  participants: string[];
}

export interface ResumeReviewThread extends ResumeReviewSummary {
  /** The document as it stood when the question was asked — frozen on purpose. */
  resumeText: string;
  jobDescription: string;
  measuredScoreAtRequest: number;
  messages: ResumeReviewMessage[];
}

export const careerAiApi = {
  rewriteBullets: (resumeText: string, limit?: number): Promise<XyzRewriteOutcome> =>
    apiRequest('/api/career-ai/rewrite-bullets', {
      method: 'POST', body: JSON.stringify({ resumeText, ...(limit == null ? {} : { limit }) }),
    }),

  mergeBullets: (resumeTexts: string[]): Promise<BulletMergeOutcome> =>
    apiRequest('/api/career-ai/merge-bullets', { method: 'POST', body: JSON.stringify({ resumeTexts }) }),

  grade: (resumeText: string, jobDescription?: string): Promise<ResumeGradeOutcome> =>
    apiRequest('/api/career-ai/grade', {
      method: 'POST', body: JSON.stringify({ resumeText, ...(jobDescription ? { jobDescription } : {}) }),
    }),

  reviews: (status?: ResumeReviewStatus): Promise<{ reviews: ResumeReviewSummary[]; statuses: ResumeReviewStatus[]; unread: number }> =>
    apiRequest(`/api/career-ai/reviews${status ? `?status=${encodeURIComponent(status)}` : ''}`),

  openReview: (input: { title: string; resumeText: string; jobDescription?: string; note?: string }): Promise<{ review: ResumeReviewThread }> =>
    apiRequest('/api/career-ai/reviews', { method: 'POST', body: JSON.stringify(input) }),

  review: (id: string): Promise<{ review: ResumeReviewThread }> =>
    apiRequest(`/api/career-ai/reviews/${encodeURIComponent(id)}`),

  reply: (id: string, body: string, status?: ResumeReviewStatus): Promise<{ review: ResumeReviewThread }> =>
    apiRequest(`/api/career-ai/reviews/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify({ body, ...(status ? { status } : {}) }),
    }),

  setStatus: (id: string, status: ResumeReviewStatus): Promise<{ review: ResumeReviewThread }> =>
    apiRequest(`/api/career-ai/reviews/${encodeURIComponent(id)}/status`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),

  askModel: (id: string): Promise<{ review: ResumeReviewThread }> =>
    apiRequest(`/api/career-ai/reviews/${encodeURIComponent(id)}/ai`, { method: 'POST' }),

  markRead: (id: string): Promise<{ ok: boolean }> =>
    apiRequest(`/api/career-ai/reviews/${encodeURIComponent(id)}/read`, { method: 'POST' }),
};
