/**
 * `spawn_agents` — several sub-agents, side by side, on the MACHINE.
 *
 * WHY: chat #126 was handed a PRD with eight named workstreams and worked through them
 * one tool call at a time. This starts up to `MAX_WORKSTREAMS` children in ONE call — and
 * it is what a planner's `hand_off` fans its tasks out to.
 *
 * The schema and the parsing are the shared ones in `@builderforce/agent-tools`. What is
 * editor-shaped is only how a child RUNS: as an ordinary run with an owner pointer
 * (`childRunSpawner.ts`) — a clone of its owner — started here and left working; the
 * call returns every handle at once and the owner carries on.
 */

import {
  LIVE_FANOUT_NEXT,
  delegationRole,
  parseWorkstreams,
  spawnAgentsTool,
} from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import { resolveChildPersona, type SubagentToolDeps } from "./childPersona";

export { LIVE_FANOUT_NEXT, MAX_WORKSTREAMS } from "@builderforce/agent-tools";

export function subagentFanOutToolDef(deps: SubagentToolDeps & Required<Pick<SubagentToolDeps, "children">>): ToolDef {
  const schema = spawnAgentsTool.schema.function;
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters as Record<string, unknown>,
    // As with `spawn_agent`: every call a child makes raises its own prompt.
    mutating: false,
    execute: async (args) => {
      const parsed = parseWorkstreams(args.workstreams);
      if (typeof parsed === "string") return JSON.stringify({ ok: false, error: parsed });
      // Every persona resolves before any child starts: a refusal found halfway through
      // would leave some slices started and the rest not.
      const roles = parsed.map((w) => delegationRole(w.role));
      const people = await Promise.all(parsed.map((w, i) => resolveChildPersona(deps, w.asAgent, roles[i]!, w.ticket)));
      const refused = people.findIndex((p) => !p.ok);
      if (refused >= 0) {
        const who = people[refused] as { ok: false; error: string };
        return JSON.stringify({ ok: false, error: `workstream '${parsed[refused]!.label}': ${who.error}` });
      }

      const agents = parsed.map((w, i) => {
        const who = people[i] as Extract<(typeof people)[number], { ok: true }>;
        const started = deps.children.spawn({
          label: w.label,
          task: w.task,
          role: roles[i]!,
          ...(w.ticket ? { ticket: w.ticket } : {}),
          ...(who.persona ? { persona: who.persona } : {}),
          ...(who.asAgent ? { asAgent: who.asAgent } : {}),
        });
        return { ...started, ...(w.ticket ? { ticket: w.ticket } : {}), ...(who.note ? { staffing: who.note } : {}) };
      });
      return JSON.stringify({
        ok: agents.every((a) => a.ok),
        running: true,
        agents,
        next: LIVE_FANOUT_NEXT,
      });
    },
  };
}
