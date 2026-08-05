/**
 * Studio published-model API client — /api/llm/models + /api/studio/models/*.
 *
 * Backs the "score a trained model" path in the LLM Studio benchmark: list the
 * tenant's published Evermind models and benchmark a chosen one against held-out
 * text on the server (which reuses the model's own persisted tokenizer).
 */
import { apiRequest, apiRequestStream } from './apiClient';
import { downloadBlob, filenameFromResponse } from './download';

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export interface PublishedEvermindResult extends PublishedEvermindModel {
  ref: string;
  baseModel: string;
  evermindRef: string;
  testEndpoint: string;
}

/** Publish the same validated `.evermind` package the live gateway executes. */
export async function publishEvermindModel(input: {
  name: string;
  model: ArrayBuffer;
  tokenizer: { vocab: Record<string, number>; merges: string[] };
  description?: string;
  heldOutCorpus: string;
  qualityGate?: { maxPerplexity?: number; minTop1Accuracy?: number };
}): Promise<PublishedEvermindResult> {
  return apiRequest<PublishedEvermindResult>('/api/studio/models/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, model: arrayBufferToBase64(input.model) }),
  });
}

export async function testPublishedEvermindModel(slug: string, prompt: string): Promise<{ choices?: Array<{ message?: { content?: string } }>; usage?: unknown }> {
  return apiRequest(`/api/studio/models/${encodeURIComponent(slug)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, maxTokens: 64 }),
  });
}

/** Promote a prior immutable package behind an existing callable model slug. */
export async function rollbackPublishedEvermindModel(slug: string, target: { targetSlug?: string; targetEvermindRef?: string }): Promise<{ rolledBack: true; previousBaseModel: string; activeBaseModel: string; rollbackToken: string }> {
  return apiRequest(`/api/studio/models/${encodeURIComponent(slug)}/rollback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target),
  });
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

/** Portable export formats (mirrors the engine's EXPORT_FORMATS; `ext` for display). */
export type EvermindExportFormat = 'huggingface' | 'onnx' | 'safetensors' | 'gguf';

export interface ExportFormatOption {
  id: EvermindExportFormat;
  /** i18n key suffix under `modelExport.format.*` for label + description. */
  key: EvermindExportFormat;
  ext: string;
}

export const EVERMIND_EXPORT_FORMATS: ExportFormatOption[] = [
  { id: 'huggingface', key: 'huggingface', ext: '.zip' },
  { id: 'onnx', key: 'onnx', ext: '.onnx' },
  { id: 'safetensors', key: 'safetensors', ext: '.safetensors' },
  { id: 'gguf', key: 'gguf', ext: '.gguf' },
];

/**
 * Export a published model and trigger a browser download. Streams the artifact
 * (auth-gated, so it can't be a bare <a href>) into a Blob, then clicks a
 * transient object-URL link. Returns the downloaded filename.
 */
export async function exportPublishedModel(
  slug: string,
  format: EvermindExportFormat,
  fp16 = false,
): Promise<string> {
  const res = await apiRequestStream(
    `/api/studio/models/${encodeURIComponent(slug)}/export?format=${format}&fp16=${fp16 ? 'true' : 'false'}`,
  );
  const blob = await res.blob();
  const safeSlug = slug.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fallbackExt = EVERMIND_EXPORT_FORMATS.find((f) => f.id === format)?.ext ?? '';
  const filename = filenameFromResponse(res, `${safeSlug}${fallbackExt}`);

  downloadBlob(blob, filename);
  return filename;
}
