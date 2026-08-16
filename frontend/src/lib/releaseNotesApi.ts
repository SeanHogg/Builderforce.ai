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

/**
 * Everything the signed-in user needs told about product updates, in ONE call:
 * the betas open to them, the one the server judges worth interrupting them
 * about (or null), and how many published notes they have not seen. The banner
 * never makes that judgement itself, and the unread badge never adds a second
 * request for a single integer.
 */
export async function fetchBetaPrograms(): Promise<{
  betas: BetaProgram[];
  bannerBetaId: string | null;
  unreadCount: number;
}> {
  const data = await apiRequest<{
    betas?: BetaProgram[]; bannerBetaId?: string | null; unreadCount?: number;
  }>(
    '/api/release-notes/betas',
    { auth: 'web', expectedErrors: [401, 403] },
  );
  return {
    betas: data.betas ?? [],
    bannerBetaId: data.bannerBetaId ?? null,
    unreadCount: Number.isFinite(data.unreadCount) ? Number(data.unreadCount) : 0,
  };
}

/** The panel was opened, so the changelog has been read. Fire-and-forget: a
 *  failed badge-clear is never worth an error surface, and the next load simply
 *  reports the same count again. */
export async function markProductUpdatesSeen(): Promise<void> {
  await apiRequest('/api/release-notes/seen', {
    method: 'POST',
    auth: 'web',
    expectedErrors: [401, 403],
  });
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
