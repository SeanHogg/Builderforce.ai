/**
 * THE client for co-founder matching (`/api/cofounder/*`).
 *
 * Its own module because it is its own bounded surface: a person's profile, the
 * ranked matches against it, and the introductions between two people. None of
 * it touches the founder-operations ledger `founderOpsApi.ts` is the client for
 * (forms, signatures, payables, equity, the pipeline, the data room), and no
 * founder-ops call shares a type with it.
 *
 * Goes through `apiRequest`, which is THE transport — the header contract
 * (emulation token, locale, error dispatch) is load-bearing.
 */

import { apiRequest } from '@/lib/apiClient';

export const COFOUNDER_STRENGTHS = ['technical', 'commercial', 'product', 'operations'] as const;
export type CofounderStrength = typeof COFOUNDER_STRENGTHS[number];

export const COFOUNDER_COMMITMENTS = ['full-time', 'part-time', 'nights-weekends', 'advisory'] as const;
export type CofounderCommitment = typeof COFOUNDER_COMMITMENTS[number];

export interface CofounderProfile {
  id: number;
  headline: string;
  bio: string | null;
  strength: CofounderStrength;
  seeking: CofounderStrength;
  brings: string[] | null;
  needs: string[] | null;
  commitment: CofounderCommitment;
  equityExpectation: string | null;
  location: string | null;
  remoteOk: boolean;
  sectors: string[] | null;
  stage: string | null;
  status: string;
  visibility: string;
}

export interface MatchReason {
  dimension: 'complementarity' | 'skills' | 'commitment' | 'equity' | 'location' | 'sector';
  points: number;
  detail: string;
}

export interface CofounderMatch {
  profileId: number;
  headline: string;
  bio: string | null;
  strength: CofounderStrength;
  seeking: CofounderStrength;
  commitment: CofounderCommitment;
  location: string | null;
  remoteOk: boolean;
  stage: string | null;
  brings: string[];
  score: number;
  reasons: MatchReason[];
  introduction: { id: number; status: string; outbound: boolean } | null;
}

export const myCofounderProfile = () =>
  apiRequest<{ profile: CofounderProfile | null }>('/api/cofounder/profile').then((r) => r.profile);

export const saveCofounderProfile = (body: Partial<CofounderProfile> & { headline: string; strength: string; seeking: string }) =>
  apiRequest<{ id: number }>('/api/cofounder/profile', { method: 'PUT', body: JSON.stringify(body) });

export const cofounderMatches = () =>
  // 409 means the caller has no profile yet — the NORMAL first visit, not a fault.
  // CofounderMatching renders the profile editor from its catch, so declaring the
  // status expected keeps the transport from raising the global error toast /
  // support-ticket prompt for a state the surface handles itself.
  apiRequest<{ profile: CofounderProfile; matches: CofounderMatch[] }>('/api/cofounder/matches', { expectedErrors: [409] });

export const requestIntroduction = (toProfileId: number, message: string) =>
  apiRequest<{ id: number }>('/api/cofounder/introductions', {
    method: 'POST',
    body: JSON.stringify({ toProfileId, message }),
  });

export const respondToIntroduction = (introductionId: number, decision: 'accepted' | 'declined') =>
  apiRequest<{ ok: true; status: string }>(`/api/cofounder/introductions/${introductionId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
