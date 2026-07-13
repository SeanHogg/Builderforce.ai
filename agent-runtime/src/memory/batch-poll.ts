import { buildBatchHeaders, type BatchHttpClientConfig, normalizeBatchBaseUrl } from "./batch-utils.js";

/**
 * Shared status shape for OpenAI-compatible Batch APIs (OpenAI + Voyage).
 * Gemini uses a different state machine and does not use these helpers.
 */
export type BatchStatusResult = {
  id?: string;
  status?: string;
  output_file_id?: string | null;
  error_file_id?: string | null;
};

/**
 * Fetch the status of a batch job from an OpenAI-compatible Batch API.
 * `provider` is used purely for error-message prefixing.
 */
export async function fetchBatchStatus(params: {
  client: BatchHttpClientConfig;
  batchId: string;
  provider: string;
}): Promise<BatchStatusResult> {
  const baseUrl = normalizeBatchBaseUrl(params.client);
  const res = await fetch(`${baseUrl}/batches/${params.batchId}`, {
    headers: buildBatchHeaders(params.client, { json: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${params.provider} batch status failed: ${res.status} ${text}`);
  }
  return (await res.json()) as BatchStatusResult;
}

/**
 * Poll an OpenAI-compatible batch job until it completes, fails, or times out.
 * Returns the output/error file ids on completion; throws on terminal failure,
 * timeout, or (when `wait` is false) while still pending.
 *
 * `readBatchError` resolves a human-readable detail from the provider's error
 * file (provider-specific fetch path).
 */
export async function waitForBatch(params: {
  client: BatchHttpClientConfig;
  provider: string;
  batchId: string;
  wait: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
  debug?: (message: string, data?: Record<string, unknown>) => void;
  initial?: BatchStatusResult;
  readBatchError: (errorFileId: string) => Promise<string | undefined>;
}): Promise<{ outputFileId: string; errorFileId?: string }> {
  const start = Date.now();
  let current: BatchStatusResult | undefined = params.initial;
  while (true) {
    const status =
      current ??
      (await fetchBatchStatus({
        client: params.client,
        batchId: params.batchId,
        provider: params.provider,
      }));
    const state = status.status ?? "unknown";
    if (state === "completed") {
      if (!status.output_file_id) {
        throw new Error(`${params.provider} batch ${params.batchId} completed without output file`);
      }
      return {
        outputFileId: status.output_file_id,
        errorFileId: status.error_file_id ?? undefined,
      };
    }
    if (["failed", "expired", "cancelled", "canceled"].includes(state)) {
      const detail = status.error_file_id
        ? await params.readBatchError(status.error_file_id)
        : undefined;
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`${params.provider} batch ${params.batchId} ${state}${suffix}`);
    }
    if (!params.wait) {
      throw new Error(`${params.provider} batch ${params.batchId} still ${state}; wait disabled`);
    }
    if (Date.now() - start > params.timeoutMs) {
      throw new Error(`${params.provider} batch ${params.batchId} timed out after ${params.timeoutMs}ms`);
    }
    params.debug?.(
      `${params.provider} batch ${params.batchId} ${state}; waiting ${params.pollIntervalMs}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, params.pollIntervalMs));
    current = undefined;
  }
}
