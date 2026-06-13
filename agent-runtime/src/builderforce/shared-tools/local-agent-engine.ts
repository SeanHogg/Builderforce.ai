/**
 * LocalAgentEngine — the on-prem execution engine.
 *
 * It implements the shared {@link AgentEngine} seam and drives the shared
 * {@link ToolRegistry} directly: a plain tool loop (model → tool calls → dispatch →
 * repeat) with NO third-party agent framework. It mirrors the cloud
 * `runCloudToolLoop` pattern (same registry, same `control` signals for finish /
 * ask_human) so on-prem and cloud share ONE engine contract and ONE tool contract —
 * only the injected {@link CapabilityProvider} and the LLM client differ.
 *
 * This is the engine the On-Prem (V2 `local`) surface runs. The LLM client is
 * INJECTED ({@link LlmComplete}) so it is unit-testable with a mock and, in
 * production, points at the gateway's OpenAI-compatible endpoint over `fetch`.
 */

import type {
  AgentEngine,
  AgentRunInput,
  AgentRunResult,
  CapabilityProvider,
  ToolContext,
  ToolRegistry,
  ToolSchema,
} from "@builderforce/agent-tools";

/** One tool call in an OpenAI-compatible completion (mirrors the cloud `RawToolCall`). */
export interface RawToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** The pi-free LLM client the engine calls each turn. Returns the assistant turn's
 *  text + any tool calls. Inject a `fetch`-backed gateway client in production, a mock
 *  in tests — the engine never imports a model SDK. */
export type LlmComplete = (
  req: {
    messages: Array<Record<string, unknown>>;
    tools: ToolSchema[];
    model?: string;
  },
  signal?: AbortSignal,
) => Promise<{ content: string; toolCalls: RawToolCall[] }>;

/** Optional observability sinks so a host (the relay) can mirror the run onto the
 *  same frames the cloud/V2 paths emit — assistant text + per-tool events. */
export interface LocalEngineSinks {
  onAssistantText?: (text: string) => void;
  onToolUse?: (name: string, toolCallId: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, toolCallId: string, result: Record<string, unknown>) => void;
}

export interface LocalEngineDeps {
  registry: ToolRegistry;
  provider: CapabilityProvider;
  complete: LlmComplete;
  /** Max tool-loop iterations (default 40 — parity with the long-lived surfaces). */
  maxSteps?: number;
  sinks?: LocalEngineSinks;
}

const DEFAULT_MAX_STEPS = 40;

export class LocalAgentEngine implements AgentEngine {
  readonly id = "local";
  constructor(private readonly deps: LocalEngineDeps) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { registry, provider, complete, sinks } = this.deps;
    const maxSteps = this.deps.maxSteps ?? DEFAULT_MAX_STEPS;
    const tools = registry.schemasFor(provider);
    const ctx: ToolContext = { caps: provider, signal: input.signal };
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userContent },
    ];

    let finalOutput = "";
    for (let step = 0; step < maxSteps; step++) {
      if (input.signal?.aborted) return { ok: true, output: finalOutput, cancelled: true, finished: false };

      const { content, toolCalls } = await complete({ messages, tools, model: input.model }, input.signal);
      if (content) {
        finalOutput = content;
        sinks?.onAssistantText?.(content);
      }

      // No tool calls → the model is done.
      if (!toolCalls.length) return { ok: true, output: finalOutput, cancelled: false, finished: true };

      messages.push({ role: "assistant", content, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const name = tc.function?.name ?? "unknown";
        let args: Record<string, unknown> = {};
        try {
          args = tc.function?.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
        } catch {
          /* leave empty */
        }
        const toolCallId = tc.id ?? "";
        sinks?.onToolUse?.(name, toolCallId, args);

        const result = await registry.dispatch(name, args, ctx);
        const toolResult: Record<string, unknown> = result.data;
        sinks?.onToolResult?.(name, toolCallId, toolResult);

        if (result.control?.kind === "finish") {
          if (result.control.summary) finalOutput = result.control.summary;
          messages.push({ role: "tool", tool_call_id: tc.id ?? "", content: JSON.stringify({ ok: true }) });
          return { ok: true, output: finalOutput, cancelled: false, finished: true };
        }
        if (result.control?.kind === "ask_human") {
          messages.push({ role: "tool", tool_call_id: tc.id ?? "", content: JSON.stringify(toolResult) });
          return {
            ok: true,
            output: finalOutput,
            cancelled: false,
            finished: false,
            awaitingInput: { approvalId: result.control.approvalId ?? "", question: result.control.question },
          };
        }

        messages.push({ role: "tool", tool_call_id: tc.id ?? "", content: JSON.stringify(toolResult) });
      }
    }

    return { ok: true, output: finalOutput, cancelled: false, finished: true };
  }
}

/**
 * A pi-free {@link LlmComplete} backed by the gateway's OpenAI-compatible
 * `/v1/chat/completions` endpoint over `fetch` — the replacement for `pi-ai`'s model
 * client in the local engine. Kept tiny and dependency-free.
 */
export function createGatewayComplete(opts: { baseUrl: string; apiKey: string }): LlmComplete {
  const endpoint = `${opts.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  return async (req, signal) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        ...(req.model ? { model: req.model } : {}),
        messages: req.messages,
        tools: req.tools,
        tool_choice: "auto",
      }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`gateway ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> }
      | null;
    const choice = json?.choices?.[0]?.message;
    return {
      content: typeof choice?.content === "string" ? choice.content : "",
      toolCalls: Array.isArray(choice?.tool_calls) ? (choice.tool_calls as RawToolCall[]) : [],
    };
  };
}
