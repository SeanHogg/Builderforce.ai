/**
 * Studio published-model API client — /api/llm/models + /api/studio/models/*.
 *
 * Backs the "score a trained model" path in the LLM Studio benchmark: list the
 * tenant's published Evermind models and benchmark a chosen one against held-out
 * text on the server (which reuses the model's own persisted tokenizer).
 */
import { apiRequest } from './apiClient';

/** A published, callable Evermind model the tenant owns. */
export interface PublishedEvermindModel {
  slug: string;
  name: string;
}

const EVERMIND_PIN_PREFIX = 'evermind/';

interface TenantModelRow {
  slug?: string;
  name?: string;
  baseModel?: string | null;
}

/** List the tenant's PUBLISHED Evermind models (those pinned to `evermind/<ref>`). */
export async function listEvermindModels(): Promise<PublishedEvermindModel[]> {
  const res = await apiRequest<{ models?: TenantModelRow[] }>('/api/llm/models');
  return (res.models ?? [])
    .filter((m): m is TenantModelRow & { slug: string } =>
      typeof m.slug === 'string' && !!m.baseModel?.startsWith(EVERMIND_PIN_PREFIX),
    )
    .map((m) => ({ slug: m.slug, name: m.name?.trim() || m.slug }));
}

/** Server-computed scorecard for a published model (mirrors api EvermindBenchmarkResult). */
export interface PublishedBenchmarkResult {
  tokens: number;
  perplexity: number;
  bitsPerToken: number;
  top1Accuracy: number;
  topKAccuracy: number;
  topK: number;
  tokensPerSecond?: number;
  vocabSize: number;
  sample: string;
}

/** Benchmark a published model against held-out text. */
export async function benchmarkPublishedModel(
  slug: string,
  corpus: string,
  topK = 5,
): Promise<PublishedBenchmarkResult> {
  return apiRequest<PublishedBenchmarkResult>(`/api/studio/models/${encodeURIComponent(slug)}/benchmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corpus, topK }),
  });
}
