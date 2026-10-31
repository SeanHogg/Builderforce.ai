/**
 * Model hand-off for the embedded runner's own messages: the agent's hand-off packer (`@builderforce/agent-run`
 * `policy/compaction/handoff`) bound to `AgentMessage`.
 *
 * The packing rules (the incoming model's window, the reply reserve from `maxTokens`, the tool schemas' cost, the long-context
 * price boundary of cost lever C9, never splitting a call from its results, the one "Handed off from X to Y." note) are the
 * agent's. A channel run reaches them through the agent's own compaction hook when its model changes; this binder is the same
 * packer for a host that holds `AgentMessage` rows (the runner's session), with the C9 gate read the on-device way (install-id
 * bucketing, a partial rollout) and the note coming back as the `compactionSummary` row every converter folds into the prompt.
 */

import { packForModelHandoff } from "@builderforce/agent-run";
import type { HandoffMessage } from "@seanhogg/builderforce-memory/handoff";
import { priceTierBoundary } from "@builderforce/model-catalog";
import { resolveContextWindowTokens } from "../agents/context-window.js";
import { modelRef } from "../builderforce/agent-loop/stall-recovery.js";
import type { AgentMessage, AgentTool } from "../builderforce/model/agent-types.js";
import type { Model } from "../builderforce/model/types.js";
import { onDeviceCostLeverOn } from "../infra/cost-levers.js";

/** The hand-off view of one row. Rows the packer may drop but never pins (summaries, custom notices, bash output) are measured as assistant context. */
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
  return packForModelHandoff<AgentMessage>(
    {
      messages: input.messages,
      systemPrompt: input.systemPrompt,
      tools: input.tools?.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      from: modelRef(input.from),
      to: modelRef(input.to),
      contextWindow: resolveContextWindowTokens(input.to),
      ...(onDeviceCostLeverOn("c9_price_tier_budget") ? { priceTierBoundary: priceTierBoundary(input.to.id) } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    },
    {
      toHandoff,
      summary: (summary, tokensBefore) => ({ role: "compactionSummary", summary, tokensBefore, timestamp: Date.now() }),
    },
  );
}
