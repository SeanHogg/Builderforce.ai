/**
 * Public platform release notes — the changelog behind the footer "What's new"
 * panel. The endpoint is PUBLIC (published marketing content, no tenant data),
 * so no auth headers: the panel works on login screens and marketing pages too.
 */

import { apiRequest } from './apiClient';

export type ReleaseNoteCategory = 'new' | 'improvement' | 'fix';

/** Where an update sits in its lifecycle — what the badge on it says, and what
 *  decides whether it can be joined. Kept in step with RELEASE_NOTE_STAGES. */
export type ReleaseNoteStage = 'in_development' | 'private_beta' | 'public_beta' | 'live' | 'sunset';

export const RELEASE_NOTE_STAGES: ReleaseNoteStage[] = [
  'in_development', 'private_beta', 'public_beta', 'live', 'sunset',
];

export interface ReleaseNote {
  id: string;
  version: string;
  title: string;
  body: string | null;
  category: string;
  stage: string;
  betaOptIn: boolean;
  betaTerms: string | null;
  stageEndsAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Where the signed-in user stands with a beta. null = never answered, which is
 *  the only state the banner offers. */
export type BetaEnrollmentStatus = 'joined' | 'left' | 'dismissed';

export interface BetaProgram extends ReleaseNote {
  myStatus: BetaEnrollmentStatus | null;
  agreedAt: string | null;
}

export type BetaAction = 'join' | 'leave' | 'dismiss';

/** THE stage badge resolver — one mapping of an arbitrary server string onto a
 *  known stage, so every surface labels the same update identically. */
export function toStage(value: string): ReleaseNoteStage {
  return (RELEASE_NOTE_STAGES as string[]).includes(value) ? (value as ReleaseNoteStage) : 'live';
}

export async function fetchReleaseNotes(limit = 50): Promise<ReleaseNote[]> {
  const data = await apiRequest<{ releaseNotes?: ReleaseNote[] }>(`/api/release-notes?limit=${limit}`, { auth: 'none' });
  return data.releaseNotes ?? [];
}

/** The betas open to the signed-in user, plus the one the server judges worth
 *  interrupting them about (or null). The banner never makes that call itself. */
export async function fetchBetaPrograms(): Promise<{ betas: BetaProgram[]; bannerBetaId: string | null }> {
  const data = await apiRequest<{ betas?: BetaProgram[]; bannerBetaId?: string | null }>(
    '/api/release-notes/betas',
    { auth: 'web', expectedErrors: [401, 403] },
  );
  return { betas: data.betas ?? [], bannerBetaId: data.bannerBetaId ?? null };
}

/** Join / leave / dismiss. `agreed` is required by the server on a join — the
 *  consent is recorded there, not asserted here. */
export async function setBetaEnrollment(
  releaseNoteId: string,
  action: BetaAction,
  agreed = false,
): Promise<BetaEnrollmentStatus> {
  const data = await apiRequest<{ enrollment?: { status?: BetaEnrollmentStatus } }>(
    `/api/release-notes/${encodeURIComponent(releaseNoteId)}/beta`,
    { method: 'POST', auth: 'web', body: JSON.stringify({ action, agreed }) },
  );
  return data.enrollment?.status ?? (action === 'join' ? 'joined' : action === 'leave' ? 'left' : 'dismissed');
}
