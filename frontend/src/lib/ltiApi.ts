/**
 * THE client for the two LTI Advantage service calls the canvas makes back to a
 * connected LMS — pulling a roster (NRPS) and pushing one mark (AGS).
 *
 * The routes themselves — signature verification, token exchange, the actual NRPS and
 * AGS calls — live server-side in `application/lti/LtiService.ts`; nothing here holds a
 * key or a fetch to the platform. This module is the thin, typed wrapper `apiRequest`
 * expects, kept separate from `founderOpsApi.ts` because LTI is its own bounded
 * context (an institution's LMS, not this tenant's own operations).
 */
import { apiRequest } from '@/lib/apiClient';
import type { RosterRow } from '@/lib/academic/roster';

export interface LtiRosterResult {
  roster: readonly RosterRow[];
  memberCount: number;
}

/** Pull a cohort roster through NRPS. `issuer` and `membershipsUrl` are the two values
 *  a launch (or an administrator's manual binding) puts on the `cohort` object. */
export const pullLtiRoster = (issuer: string, membershipsUrl: string) =>
  apiRequest<LtiRosterResult>('/api/lti/roster', {
    method: 'POST',
    body: JSON.stringify({ issuer, membershipsUrl }),
  });

export interface PushLtiScoreBody {
  issuer: string;
  lineItemUrl: string;
  userId: string;
  scoreGiven: number;
  scoreMaximum: number;
  comment?: string;
  /** Whether the mark is visible to the learner yet. See `AgsScore.released` — marks
   *  are commonly entered over days and released together. */
  released: boolean;
}

/** Push one mark back through AGS. */
export const pushLtiScore = (body: PushLtiScoreBody) =>
  apiRequest<{ ok: true }>('/api/lti/score', { method: 'POST', body: JSON.stringify(body) });
