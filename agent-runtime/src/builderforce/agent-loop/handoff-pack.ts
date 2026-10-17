/**
 * Model hand-off for the native agent loop — when a stall failover moves the run onto
 * another model (the operator's declared fallback chain, `createStallFallbackPicker`),
 * the context it inherits is packed for THAT model's window with the shared packer
 * (`@seanhogg/builderforce-memory/handoff`, the one the Brain and the cloud loops use).
 *
 * The packer speaks the OpenAI message shape; this module is the adapter. Each
 * `AgentMessage` is mapped to a hand-off message for measuring and segmenting (an
 * assistant's `toolCall` blocks become `tool_calls`, a `toolResult` becomes `tool`, so
 * a call and its results are never split) and mapped straight back by identity. The
 * system prompt rides along as a `system` message so the budget counts it, then is
 * removed. The ONE note the packer writes for the dropped middle comes back as a
 * `compactionSummary` — the row every converter already folds into the prompt.
 */

import {
  defaultEstimateTokens,
  packHandoff,
  tokensOf,
  type HandoffMessage,
} from "@seanhogg/builderforce-memory/handoff";
import { handoffReserveTokens, toolSchemaTokens } from "@builderforce/run-policy";
import { resolveContextWindowTokens } from "../../agents/context-window.js";
import type { AgentMessage, AgentTool } from "../model/agent-types.js";
import type { Model } from "../model/types.js";
import { modelRef } from "./stall-recovery.js";

/** The hand-off view of one row. Rows the packer may drop but never pins (summaries,
 *  custom notices, bash output) are measured as assistant context. */
function toHandoff(m: AgentMessage): HandoffMessage {
  switch (m.role) {
    case "user":
      return { role: "user", content: m.content };
    case "assistant": {
      const calls = m.content.filter((c) => c.type === "toolCall");
      return {
        role: "assistant",
        content: m.content.filter((c) => c.type !== "toolCall"),
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      };
    }
    case "toolResult":
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    default:
      return { role: "assistant", content: m };
  }
}

/** Tokens the advertised tool schemas cost, by the packer's own estimate. */
// biome-ignore lint/suspicious/noExplicitAny: matches AgentContext.tools
function toolsTokens(tools: readonly AgentTool<any>[] | undefined): number {
  const schemas = tools?.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  return toolSchemaTokens(schemas, defaultEstimateTokens);
}

export interface ModelHandoffInput {
  messages: readonly AgentMessage[];
  systemPrompt: string;
  // biome-ignore lint/suspicious/noExplicitAny: matches AgentContext.tools
  tools?: readonly AgentTool<any>[];
  from: Model;
  to: Model;
  maxTokens?: number;
}

export interface ModelHandoffResult {
  messages: AgentMessage[];
  /** Rows dropped from the context (0 = it already fit; `messages` is the input). */
  dropped: number;
  fits: boolean;
}

/** Pack the run's context for the `to` model's window. */
export async function packContextForModel(input: ModelHandoffInput): Promise<ModelHandoffResult> {
  const back = new Map<HandoffMessage, AgentMessage>();
  const system: HandoffMessage = { role: "system", content: input.systemPrompt };
  const mapped = input.messages.map((m) => {
    const h = toHandoff(m);
    back.set(h, m);
    return h;
  });
  const all = [system, ...mapped];
  const pack = await packHandoff({
    messages: all,
    targetContextTokens: resolveContextWindowTokens(input.to),
    reserveOutputTokens: handoffReserveTokens(input.maxTokens),
    toolsTokens: toolsTokens(input.tools),
    from: modelRef(input.from),
    to: modelRef(input.to),
  });
  if (pack.dropped === 0) return { messages: [...input.messages], dropped: 0, fits: pack.fits };
  const messages: AgentMessage[] = [];
  for (const h of pack.messages) {
    if (h === system) continue;
    const original = back.get(h);
    if (original) {
      messages.push(original);
      continue;
    }
    messages.push({
      role: "compactionSummary",
      summary: typeof h.content === "string" ? h.content : JSON.stringify(h.content),
      tokensBefore: tokensOf(all, defaultEstimateTokens),
      timestamp: Date.now(),
    });
  }
  return { messages, dropped: pack.dropped, fits: pack.fits };
}
