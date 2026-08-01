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
