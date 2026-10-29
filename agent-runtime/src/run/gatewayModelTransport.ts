/**
 * `gatewayModelTransport` — where the on-prem agent's model runs: the Builderforce
 * gateway's OpenAI-compatible endpoint (`/v1/chat/completions`), the same wire the
 * runtime's other model calls speak (`builderforce/model/native-llm.ts`). The gateway
 * brokers the tenant's provider credentials, so the host holds one bearer key.
 *
 * This is a PORT, not a policy: it translates the agent's request into the wire shape and
 * the answer back, and survives a flaky network the way a transport should (a request
 * timeout; a bounded retry with backoff on 429 / 529 / 5xx). Which model, how many turns,
 * what to do on a stall are the agent's.
 *
 * The run DECLARES what it is on every request (`x-builderforce-surface`, and the
 * execution id when it has one): the gateway attributes usage from it and, for a cloud
 * runner, applies its fail-closed BYO rule — which on-prem traffic is deliberately exempt
 * from (GAP-B2/B4).
 *
 * Reuse: the tool-call encoding is the kernel's (`toOpenAiToolCall`, which normalises a
 * no-argument call to `{}`), usage is read with the wire package's `readUsageFields`, and
 * the error is its `ChatCompletionError`. The request itself is NOT the wire package's
 * `chatComplete`, because that client cannot carry the declaration headers; moving them
 * into `ChatClient` (a `headers` field) lets this file shrink to the mapping.
 */

import { toOpenAiToolCall } from "@builderforce/agent-loop";
import type { ModelCompletion, ModelRequest, ModelTransport, ModelUsage, RunMessage } from "@builderforce/agent-run";
import { ChatCompletionError, readUsageFields } from "@seanhogg/builderforce-memory/wire";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

/** Longest one request may take before it is abandoned (a hung socket must not hold a run). */
export const GATEWAY_REQUEST_TIMEOUT_MS = 120_000;
/** Attempts per request, the first included. */
export const GATEWAY_MAX_ATTEMPTS = 4;
/** First retry delay; doubles each attempt (a `Retry-After` the gateway sends wins). */
export const GATEWAY_RETRY_BASE_MS = 500;
/** The longest a retry waits, whatever the backoff or `Retry-After` says. */
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
  /** Test seams: the HTTP client, the retry sleep, the request timeout. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/**
 * The header line a runner declares its traffic with: `name: value, name: value`. The
 * gateway's usage attribution and its fail-closed BYO gate both read it. Pure, so the
 * contract is unit-testable.
 */
export function buildGatewayHeaders(params: Pick<GatewayTransportOptions, "surface" | "executionId">): string {
  const parts = [`x-builderforce-surface: ${params.surface?.trim() || "on_prem"}`];
  if (params.executionId != null && Number.isFinite(params.executionId)) {
    parts.push(`x-builderforce-execution-id: ${params.executionId}`);
  }
  return parts.join(", ");
}

/** A header line as the header map a request carries. */
function headersOfLine(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of line.split(", ")) {
    const at = part.indexOf(": ");
    if (at > 0) out[part.slice(0, at)] = part.slice(at + 2);
  }
  return out;
}

/** One agent row as the OpenAI-compatible message the gateway accepts. */
export function wireMessage(row: RunMessage): Record<string, unknown> {
  if (row.role === "tool") return { role: "tool", tool_call_id: row.toolCallId, content: row.content };
  if (row.role === "assistant" && row.toolCalls && row.toolCalls.length > 0) {
    return { role: "assistant", content: row.content || null, tool_calls: row.toolCalls.map(toOpenAiToolCall) };
  }
  return { role: row.role, content: row.content };
}

interface WireAnswer {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: unknown;
}

function usageOf(answer: WireAnswer): ModelUsage | undefined {
  if (answer.usage === undefined) return undefined;
  const u = readUsageFields(answer.usage);
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

/** How long to wait before attempt `attempt` (1-based retry number), honouring `Retry-After` seconds. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const asked = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : GATEWAY_RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.min(asked, GATEWAY_RETRY_MAX_MS);
}

/** The gateway as the agent's `ModelTransport`. A non-2xx answer throws a `ChatCompletionError`. */
export function gatewayModelTransport(options: GatewayTransportOptions): ModelTransport {
  const url = `${normalizeBaseUrl(options.baseUrl)}/v1/chat/completions`;
  const declared = headersOfLine(buildGatewayHeaders(options));
  const http = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? GATEWAY_REQUEST_TIMEOUT_MS;

  async function post(body: string, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await http(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}`, ...declared },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (response.ok) return response;
      const detail = (await response.text()).slice(0, 300);
      // Stop is a decision, not a fault: an aborted run never retries.
      if (!isRetryableStatus(response.status) || attempt >= GATEWAY_MAX_ATTEMPTS || signal?.aborted) {
        throw new ChatCompletionError(response.status, detail);
      }
      await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
    }
  }

  return {
    ...(options.window ? { window: options.window } : {}),
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      const body = JSON.stringify({
        messages: request.messages.map(wireMessage),
        ...(request.model ? { model: request.model } : {}),
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools, tool_choice: "auto" } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      });
      const answer = (await (await post(body, signal)).json()) as WireAnswer;
      const message = answer.choices?.[0]?.message;
      const toolCalls = (message?.tool_calls ?? [])
        .filter((call) => call.function?.name)
        .map((call, index) => ({
          id: call.id || `call-${index + 1}`,
          name: call.function!.name!,
          arguments: call.function?.arguments ?? "{}",
        }));
      const usage = usageOf(answer);
      return {
        content: message?.content ?? "",
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(usage ? { usage } : {}),
        ...(answer.model ? { model: answer.model } : {}),
      };
    },
  };
}
