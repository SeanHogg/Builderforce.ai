/**
 * `spawn_agents` — several delegated children, side by side, on the MACHINE.
 *
 * WHY: chat #126 was handed a PRD with eight named workstreams and worked through them
 * one tool call at a time for 76 turns, with zero delegations. `spawn_agent` could not
 * have helped: the kernel dispatches a turn's calls in sequence, so three delegations in
 * one turn ran one after another. This tool starts up to `MAX_WORKSTREAMS` children in
 * ONE call and waits for all of them — and it is what a planner's `hand_off` fans its
 * tasks out to.
 *
 * The schema, the argument parsing and the conflict policy (owned paths, no overlap, no
 * shell or git for a child) are the shared ones in `@builderforce/agent-tools`, so the
 * editor and the cloud cannot disagree on what a workstream is. What is editor-shaped is
 * only how a child RUNS: in this process, through `runLocalChild`, with approval prompts
 * queued one at a time (`childWriteGate.ts`) and each child's report posted to the chat
 * as it lands.
 */

import {
  delegationRole,
  FANOUT_NEXT,
  FANOUT_OUTPUT_CHARS,
  parseWorkstreams,
  spawnAgentsTool,
  workstreamScopeError,
} from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import { resolveChildPersona, runLocalChild, workstreamToolDefs, type ChildReport, type SubagentToolDeps } from "./subagentRun";
import { WRITE_DECLINED } from "./subagentTool";

export { MAX_WORKSTREAMS, FANOUT_OUTPUT_CHARS } from "@builderforce/agent-tools";

export const SPAWN_AGENTS_TOOL = spawnAgentsTool.name;

export function subagentFanOutToolDef(deps: SubagentToolDeps): ToolDef {
  const schema = spawnAgentsTool.schema.function;
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters as Record<string, unknown>,
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
        const conflict = workstreamScopeError(parsed);
        if (conflict) return JSON.stringify({ ok: false, error: conflict });
      }

      // Every persona resolves before any child starts, for the same reason.
      // Each slice's role first: it decides which teammates may take it (Developer for
      // code, QA for verify).
      const roles = parsed.map((w) => delegationRole(w.role, !writable));
      const people = await Promise.all(parsed.map((w, i) => resolveChildPersona(deps, w.asAgent, roles[i]!)));
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
            role: roles[i]!,
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
        ...(writable ? { next: FANOUT_NEXT } : {}),
      });
    },
  };
}
