/**
 * `spawn_agents` — several delegated children, side by side, on the MACHINE.
 *
 * WHY: chat #126 was handed a PRD with eight named workstreams and worked through them
 * one tool call at a time for 76 turns, with zero delegations. `spawn_agent` could not
 * have helped: the kernel dispatches a turn's calls in sequence, so three delegations in
 * one turn ran one after another, and a child had eight steps. This tool starts up to
 * {@link MAX_WORKSTREAMS} children in ONE call and waits for all of them.
 *
 * The conflict policy is what makes concurrent writers in one working tree safe:
 *   • a writable fan-out gives every workstream the `paths` it owns, and refuses to start
 *     when two workstreams' paths overlap (`workstreamScope.ts`);
 *   • a child may write only inside its own paths — anything else is refused before the
 *     human is even asked;
 *   • a child gets reads and the file writers only — no shell, no git — because those
 *     reach the whole tree whatever a scope says. The PARENT verifies, commits and
 *     pushes once every slice is back;
 *   • approval prompts queue (`childWriteGate.ts`), one on screen at a time.
 *
 * Editor-only on purpose. The cloud surfaces edit over the git API, where concurrent
 * children would race each other's commits to one branch ref; there, `spawn_agent`
 * stays the only delegation tool.
 */

import { delegationRole } from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import { resolveChildPersona, runLocalChild, workstreamToolDefs, type ChildReport, type SubagentToolDeps } from "./subagentRun";
import { WRITE_DECLINED } from "./subagentTool";
import { normalizeScopePath, overlappingScopes } from "./workstreamScope";

/** Children one call may start. Enough for a PRD's independent slices; few enough that
 *  their approval prompts and model calls stay readable and inside provider rate limits. */
export const MAX_WORKSTREAMS = 4;

/** The answer budget the children SHARE: the whole result must fit the parent's
 *  per-result window, so each child's answer is capped at its share of this. */
export const FANOUT_OUTPUT_CHARS = 4800;

export const SPAWN_AGENTS_TOOL = "spawn_agents";

const DESCRIPTION =
  `Run SEVERAL independent workstreams side by side — up to ${MAX_WORKSTREAMS} child agents at once, each in its own context, each reporting back. ` +
  "Use it when the request splits into slices that do not depend on each other: a PRD's workstreams, one change per package or feature. " +
  "For a CHANGE (read_only: false) give every workstream the `paths` it OWNS (files or directories). Paths must not overlap, and a child may write only inside its own. " +
  "Children read anywhere but have no shell and no git: when they return, YOU verify (build and test), commit and report per workstream. " +
  "File one ticket per workstream first and pass its id as `ticket`. Each child sees nothing of this conversation, so every `task` must stand alone: what to change, where, and how to know it is done.";

const PARAMETERS: Record<string, unknown> = {
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
          role: { type: "string", description: "Model role for the child: explore, plan, code, verify, chat or utility. Defaults to code for a change." },
          as_agent: { type: "string", description: "Run this workstream AS one of the workspace's agents (its name or id)." },
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
};

interface Workstream {
  label: string;
  task: string;
  paths: string[];
  ticket?: string;
  role?: string;
  asAgent: string;
}

function parseWorkstreams(raw: unknown): Workstream[] | string {
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

export function subagentFanOutToolDef(deps: SubagentToolDeps): ToolDef {
  return {
    name: SPAWN_AGENTS_TOOL,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    // As with `spawn_agent`: every write a child makes raises its own prompt.
    mutating: false,
    execute: async (args, root) => {
      const parsed = parseWorkstreams(args.workstreams);
      if (typeof parsed === "string") return JSON.stringify({ ok: false, error: parsed });
      const asked = args.read_only === false;
      const writable = asked && !!deps.run?.confirmWrite;

      // Scopes are checked BEFORE anything starts: a conflict found halfway through would
      // leave some slices written and the rest not.
      if (writable) {
        const unscoped = parsed.find((w) => w.paths.length === 0);
        if (unscoped) {
          return JSON.stringify({
            ok: false,
            error: `workstream '${unscoped.label}' has no paths — a change made side by side must name the files or directories it owns`,
          });
        }
        const clash = overlappingScopes(parsed.map((w) => ({ label: w.label, paths: w.paths })));
        if (clash) {
          return JSON.stringify({
            ok: false,
            error: `workstreams '${clash.a}' and '${clash.b}' both claim '${clash.path}' — give each file to exactly one workstream, or run the dependent slices one after another with spawn_agent`,
          });
        }
      }

      // Every persona resolves before any child starts, for the same reason.
      const people = await Promise.all(parsed.map((w) => resolveChildPersona(deps, w.asAgent)));
      const refused = people.findIndex((p) => !p.ok);
      if (refused >= 0) {
        const who = people[refused] as { ok: false; error: string };
        return JSON.stringify({ ok: false, error: `workstream '${parsed[refused]!.label}': ${who.error}` });
      }

      const tools = workstreamToolDefs(deps.catalog(), writable);
      const outputChars = Math.floor(FANOUT_OUTPUT_CHARS / parsed.length);
      const reports: ChildReport[] = await Promise.all(
        parsed.map((w, i) => {
          const who = people[i] as Extract<(typeof people)[number], { ok: true }>;
          return runLocalChild(deps, {
            label: who.asAgent ? `as ${who.asAgent.name}: ${w.label}` : w.label,
            task: w.task,
            writable,
            role: delegationRole(w.role, !writable),
            tools,
            outputChars,
            ...(writable ? { scope: w.paths } : {}),
            ...(w.ticket ? { ticket: w.ticket } : {}),
            ...(who.persona ? { persona: who.persona } : {}),
            ...(who.asAgent ? { asAgent: who.asAgent } : {}),
          }, root);
        }),
      );

      // The union rides at the TOP level too: the parent's code-change backstop and the
      // diagnostics read `changedFiles` / `placeholders` off the delegation result.
      const changedFiles = [...new Set(reports.flatMap((r) => r.changedFiles ?? []))];
      const placeholders = reports.flatMap((r) => r.placeholders ?? []);
      return JSON.stringify({
        ok: reports.every((r) => r.ok),
        workstreams: reports,
        ...(changedFiles.length ? { changedFiles } : {}),
        ...(placeholders.length ? { placeholders } : {}),
        ...(asked && !writable ? { writeDeclined: WRITE_DECLINED } : {}),
        ...(writable
          ? { next: "The children had no shell and no git. Verify the combined change (build and test), fix what the slices broke between them, commit, and report per workstream and ticket." }
          : {}),
      });
    },
  };
}
