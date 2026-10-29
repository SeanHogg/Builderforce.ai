/**
 * `gatewayModelTransport` — where the on-prem agent's model runs: the Builderforce
 * gateway's OpenAI-compatible endpoint (`/v1/chat/completions`), the same wire the
 * runtime's other model calls speak (`builderforce/model/native-llm.ts`). The gateway
 * brokers the tenant's provider credentials, so the host holds one bearer key.
 *
 * This is a PORT, not a policy: it translates the agent's request into the wire shape and
 * the answer back. Which model, how many turns, what to do on a stall are the agent's.
 *
 * The run DECLARES what it is on every request (`x-builderforce-surface`, and the
 * execution id when it has one): the gateway attributes usage from it and, for a cloud
 * runner, applies its fail-closed BYO rule — which on-prem traffic is deliberately exempt
 * from (GAP-B2/B4).
 */

import type {
  ModelCompletion,
  ModelRequest,
  ModelTransport,
  ModelUsage,
  RunMessage,
} from "@builderforce/agent-run";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

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
  /** Test seam: the HTTP client. */
  fetchImpl?: typeof fetch;
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
function wireMessage(row: RunMessage): Record<string, unknown> {
  if (row.role === "tool") return { role: "tool", tool_call_id: row.toolCallId, content: row.content };
  if (row.role === "assistant" && row.toolCalls && row.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: row.content || null,
      tool_calls: row.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
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
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

function usageOf(answer: WireAnswer): ModelUsage | undefined {
  const u = answer.usage;
  if (!u) return undefined;
  return {
    ...(u.prompt_tokens !== undefined ? { inputTokens: u.prompt_tokens } : {}),
    ...(u.completion_tokens !== undefined ? { outputTokens: u.completion_tokens } : {}),
    ...(u.prompt_tokens_details?.cached_tokens !== undefined ? { cacheReadTokens: u.prompt_tokens_details.cached_tokens } : {}),
  };
}

/** The gateway as the agent's `ModelTransport`. A non-2xx answer throws `gateway {status}: {body}`. */
export function gatewayModelTransport(options: GatewayTransportOptions): ModelTransport {
  const url = `${normalizeBaseUrl(options.baseUrl)}/v1/chat/completions`;
  const declared = headersOfLine(buildGatewayHeaders(options));
  const http = options.fetchImpl ?? fetch;

  return {
    ...(options.window ? { window: options.window } : {}),
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      const body = {
        messages: request.messages.map(wireMessage),
        ...(request.model ? { model: request.model } : {}),
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      };
      const response = await http(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}`, ...declared },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error(`gateway ${response.status}: ${(await response.text()).slice(0, 2_000)}`);
      const answer = (await response.json()) as WireAnswer;
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
