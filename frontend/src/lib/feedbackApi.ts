/**
 * Product Feedback API client.
 *
 * Three surfaces, one shared row shape ({@link FeedbackSubmission}):
 *   - collectors  — configure a project's embeddable snippet
 *   - submissions — the in-app panel's submit + the tenant triage queue
 *   - triage      — approve / decline, the human gate on execution
 *
 * The superadmin cross-tenant roll-up lives in adminApi (it needs the Web JWT),
 * but returns this same shape so both queues render through one component.
 */

import { request } from './builderforceApi';

export type FeedbackKind = 'feature' | 'bug' | 'idea' | 'other';
export type FeedbackStatus = 'new' | 'approved' | 'declined';

export const FEEDBACK_KINDS: FeedbackKind[] = ['feature', 'bug', 'idea', 'other'];
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'approved', 'declined'];

/** `tasks.source` on a request still awaiting approval — the gate is on. */
export const FEEDBACK_TASK_SOURCE = 'feedback';

export interface FeedbackCollector {
  id: string;
  name: string;
  projectId: number;
  enabled: boolean;
  autoCreateTask: boolean;
  dailyLimit: number;
  allowedOrigins: string;
  lastSubmissionAt: string | null;
  createdAt: string;
}

export interface CreateFeedbackCollectorResult {
  collector: { id: string; name: string; projectId: number };
  /** Shown ONCE — never retrievable again. */
  ingestKey: string;
  submitEndpoint: string;
  configEndpoint: string;
}

export interface FeedbackSubmission {
  id: string;
  tenantId: number;
  tenantName: string | null;
  projectId: number;
  projectName: string | null;
  kind: string;
  title: string;
  body: string;
  status: string;
  submitterName: string | null;
  submitterEmail: string | null;
  pageUrl: string | null;
  appVersion: string | null;
  taskId: number | null;
  taskKey: string | null;
  /** Live marker on the linked ticket — `feedback` means still gated. */
  taskSource: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface FeedbackQueue {
  submissions: FeedbackSubmission[];
  counts: Record<string, number>;
}

export interface FeedbackDraft {
  projectId: number;
  kind: FeedbackKind;
  title?: string;
  body: string;
}

/** Is this request's ticket still blocked from execution? */
export function isGated(s: Pick<FeedbackSubmission, 'taskSource'>): boolean {
  return s.taskSource === FEEDBACK_TASK_SOURCE;
}

function queueQuery(params: { projectId?: number | null; status?: FeedbackStatus | null; limit?: number }): string {
  const q = new URLSearchParams();
  if (params.projectId != null) q.set('projectId', String(params.projectId));
  if (params.status) q.set('status', params.status);
  if (params.limit) q.set('limit', String(params.limit));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const feedbackApi = {
  collectors: {
    list: (): Promise<FeedbackCollector[]> =>
      request<{ collectors: FeedbackCollector[] }>('/api/feedback/collectors').then((r) => r.collectors ?? []),
    create: (body: { projectId: number; name?: string }): Promise<CreateFeedbackCollectorResult> =>
      request('/api/feedback/collectors', { method: 'POST', body: JSON.stringify(body) }),
    update: (
      id: string,
      body: { name?: string; enabled?: boolean; autoCreateTask?: boolean; dailyLimit?: number; allowedOrigins?: string },
    ): Promise<{ ok: true }> =>
      request(`/api/feedback/collectors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string): Promise<void> =>
      request<void>(`/api/feedback/collectors/${id}`, { method: 'DELETE' }),
  },

  /** The in-app panel's submit — authenticated by session, no ingest key. */
  submit: (draft: FeedbackDraft): Promise<{ submissionId: string; taskId: number | null; deduped: boolean }> =>
    request('/api/feedback/submissions', { method: 'POST', body: JSON.stringify(draft) }),

  queue: (params: { projectId?: number | null; status?: FeedbackStatus | null; limit?: number } = {}): Promise<FeedbackQueue> =>
    request<FeedbackQueue>(`/api/feedback/submissions${queueQuery(params)}`),

  /** The human gate: approving un-gates the linked ticket, declining archives it. */
  review: (id: string, decision: 'approved' | 'declined'): Promise<{ ok: true; taskId: number | null }> =>
    request(`/api/feedback/submissions/${id}/review`, { method: 'POST', body: JSON.stringify({ decision }) }),
};
