/**
 * Deferred LLM work (PRD D6) — the vocabulary every batch module shares.
 *
 * A caller nobody waits on (project-memory consolidation, the classifier's LLM pass, the
 * distillation teacher) hands its request to {@link deferLlmCall} instead of the gateway.
 * The request rides a durable job row until a cron tick groups queued jobs per provider
 * into ONE provider batch (Anthropic Message Batches, OpenAI Batch API — both billed at
 * half the synchronous rate), polls it, and hands each result to the handler its
 * `callbackKind` names, which does the write the synchronous caller would have done.
 */
import type { VendorCallResult } from '../vendors/types';

/** Providers with a batch API this platform drives. Anything else stays synchronous. */
export const BATCH_VENDORS = ['anthropic', 'openai'] as const;
export type BatchVendor = (typeof BATCH_VENDORS)[number];

export function isBatchVendor(v: string): v is BatchVendor {
  return (BATCH_VENDORS as readonly string[]).includes(v);
}

/** Who pays: the tenant's own api key, or the operator key. */
export type BatchFunding = 'byo' | 'platform';

/** The completion handlers a job can name — one per deferred call site. */
export const BATCH_CALLBACK_KINDS = [
  'task_action_type',
  'project_memory',
  'agent_host_session_summary',
  'evermind_teacher',
] as const;
export type BatchCallbackKind = (typeof BATCH_CALLBACK_KINDS)[number];

export function isBatchCallbackKind(v: string): v is BatchCallbackKind {
  return (BATCH_CALLBACK_KINDS as readonly string[]).includes(v);
}

/**
 * The vendor-neutral request a job stores — the OpenAI chat shape every gateway caller
 * already builds, narrowed to what a no-tools background call uses. Each adapter turns it
 * into its provider's body with the SAME builder its synchronous vendor uses.
 */
export interface DeferredLlmRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  temperature?: number;
  /** OpenAI `response_format` (e.g. a strict `json_schema`); the Anthropic builder maps it
   *  onto `output_config.format`. */
  responseFormat?: Record<string, unknown>;
}

/** Where a job runs: provider, model id on that provider, and who funds it. */
export interface BatchTarget {
  vendor: BatchVendor;
  model: string;
  funding: BatchFunding;
}

export type BatchJobStatus = 'queued' | 'submitting' | 'submitted' | 'running_sync' | 'completed' | 'failed';

/** One job row as the use cases see it. */
export interface BatchJob extends BatchTarget {
  id: number;
  tenantId: number;
  projectId: number | null;
  taskId: number | null;
  useCase: string;
  callbackKind: BatchCallbackKind;
  callbackPayload: Record<string, unknown>;
  request: DeferredLlmRequest;
  status: BatchJobStatus;
  providerBatchId: string | null;
  attempts: number;
  createdAt: Date;
}

/** A job's input before it has an id. */
export type NewBatchJob = Pick<
  BatchJob,
  'tenantId' | 'projectId' | 'taskId' | 'useCase' | 'callbackKind' | 'callbackPayload' | 'request' | 'vendor' | 'model' | 'funding'
>;

/** One request's outcome inside a finished provider batch. */
export type BatchItemResult =
  | { ok: true; result: VendorCallResult }
  /** `retryable` = the provider did not run it (expired / canceled / a transient
   *  error) — requeue; otherwise the request itself was refused. */
  | { ok: false; error: string; retryable: boolean };

/** A job with no result after this long runs synchronously instead (both providers'
 *  completion window is 24h). */
export const BATCH_SLA_MS = 24 * 60 * 60 * 1000;

/** Submit / item attempts before a job gives up on the batch path and runs synchronously. */
export const BATCH_MAX_ATTEMPTS = 3;

/** The provider `custom_id` for a job — `[A-Za-z0-9_-]{1,64}` on both providers. */
export function batchCustomId(jobId: number): string {
  return `job-${jobId}`;
}

/** The job id a provider `custom_id` names, or null for one this platform did not mint. */
export function jobIdFromCustomId(customId: string): number | null {
  const m = /^job-(\d+)$/.exec(customId);
  return m ? Number(m[1]) : null;
}
