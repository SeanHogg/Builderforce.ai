/**
 * Delegation — the tool an agent uses to hand a self-contained slice of its task to
 * a child run and get back one answer instead of a hundred turns of searching.
 *
 * Its own module rather than `core-tools.ts` for the same reason skill authoring is:
 * it is a different concern (a run commissioning another run, not a run doing its
 * task) and a surface advertises it separately — only where the provider actually
 * backs `orchestrate`.
 *
 * The contract is deliberately one-shot. There is no handle, no polling, no
 * "check on the child later": the call returns when the child is done. A parent
 * that could hold live children would need a scheduler, and the surfaces that run
 * this (a per-tick durable object, a billed-by-the-second container) have nowhere
 * to keep one.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";
import type { SubagentResult } from "./capabilities.js";

export const spawnAgentTool: ToolDefinition = defineTool({
  name: "spawn_agent",
  description:
    "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back a single answer. Use it when finding something out would take many turns you do not want to carry — locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose — it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two, and do NOT delegate the actual writing of the deliverable: you are accountable for what ships.",
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A few words naming the delegation, e.g. 'locate the auth middleware'. Shown on the run timeline.",
      },
      task: {
        type: "string",
        description:
          "The child's complete brief: what to find out or do, where to look, and exactly what to report back. Assume it knows nothing about the ticket beyond what you write here.",
      },
      read_only: {
        type: "boolean",
        description:
          "Default true — the child may read, search and reason but not modify the working tree. Pass false ONLY when the delegated work is itself an edit you want it to make.",
      },
    },
    required: ["label", "task"],
  },
  requires: ["orchestrate"],
  async execute(args, ctx): Promise<ToolResult> {
    const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const label = str(args.label);
    const task = str(args.task);
    if (!task) return { data: { ok: false, error: "task is required — the child sees none of your conversation" } };
    // Default-deny on writes: an unspecified `read_only` is the investigative case,
    // which is what delegation is for. Only an explicit `false` widens it.
    const readOnly = args.read_only !== false;
    const r = (await ctx.caps.orchestration!.spawn({
      label: label || task.slice(0, 60),
      task,
      readOnly,
    })) as SubagentResult;
    return { data: r as unknown as Record<string, unknown>, ...(r.ok ? {} : { isError: true }) };
  },
});

/** The delegation tools, for a surface that backs `orchestrate`. */
export const SUBAGENT_TOOLS: readonly ToolDefinition[] = [spawnAgentTool];
