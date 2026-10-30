/**
 * Delegation — the tool an agent uses to hand a self-contained slice of its task to
 * a child run and get back one answer instead of a hundred turns of searching.
 *
 * Its own module rather than `core-tools.ts` for the same reason skill authoring is:
 * it is a different concern (a run commissioning another run, not a run doing its
 * task) and a surface advertises it separately — only where the provider actually
 * backs `orchestrate`.
 *
 * ONE shape on every surface — the editor's run host and every cloud surface alike: a
 * child is a CLONE of the run that spawned it — the same tools, the same execution, one
 * level down — doing the slice it was handed. The call returns its handle at once, the
 * parent keeps working, and `live-subagent-tools.ts` gives it the verbs to wait for,
 * redirect and stop it.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";
import type { SubagentResult } from "./capabilities.js";
import { delegationRole, MODEL_ROLES, MODEL_ROLE_DESCRIPTIONS } from "./modelRoles.js";
import { LIVE_DELEGATION_NOTE, LIVE_FANOUT_NEXT, SUBAGENT_CONTROL_TOOLS, withDelegationNote } from "./live-subagent-tools.js";

const ROLE_ENUM_DESCRIPTION = MODEL_ROLES
  .map((role) => `${role} — ${MODEL_ROLE_DESCRIPTIONS[role]}`)
  .join(" · ");

export const spawnAgentTool: ToolDefinition = withDelegationNote(defineTool({
  name: "spawn_agent",
  description:
    "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back when it is done. Use it when finding something out would take many turns you do not want to carry — locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose — it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two. The child is a clone of you: it holds every tool you hold and carries its slice out end to end — investigating, editing, running commands, recording the work. You remain accountable for what ships, so check what it reports. " + LIVE_DELEGATION_NOTE,
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
      role: {
        type: "string",
        enum: [...MODEL_ROLES],
        description:
          `What kind of call the child's turns are — lets the surface pick a model suited to the work rather than reusing yours. Defaults to 'code'. ${ROLE_ENUM_DESCRIPTION}`,
      },
      as_agent: {
        type: "string",
        description:
          "Run the child AS one of the workspace's agents — its id or name (e.g. 'Ada'). The child adopts that agent's role, bio, skills and personality so the delegated slice is done in that agent's voice and expertise. Prefer an agent already in this chat (builtin_chats_list_agents) or from builtin_cloud_agents_list_mine. Optional: when no teammate's role fits the slice, omit it and the child runs as a plain sub-agent.",
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
    const role = delegationRole(args.role);
    // An empty `as_agent` is an anonymous delegation, not a request for an agent
    // named "" — so it is dropped rather than sent for the surface to fail to resolve.
    const asAgent = str(args.as_agent);
    const r = (await ctx.caps.orchestration!.spawn({
      label: label || task.slice(0, 60),
      task,
      role,
      ...(asAgent ? { asAgent } : {}),
    })) as SubagentResult;
    return { data: r as unknown as Record<string, unknown>, ...(r.ok ? {} : { isError: true }) };
  },
}));

// ── Several children, side by side ──────────────────────────────────────────────
//
// `spawn_agents` starts up to MAX_WORKSTREAMS children in ONE call — what a planner's
// hand-off fans its tasks out to. The schema, the parsing and the conflict policy are
// here, once; each surface supplies only how a child STARTS (the editor as a run in its
// own process, the cloud as a durable execution through `orchestrate`). Every child is a
// clone of the parent, exactly as with `spawn_agent` — side by side is a schedule, not a
// restriction. Keeping the slices apart is the PLANNER's job (`planHandoff.ts` runs side
// by side only tasks whose paths do not overlap).

/** Children one call may start. Enough for a PRD's independent slices; few enough that
 *  their approval prompts and model calls stay readable and inside provider rate limits. */
export const MAX_WORKSTREAMS = 4;

/** The answer budget the children SHARE: the whole result must fit the parent's
 *  per-result window, so each child's answer is capped at its share of this. */
export const FANOUT_OUTPUT_CHARS = 4800;

export const SPAWN_AGENTS_TOOL = "spawn_agents";

/** One parsed workstream. */
export interface Workstream {
  label: string;
  task: string;
  ticket?: string;
  role?: string;
  asAgent: string;
}

/** Validate the workstreams. A string is the corrective the parent's model is handed. */
export function parseWorkstreams(raw: unknown): Workstream[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "workstreams is required — one entry per independent slice";
  if (raw.length > MAX_WORKSTREAMS) {
    return `at most ${MAX_WORKSTREAMS} workstreams per call — run the rest in a second call once these are back`;
  }
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const out: Workstream[] = [];
  for (const [i, item] of raw.entries()) {
    const w = (item ?? {}) as Record<string, unknown>;
    const task = str(w.task);
    if (!task) return `workstream ${i + 1} has no task — each child sees none of your conversation`;
    const ticket = str(w.ticket);
    const role = str(w.role);
    out.push({
      label: str(w.label) || task.slice(0, 60),
      task,
      ...(ticket ? { ticket } : {}),
      ...(role ? { role } : {}),
      asAgent: str(w.as_agent),
    });
  }
  return out;
}

export const spawnAgentsTool: ToolDefinition = withDelegationNote(defineTool({
  name: SPAWN_AGENTS_TOOL,
  description:
    `Run SEVERAL independent workstreams side by side — up to ${MAX_WORKSTREAMS} child agents at once, each in its own context, each reporting back to the chat. ` +
    "Use it when the request splits into slices that do not depend on each other: a PRD's workstreams, one change per package or feature. " +
    "Each child is a clone of you with every tool you hold, and carries its slice out end to end. Give slices that do not touch the same files, so they do not overwrite each other; once their reports are in, check the combined result and report per workstream. " +
    "File one ticket per workstream first and pass its id as `ticket`. Each child sees nothing of this conversation, so every `task` must stand alone: what to change, where, and how to know it is done. " +
    LIVE_DELEGATION_NOTE,
  parameters: {
    type: "object",
    properties: {
      workstreams: {
        type: "array",
        minItems: 1,
        maxItems: MAX_WORKSTREAMS,
        description: "One entry per independent slice of the work.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "A few words naming the workstream, e.g. 'W8: company → project'." },
            task: { type: "string", description: "The child's complete, standalone brief." },
            ticket: { type: "string", description: "The ticket this workstream delivers, echoed in the result." },
            role: { type: "string", enum: [...MODEL_ROLES], description: "Model role for the child. Defaults to code." },
            as_agent: { type: "string", description: "Run this workstream AS one of the workspace's agents (its name or id). Optional: omit it when no teammate's role fits, and the child runs as a plain sub-agent." },
          },
          required: ["label", "task"],
        },
      },
    },
    required: ["workstreams"],
  },
  requires: ["orchestrate.fanout"],
  // The CLOUD form: each child is one `orchestrate` spawn — its own durable run. The
  // editor starts its children as runs in its own process (`subagentFanOutTool.ts`) on
  // the same schema and parser.
  async execute(args, ctx): Promise<ToolResult> {
    const parsed = parseWorkstreams(args.workstreams);
    if (typeof parsed === "string") return { data: { ok: false, error: parsed } };
    const outputChars = Math.floor(FANOUT_OUTPUT_CHARS / parsed.length);
    const results = await Promise.all(parsed.map((w) => ctx.caps.orchestration!.spawn({
      label: w.label,
      task: w.task,
      role: delegationRole(w.role),
      outputChars,
      ...(w.ticket ? { ticket: w.ticket } : {}),
      ...(w.asAgent ? { asAgent: w.asAgent } : {}),
    }).then((r) => ({ label: w.label, ...r }))));
    // The children have only STARTED — the parent verifies once their reports are in.
    return {
      data: {
        ok: results.every((r) => r.ok),
        workstreams: results,
        next: LIVE_FANOUT_NEXT,
      },
    };
  },
}));

/** The delegation tools, for a surface that backs `orchestrate`. The owner's verbs
 *  require `orchestrate.live`, so they are offered only where children run live. */
export const SUBAGENT_TOOLS: readonly ToolDefinition[] = [spawnAgentTool, spawnAgentsTool, ...SUBAGENT_CONTROL_TOOLS];
