/**
 * subagent-prompt — the child prompt of the session-based `sessions_spawn` path.
 *
 * What a child IS told about its relationship to its owner is decided once, in `@builderforce/agent-loop`
 * (`subagentSystemPrompt`), so the cloud, the editor and this on-prem spawn delegate to the same child. This file adds only what is
 * true of the SESSION path alone: recovery of compacted output and session context.
 */

import { MAX_SUBAGENT_DEPTH, subagentSystemPrompt } from "@builderforce/agent-loop";
import type { DeliveryContext } from "../utils/delivery-context.js";

/** The deepest spawn depth a config may allow: the one cap every surface's children share. */
export function effectiveMaxSpawnDepth(configured: number | undefined): number {
  return Math.min(typeof configured === "number" ? configured : 1, MAX_SUBAGENT_DEPTH);
}

export function buildSubagentSessionPrompt(params: {
  /** Prepared by the shared child start; optional for standalone prompt consumers. */
  standingPrompt?: string;
  requesterSessionKey?: string;
  requesterOrigin?: DeliveryContext;
  childSessionKey: string;
  label?: string;
  task?: string;
  /** Depth of the child being spawned (1 = sub-agent, 2 = sub-sub-agent). */
  childDepth?: number;
  /** Config value: max allowed spawn depth. */
  maxSpawnDepth?: number;
}): string {
  const taskText = params.task?.trim() ? params.task.replace(/\s+/g, " ").trim() : "{{TASK_DESCRIPTION}}";
  const childDepth = typeof params.childDepth === "number" ? params.childDepth : 1;
  const owner = childDepth >= 2 ? "the parent orchestrator" : "the main agent";

  const lines = [
    params.standingPrompt ?? subagentSystemPrompt(undefined, { owner }),
    "",
    `You were created to handle: ${taskText}`,
    "Recover from compacted/truncated tool output: if you see `[compacted: tool output removed to free context]` or `[truncated: output exceeded context limit]`, assume prior output was reduced. Re-read only what you need using smaller chunks (`read` with offset/limit, or targeted `rg`/`head`/`tail`) instead of full-file `cat`.",
    `Only use the \`message\` tool when explicitly instructed to contact a specific external recipient; otherwise return plain text and let ${owner} deliver it.`,
    "",
    // The session path's channel-safety rules: a session child shares the owner's channels, so it must not act on them unasked.
    "## Channel Safety",
    "- **Don't initiate** - No heartbeats, no proactive actions, no side quests",
    "- **Be ephemeral** - You may be terminated after task completion. That's fine.",
    `- NO user conversations (that's ${owner}'s job)`,
    "- NO external messages (email, tweets, etc.) unless explicitly tasked with a specific recipient/channel",
    "- NO cron jobs or persistent state",
    `- NO pretending to be ${owner}`,
    "",
    "## Output Format",
    "When complete, your final response should include:",
    "- What you accomplished or found",
    `- Any relevant details ${owner} should know`,
    "- Keep it concise but informative",
    "",
  ];

  lines.push(
    "## Session Context",
    ...[
      params.label ? `- Label: ${params.label}` : undefined,
      params.requesterSessionKey ? `- Requester session: ${params.requesterSessionKey}.` : undefined,
      params.requesterOrigin?.channel ? `- Requester channel: ${params.requesterOrigin.channel}.` : undefined,
      `- Your session: ${params.childSessionKey}.`,
    ].filter((line): line is string => line !== undefined),
    "",
  );
  return lines.join("\n");
}
