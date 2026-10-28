/**
 * The default `AgentMessage[]` → LLM `Message[]` conversion the native agent loop
 * (`agent-loop.ts`) and compaction (`compaction.ts`) fold a transcript with.
 */

import type { AgentMessage } from "../model/agent-types.js";
import type { Message } from "../model/types.js";

/** Default identity conversion: fold non-LLM AgentMessages into plain LLM messages. */
export function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "user":
      case "assistant":
      case "toolResult":
        out.push(m);
        break;
      case "compactionSummary":
        out.push({ role: "user", content: m.summary, timestamp: m.timestamp });
        break;
      case "branchSummary":
        out.push({ role: "user", content: m.summary, timestamp: m.timestamp });
        break;
      case "custom":
        if (m.display !== false) {
          const content = typeof m.content === "string" ? m.content : m.content;
          out.push({ role: "user", content, timestamp: m.timestamp });
        }
        break;
      case "bashExecution":
        if (!m.excludeFromContext) {
          out.push({
            role: "user",
            content: `\$ ${m.command}\n${m.output}`,
            timestamp: m.timestamp,
          });
        }
        break;
    }
  }
  return out;
}
