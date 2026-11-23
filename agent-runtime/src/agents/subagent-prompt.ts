/**
 * subagent-prompt — the child prompt of the session-based `sessions_spawn` path.
 *
 * What a child IS told about its relationship to its owner is decided once, in `@builderforce/agent-loop`
 * (`subagentSystemPrompt`), so the cloud, the editor and this on-prem spawn delegate to the same child. This file adds only what is
 * true of the SESSION path alone: how its own tools reach descendants (`sessions_spawn`, `subagents`), how to recover compacted tool
 * output, and the session keys the child can see. The depth cap is the one cap (`MAX_SUBAGENT_DEPTH`).
 */

import { MAX_SUBAGENT_DEPTH, subagentSystemPrompt } from "@builderforce/agent-loop";
import type { DeliveryContext } from "../utils/delivery-context.js";

/** The deepest spawn depth a config may allow: the one cap every surface's children share. */
export function effectiveMaxSpawnDepth(configured: number | undefined): number {
  return Math.min(typeof configured === "number" ? configured : 1, MAX_SUBAGENT_DEPTH);
}

export function buildSubagentSessionPrompt(params: {
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
  const maxSpawnDepth = effectiveMaxSpawnDepth(params.maxSpawnDepth);
  const owner = childDepth >= 2 ? "the parent orchestrator" : "the main agent";

  const lines = [
    subagentSystemPrompt(undefined, { owner }),
    "",
    `You were created to handle: ${taskText}`,
    "Trust push-based completion: descendant results are auto-announced back to you; do not busy-poll for status.",
    "Recover from compacted/truncated tool output: if you see `[compacted: tool output removed to free context]` or `[truncated: output exceeded context limit]`, assume prior output was reduced. Re-read only what you need using smaller chunks (`read` with offset/limit, or targeted `rg`/`head`/`tail`) instead of full-file `cat`.",
    `Only use the \`message\` tool when explicitly instructed to contact a specific external recipient; otherwise return plain text and let ${owner} deliver it.`,
    "",
  ];

  if (childDepth < maxSpawnDepth) {
    lines.push(
      "## Sub-Agent Spawning",
      "You CAN spawn your own sub-agents for parallel or complex work using `sessions_spawn`.",
      "Use the `subagents` tool to steer, kill, or do an on-demand status check for your spawned sub-agents.",
      "Your sub-agents will announce their results back to you automatically (not to the main agent).",
      "Default workflow: spawn work, continue orchestrating, and wait for auto-announced completions.",
      "Do NOT repeatedly poll `subagents list` in a loop unless you are actively debugging or intervening.",
      "Coordinate their work and synthesize results before reporting back.",
      "",
    );
  } else if (childDepth >= 2) {
    lines.push(
      "## Sub-Agent Spawning",
      "You are a leaf worker and CANNOT spawn further sub-agents. Focus on your assigned task.",
      "",
    );
  }

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
