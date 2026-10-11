/**
 * Delegation — the tool an agent uses to hand a self-contained slice of its task to
 * a child run and get back one answer instead of a hundred turns of searching.
 *
 * Its own module rather than `core-tools.ts` for the same reason skill authoring is:
 * it is a different concern (a run commissioning another run, not a run doing its
 * task) and a surface advertises it separately — only where the provider actually
 * backs `orchestrate`.
 *
 * Two shapes behind one schema. Where the surface grants `orchestrate.live` (the
 * editor's run host, the durable cloud runner) a child is its own run: the call returns
 * its handle at once, the parent keeps working, and `live-subagent-tools.ts` gives it
 * the verbs to wait for, redirect and stop it. Elsewhere (the images) the child runs
 * inside the call and the call returns its answer.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";
import type { SubagentResult } from "./capabilities.js";
import { delegationRole, MODEL_ROLES, MODEL_ROLE_DESCRIPTIONS } from "./modelRoles.js";
import { normalizeScopePath, overlappingScopes } from "./workstreamScope.js";
import { LIVE_FANOUT_NEXT, SUBAGENT_CONTROL_TOOLS } from "./live-subagent-tools.js";

const ROLE_ENUM_DESCRIPTION = MODEL_ROLES
  .map((role) => `${role} — ${MODEL_ROLE_DESCRIPTIONS[role]}`)
  .join(" · ");

export const spawnAgentTool: ToolDefinition = defineTool({
  name: "spawn_agent",
  description:
    "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back a single answer. Use it when finding something out would take many turns you do not want to carry — locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose — it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two. A CHANGE may be delegated (read_only: false) when the user asked for sub-agents or the slice is a ticket of its own — you then verify what the child changed, because you are accountable for what ships.",
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
      role: {
        type: "string",
        enum: [...MODEL_ROLES],
        description:
          `What kind of call the child's turns are — lets the surface pick a model suited to the work rather than reusing yours. Defaults to 'explore' when read_only, else 'code'. ${ROLE_ENUM_DESCRIPTION}`,
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
    // Default-deny on writes: an unspecified `read_only` is the investigative case,
    // which is what delegation is for. Only an explicit `false` widens it.
    const readOnly = args.read_only !== false;
    const role = delegationRole(args.role, readOnly);
    // An empty `as_agent` is an anonymous delegation, not a request for an agent
    // named "" — so it is dropped rather than sent for the surface to fail to resolve.
    const asAgent = str(args.as_agent);
    const r = (await ctx.caps.orchestration!.spawn({
      label: label || task.slice(0, 60),
      task,
      readOnly,
      role,
      ...(asAgent ? { asAgent } : {}),
    })) as SubagentResult;
    return { data: r as unknown as Record<string, unknown>, ...(r.ok ? {} : { isError: true }) };
  },
});

// ── Several children, side by side ──────────────────────────────────────────────
//
// `spawn_agent` runs one child per call, and a turn's calls are dispatched in sequence,
// so three delegations in one turn ran one after another. `spawn_agents` starts up to
// MAX_WORKSTREAMS children in ONE call and waits for all of them — what a planner's
// hand-off fans its tasks out to. The schema, the parsing and the conflict policy are
// here, once; each surface supplies only how a child RUNS (the editor in its own
// process, the cloud through `orchestrate`).
//
// The conflict policy is what makes concurrent writers in one tree safe:
//   • a writable fan-out gives every workstream the `paths` it owns, and refuses to
//     start when two workstreams' paths overlap (`workstreamScope.ts`);
//   • a child may write only inside its own paths;
//   • a child gets no shell and no git — those reach the whole tree whatever a scope
//     says. The PARENT verifies, commits and pushes once every slice is back.

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
  paths: string[];
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
    const paths = Array.isArray(w.paths)
      ? w.paths.filter((p): p is string => typeof p === "string" && normalizeScopePath(p) !== "")
      : [];
    const ticket = str(w.ticket);
    const role = str(w.role);
    out.push({
      label: str(w.label) || task.slice(0, 60),
      task,
      paths,
      ...(ticket ? { ticket } : {}),
      ...(role ? { role } : {}),
      asAgent: str(w.as_agent),
    });
  }
  return out;
}

/**
 * Why a WRITABLE fan-out must not start, or null. Checked before any child runs: a
 * conflict found halfway through would leave some slices written and the rest not.
 */
export function workstreamScopeError(workstreams: readonly Workstream[]): string | null {
  const unscoped = workstreams.find((w) => w.paths.length === 0);
  if (unscoped) {
    return `workstream '${unscoped.label}' has no paths — a change made side by side must name the files or directories it owns`;
  }
  const clash = overlappingScopes(workstreams.map((w) => ({ label: w.label, paths: w.paths })));
  return clash
    ? `workstreams '${clash.a}' and '${clash.b}' both claim '${clash.path}' — give each file to exactly one workstream, or run the dependent slices one after another with spawn_agent`
    : null;
}

/** What the parent is told to do once a WRITABLE fan-out is back. */
export const FANOUT_NEXT =
  "The children had no shell and no git. Verify the combined change (build and test), fix what the slices broke between them, commit, and report per workstream and ticket.";

export const spawnAgentsTool: ToolDefinition = defineTool({
  name: SPAWN_AGENTS_TOOL,
  description:
    `Run SEVERAL independent workstreams side by side — up to ${MAX_WORKSTREAMS} child agents at once, each in its own context, each reporting back to the chat. ` +
    "Use it when the request splits into slices that do not depend on each other: a PRD's workstreams, one change per package or feature. " +
    "For a CHANGE (read_only: false) give every workstream the `paths` it OWNS (files or directories). Paths must not overlap, and a child may write only inside its own. " +
    "Children read anywhere but have no shell and no git: when they return, YOU verify (build and test), commit and report per workstream. " +
    "File one ticket per workstream first and pass its id as `ticket`. Each child sees nothing of this conversation, so every `task` must stand alone: what to change, where, and how to know it is done.",
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
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Workspace-relative files or directories this workstream OWNS and may write. Required for a change; must not overlap another workstream's.",
            },
            ticket: { type: "string", description: "The ticket this workstream delivers, echoed in the result." },
            role: { type: "string", enum: [...MODEL_ROLES], description: "Model role for the child. Defaults to code for a change, explore otherwise." },
            as_agent: { type: "string", description: "Run this workstream AS one of the workspace's agents (its name or id). Optional: omit it when no teammate's role fits, and the child runs as a plain sub-agent." },
          },
          required: ["label", "task"],
        },
      },
      read_only: {
        type: "boolean",
        description: "Default true — parallel investigations. Pass false to have the children MAKE their changes.",
      },
    },
    required: ["workstreams"],
  },
  requires: ["orchestrate.fanout"],
  // The CLOUD form: each child is one `orchestrate` spawn, all started at once. The
  // backing serializes their commits and holds each to its scope (`cloudSubagent.ts`).
  // The editor runs its children in its own process (`subagentFanOutTool.ts`) on the
  // same schema, parser and conflict policy.
  async execute(args, ctx): Promise<ToolResult> {
    const parsed = parseWorkstreams(args.workstreams);
    if (typeof parsed === "string") return { data: { ok: false, error: parsed } };
    const readOnly = args.read_only !== false;
    if (!readOnly) {
      const conflict = workstreamScopeError(parsed);
      if (conflict) return { data: { ok: false, error: conflict } };
    }
    const outputChars = Math.floor(FANOUT_OUTPUT_CHARS / parsed.length);
    const results = await Promise.all(parsed.map((w) => ctx.caps.orchestration!.spawn({
      label: w.label,
      task: w.task,
      readOnly,
      role: delegationRole(w.role, readOnly),
      outputChars,
      ...(readOnly ? {} : { scope: w.paths }),
      ...(w.ticket ? { ticket: w.ticket } : {}),
      ...(w.asAgent ? { asAgent: w.asAgent } : {}),
    }).then((r) => ({ label: w.label, ...r }))));
    const changedFiles = [...new Set(results.flatMap((r) => r.changedFiles ?? []))];
    // Background children have only STARTED — the parent verifies once their reports are in.
    const started = results.some((r) => r.running);
    return {
      data: {
        ok: results.every((r) => r.ok),
        workstreams: results,
        ...(changedFiles.length ? { changedFiles } : {}),
        ...(readOnly ? {} : { next: started ? LIVE_FANOUT_NEXT : FANOUT_NEXT }),
      },
    };
  },
});

/** The delegation tools, for a surface that backs `orchestrate`. The owner's verbs
 *  require `orchestrate.live`, so they are offered only where children run live. */
export const SUBAGENT_TOOLS: readonly ToolDefinition[] = [spawnAgentTool, spawnAgentsTool, ...SUBAGENT_CONTROL_TOOLS];
