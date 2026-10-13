/**
 * Superadmin LLM diagnostics client — traces, usage, ratings, vendor health.
 * Copied `adminRequest` (not exported from adminApi) so this module does not
 * import adminApi.ts — that would be a cycle.
 */

import { apiRequest, type RequestOptions } from './apiClient';
import { getStoredWebToken } from './auth';
import type { VendorId } from './builderforceApi';

/** One row in the superadmin LLM trace list (summary columns only). */
export interface AdminLlmTraceSummary {
  traceId: string;
  createdAt: string | null;
  tenantId: number | null;
  userId: string | null;
  surface: string;
  llmProduct: string | null;
  resolvedModel: string | null;
  resolvedVendor: string | null;
  status: number | null;
  success: boolean;
  outcome: string | null;
  classification: string | null;
  attemptCount: number;
  retries: number;
  schemaRetries: number;
  durationMs: number;
  totalTokens: number;
  useCase: string | null;
  consumerRequestId: string | null;
  streamed: boolean;
  errorMessage: string | null;
}

export interface AdminLlmTraceAttempt {
  model: string;
  vendor: string;
  status: number;
  error?: string;
  durationMs?: number;
  kind?: string;
}

/** Full single LLM trace (builder-side only) — every detail of one call. */
export interface AdminLlmTraceDetail extends AdminLlmTraceSummary {
  effectivePlan: string | null;
  premiumOverride: boolean;
  agentHostId: number | null;
  tenantApiKeyId: string | null;
  promptTokens: number;
  completionTokens: number;
  idempotencyKey: string | null;
  requestIp: string | null;
  origin: string | null;
  userAgent: string | null;
  requestShape: unknown;
  candidateChain: unknown;
  attempts: AdminLlmTraceAttempt[] | null;
  requestBody: unknown;
  responseBody: unknown;
  callerMetadata: unknown;
}

export interface LlmModelStat {
  model: string;
  vendor: VendorId;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retries: number;
  streamed_requests: number;
}

export interface LlmDailyStat {
  day: string;
  requests: number;
  total_tokens: number;
}

export interface LlmFailoverStat {
  model: string;
  vendor: VendorId;
  errorCode: number;
  count: number;
}

export interface LlmUsageStats {
  days: number;
  totals: {
    requests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    modelCount: number;
  };
  byModel: LlmModelStat[];
  daily: LlmDailyStat[];
  failovers: LlmFailoverStat[];
}

export type VendorHealthStatus = 'ok' | 'degraded' | 'down' | 'unconfigured';

export interface VendorHealthModel {
  model: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
}

export interface VendorHealthSnapshot {
  vendor: VendorId;
  status: VendorHealthStatus;
  probedCount: number;
  okCount: number;
  failedCount: number;
  latencyMs: number;
  models: VendorHealthModel[];
}

export interface VendorHealthRow extends VendorHealthSnapshot {
  trigger: 'manual' | 'cron';
  createdAt: string;
}

/** One (model × action × MCP tool) bucket of human ratings — mirrors the api's
 *  `RatingBucket` (application/llm/actionRatings.ts). */
export interface LlmRatingBucket {
  model: string;
  actionType: string;
  /** Null when the rated turns executed no tool (a prose-only reply). */
  toolName: string | null;
  up: number;
  down: number;
  total: number;
  /** Smoothed 0..1 satisfaction — the same number the learned router blends. */
  score: number;
}

/** A head-to-head verdict for one action bucket: who won, over whom, by how much. */
export interface LlmRatingLeader {
  actionType: string;
  toolName: string | null;
  winner: LlmRatingBucket;
  runnerUp: LlmRatingBucket;
  margin: number;
}

export interface LlmRatingSummary {
  days: number;
  totals: { up: number; down: number; total: number; score: number };
  buckets: LlmRatingBucket[];
  leaders: LlmRatingLeader[];
  models: number;
}

async function adminRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!getStoredWebToken()) throw new Error('Not authenticated. Sign in with a superadmin account.');
  return apiRequest<T>(path, { ...opts, auth: 'web' });
}

/** LLM traces / usage / ratings / vendor health. Spread onto `adminApi`. */
export const adminLlmApi = {
  async listLlmTraces(params: {
    q?: string; tenantId?: number; model?: string; success?: boolean;
    outcome?: string; days?: number; limit?: number; page?: number;
  } = {}): Promise<{ traces: AdminLlmTraceSummary[]; page: number; limit: number; days: number }> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.tenantId != null) qs.set('tenantId', String(params.tenantId));
    if (params.model) qs.set('model', params.model);
    if (params.success != null) qs.set('success', String(params.success));
    if (params.outcome) qs.set('outcome', params.outcome);
    if (params.days != null) qs.set('days', String(params.days));
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.page != null) qs.set('page', String(params.page));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return adminRequest(`/api/admin/llm/traces${suffix}`);
  },

  async getLlmTrace(traceId: string): Promise<{ trace: AdminLlmTraceDetail }> {
    return adminRequest(`/api/admin/llm/traces/${encodeURIComponent(traceId)}`);
  },

  async llmUsage(days = 30): Promise<LlmUsageStats> {
    return adminRequest<LlmUsageStats>(`/api/admin/llm-usage?days=${days}`);
  },

  /** Platform-wide human ratings of model output, rolled up by (model × action ×
   *  MCP tool). The quality counterpart to {@link llmUsage}'s cost view. */
  async llmRatings(days = 30): Promise<LlmRatingSummary> {
    return adminRequest<LlmRatingSummary>(`/api/admin/llm-ratings?days=${days}`);
  },

  async llmHealthLatest(): Promise<VendorHealthRow[]> {
    const res = await adminRequest<{ vendors: VendorHealthRow[] }>('/api/admin/llm-health');
    return res.vendors;
  },

  async probeVendorHealth(vendor: VendorId): Promise<VendorHealthSnapshot> {
    return adminRequest<VendorHealthSnapshot>(`/api/admin/llm-health/${vendor}`, {
      method: 'POST',
    });
  },
};
