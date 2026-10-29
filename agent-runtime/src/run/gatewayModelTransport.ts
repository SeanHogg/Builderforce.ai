/**
 * `gatewayModelTransport` — where the on-prem agent's model runs: the Builderforce
 * gateway's OpenAI-compatible endpoint (`/v1/chat/completions`), the same wire the
 * runtime's other model calls speak (`builderforce/model/native-llm.ts`). The gateway
 * brokers the tenant's provider credentials, so the host holds one bearer key.
 *
 * This is a PORT, not a policy: it translates the agent's request into the wire shape and
 * the answer back, and survives a flaky network the way a transport should — a request
 * timeout, and a bounded retry with backoff on 429 / 529 / 5xx AND on a network failure
 * (a rejected fetch, a timeout). A stopped run never retries and its backoff ends at once.
 * Which model, how many turns, what to do on a stall are the agent's.
 *
 * The request is the wire package's (`chatComplete`, `@seanhogg/builderforce-memory/wire`):
 * the body, the error mapping and the usage reading are its. The run DECLARES what it is
 * through `ChatClient.headers` (`x-builderforce-surface`, and the execution id when it has
 * one): the gateway attributes usage from it and, for a cloud runner, applies its fail-closed
 * BYO rule — which on-prem traffic is deliberately exempt from (GAP-B2/B4). Every call also
 * carries one `Idempotency-Key`, the same across its retries, which the gateway uses to
 * replay an answer it already produced instead of billing the call twice.
 */

import { randomUUID } from "node:crypto";
import { toOpenAiToolCall } from "@builderforce/agent-loop";
import type { ModelCompletion, ModelRequest, ModelTransport, ModelUsage, RunMessage } from "@builderforce/agent-run";
import {
  ChatCompletionError,
  chatComplete,
  readUsageFields,
  type ChatMessage,
  type ChatResult,
} from "@seanhogg/builderforce-memory/wire";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

/** Longest one request may take before it is abandoned (a hung socket must not hold a run). */
export const GATEWAY_REQUEST_TIMEOUT_MS = 120_000;
/** Attempts per request, the first included. */
export const GATEWAY_MAX_ATTEMPTS = 4;
/** First retry delay; doubles each attempt. */
export const GATEWAY_RETRY_BASE_MS = 500;
/** The longest a retry waits, whatever the backoff says. */
export const GATEWAY_RETRY_MAX_MS = 10_000;

export interface GatewayTransportOptions {
  /** Gateway base; `/v1/chat/completions` is appended. */
  baseUrl: string;
  /** Auth key the gateway resolves the tenant from (sent as a bearer token). */
  apiKey: string;
  /** Execution surface declared to the gateway (`on_prem` for the self-hosted relay). */
  surface?: string;
  /** The execution this run belongs to, stamped so a refusal or usage row is attributable. */
  executionId?: number;
  /** The context window of a model id, when the host knows it (the tools policy sizes its result cap from it). */
  window?: (model: string) => number | undefined;
  /** Test seams: the backoff wait (ends early on `signal`), and the request timeout. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

/**
 * The headers a runner declares its traffic with. The gateway's usage attribution and its
 * fail-closed BYO gate both read them. Pure, so the contract is unit-testable.
 */
export function gatewayHeaders(params: Pick<GatewayTransportOptions, "surface" | "executionId">): Record<string, string> {
  return {
    "x-builderforce-surface": params.surface?.trim() || "on_prem",
    ...(params.executionId != null && Number.isFinite(params.executionId)
      ? { "x-builderforce-execution-id": String(params.executionId) }
      : {}),
  };
}

/** One agent row as the OpenAI-compatible message the gateway accepts. */
export function wireMessage(row: RunMessage): ChatMessage {
  if (row.role === "tool") return { role: "tool", tool_call_id: row.toolCallId, content: row.content };
  if (row.role === "assistant" && row.toolCalls && row.toolCalls.length > 0) {
    return { role: "assistant", content: row.content || null, tool_calls: row.toolCalls.map(toOpenAiToolCall) };
  }
  return { role: row.role, content: row.content };
}

function usageOf(result: ChatResult): ModelUsage | undefined {
  if (result.usage === undefined) return undefined;
  const u = readUsageFields(result.usage);
  return {
    ...(u.promptTokens !== undefined ? { inputTokens: u.promptTokens } : {}),
    ...(u.completionTokens !== undefined ? { outputTokens: u.completionTokens } : {}),
    ...(u.cacheReadTokens !== undefined ? { cacheReadTokens: u.cacheReadTokens } : {}),
  };
}

/** True for the answers worth another attempt: rate-limited, overloaded, or a server fault. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 529 || (status >= 500 && status <= 599);
}

/** True for a failure that never reached an answer: a rejected fetch, or the request timeout. */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof ChatCompletionError) return false;
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError") return true;
  return err instanceof TypeError && ("cause" in err || /fetch failed|network|terminated/i.test(err.message));
}

/** How long to wait before retry number `attempt` (1-based): exponential, capped. */
export function retryDelayMs(attempt: number): number {
  return Math.min(GATEWAY_RETRY_BASE_MS * 2 ** (attempt - 1), GATEWAY_RETRY_MAX_MS);
}

/** A wait that ends the moment `signal` aborts (rejecting, so the run's Stop is not delayed by a backoff). */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The gateway as the agent's `ModelTransport`. A non-2xx answer throws the wire package's `ChatCompletionError`. */
export function gatewayModelTransport(options: GatewayTransportOptions): ModelTransport {
  const baseUrl = `${normalizeBaseUrl(options.baseUrl)}/v1`;
  const declared = gatewayHeaders(options);
  const sleep = options.sleep ?? abortableSleep;
  const timeoutMs = options.timeoutMs ?? GATEWAY_REQUEST_TIMEOUT_MS;

  return {
    ...(options.window ? { window: options.window } : {}),
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      // One key for the call and ALL its retries: the gateway replays the answer it already made.
      const client = {
        baseUrl,
        apiKey: options.apiKey,
        timeoutMs,
        headers: { ...declared, "Idempotency-Key": randomUUID() },
      };
      const chatRequest = {
        messages: request.messages.map(wireMessage),
        ...(request.model ? { model: request.model } : {}),
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      };

      let result: ChatResult;
      for (let attempt = 1; ; attempt += 1) {
        try {
          result = await chatComplete(client, chatRequest, signal);
          break;
        } catch (err) {
          // Stop is a decision, not a fault: an aborted run never retries.
          const retryable = err instanceof ChatCompletionError ? isRetryableStatus(err.status) : isNetworkFailure(err);
          if (!retryable || attempt >= GATEWAY_MAX_ATTEMPTS || signal?.aborted) throw err;
          await sleep(retryDelayMs(attempt), signal);
        }
      }

      const toolCalls = result.toolCalls
        .filter((call) => call.function?.name)
        .map((call, index) => ({
          id: call.id || `call-${index + 1}`,
          name: call.function!.name!,
          arguments: call.function?.arguments ?? "{}",
        }));
      const usage = usageOf(result);
      return {
        content: result.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(usage ? { usage } : {}),
        ...(result.model ? { model: result.model } : {}),
      };
    },
  };
}
