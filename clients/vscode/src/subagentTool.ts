/**
 * `spawn_agent` on the MACHINE — start ONE sub-agent alongside this run.
 *
 * Same schema as the cloud's (`@builderforce/agent-tools`), so a model that learned to
 * delegate in one surface delegates identically in the other. What differs here is that
 * the child does not run inside this tool call: it is started as an ordinary run with an
 * owner pointer (`childRunSpawner.ts`), the call returns its handle at once, and this run
 * keeps working. The child's report arrives in this run's inbox when it settles.
 *
 * The child is a CLONE of this run: the same catalog, the same approval gate, the same
 * execution. Nothing here decides what it may do.
 */

import { schemaForCapabilities, spawnAgentTool, delegationRole } from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import { EDITOR_DELEGATION_CAPS } from "./localCapabilities";
import { resolveChildPersona, type SubagentToolDeps } from "./childPersona";

export function subagentToolDef(deps: SubagentToolDeps & Required<Pick<SubagentToolDeps, "children">>): ToolDef {
  const schema = schemaForCapabilities(spawnAgentTool, EDITOR_DELEGATION_CAPS).function;
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters as Record<string, unknown>,
    // Starting a child changes nothing; its calls raise their OWN prompts, as its owner's do.
    mutating: false,
    execute: async (args) => {
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      const task = str(args.task);
      const label = str(args.label) || task.slice(0, 60);
      if (!task) {
        return JSON.stringify({ ok: false, error: "task is required — the child sees none of your conversation" });
      }
      const role = delegationRole(args.role);
      // WHO does this slice. An unresolvable name is REFUSED rather than run anonymously.
      const who = await resolveChildPersona(deps, str(args.as_agent), role);
      if (!who.ok) return JSON.stringify({ ok: false, label, error: who.error });
      const started = deps.children.spawn({
        label,
        task,
        role,
        ...(who.persona ? { persona: who.persona } : {}),
        ...(who.asAgent ? { asAgent: who.asAgent } : {}),
      });
      return JSON.stringify({
        ...started,
        ...(started.ok ? { running: true } : {}),
        ...(who.note ? { staffing: who.note } : {}),
      });
    },
  };
}
