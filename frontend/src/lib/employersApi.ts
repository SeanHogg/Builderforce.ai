/**
 * Employers and reviews — the typed client.
 *
 * ── THE SERVER DECIDES WHAT IS VISIBLE, NOT THIS FILE ────────────────────────
 * `reviews` only ever contains APPROVED rows; `mine` is the caller's own review
 * whatever state it is in. That split is enforced server-side, so no component
 * has to remember to filter a pending review out of a public list — the mistake
 * that would publish an unapproved claim about a named company.
 */
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';

export type ReviewStatus = 'published' | 'pending' | 'rejected';

export interface RatingSummary {
  count: number;
  /** Null when nothing is rated — NOT 0, which would render as "0.0 ★". */
  average: number | null;
  distribution: Record<number, number>;
}

export interface EmployerCard {
  id: number;
  objectId: string;
  name: string;
  slug: string | null;
  website: string | null;
  sector: string | null;
  country: string | null;
  headcount: number | null;
  rating: RatingSummary;
}

export interface EmployerReview {
  id: number;
  authorRef: string | null;
  authorName: string | null;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  verifiedAs: string | null;
  subRatings: Record<string, number>;
  metadata: Record<string, string>;
  createdAt: string;
}

export interface ReviewAxis {
  key: string;
  /** Suffix under the `employers.axis.*` namespace — the server never ships
   *  English, only the key the catalogue resolves. */
  labelKey: string;
}

export interface EmployerDetail {
  employer: EmployerCard;
  reviews: EmployerReview[];
  summary: RatingSummary;
  /** The caller's own review, in any state — so a pending one is shown as
   *  pending rather than as an empty form inviting a duplicate. */
  mine: EmployerReview | null;
  /** What this subject is rated on, from the SERVER's registry. The form renders
   *  these rather than a hard-coded list, so it can only ever collect axes the
   *  submit path accepts. */
  axes: ReviewAxis[];
}

export interface PendingReview {
  id: number;
  objectId: string;
  subjectKind: string;
  subjectTitle: string;
  authorRef: string | null;
  authorName: string | null;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  submittedAt: string;
}

export interface ReviewDraft {
  rating: number;
  title: string;
  body?: string;
  subRatings?: Record<string, number>;
  metadata?: Record<string, string>;
}

export async function fetchEmployers(query = '', limit = 50): Promise<EmployerCard[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  const res = await apiRequestStream(`/api/employers?${params}`, { auth: 'tenant' });
  return (await jsonOrThrow<{ rows: EmployerCard[] }>(res, 'Failed to load employers')).rows;
}

export async function fetchEmployer(id: number): Promise<EmployerDetail> {
  const res = await apiRequestStream(`/api/employers/${id}`, { auth: 'tenant' });
  return jsonOrThrow<EmployerDetail>(res, 'Failed to load that employer');
}

export async function submitEmployerReview(id: number, draft: ReviewDraft): Promise<EmployerReview> {
  const res = await apiRequestStream(`/api/employers/${id}/reviews`, {
    method: 'POST', auth: 'tenant', body: JSON.stringify(draft),
  });
  return (await jsonOrThrow<{ review: EmployerReview }>(res, 'That review was not saved')).review;
}

export async function withdrawEmployerReview(id: number): Promise<void> {
  const res = await apiRequestStream(`/api/employers/${id}/reviews/mine`, {
    method: 'DELETE', auth: 'tenant',
  });
  await jsonOrThrow<{ ok: boolean }>(res, 'That review could not be withdrawn');
}

export async function fetchModerationQueue(limit = 50): Promise<{ rows: PendingReview[]; waiting: number }> {
  const res = await apiRequestStream(`/api/employers/moderation/queue?limit=${limit}`, { auth: 'tenant' });
  return jsonOrThrow<{ rows: PendingReview[]; waiting: number }>(res, 'Failed to load the moderation queue');
}

export async function decideReview(
  reviewId: number, decision: 'published' | 'rejected', reason?: string,
): Promise<void> {
  const res = await apiRequestStream(`/api/employers/moderation/${reviewId}`, {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ decision, reason }),
  });
  await jsonOrThrow<{ ok: boolean }>(res, 'That decision was not applied');
}
