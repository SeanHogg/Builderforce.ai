/**
 * `spawn_agent` on the MACHINE — start ONE sub-agent alongside this run.
 *
 * Same schema as the cloud's (`@builderforce/agent-tools`), so a model that learned to
 * delegate in one surface delegates identically in the other. What differs here is that
 * the child does not run inside this tool call: it is started as an ordinary run with an
 * owner pointer (`childRunSpawner.ts`), the call returns its handle at once, and this run
 * keeps working. The child's report arrives in this run's inbox when it settles.
 *
 * Read-only is the DEFAULT: most delegation is investigation. A writable child is handed
 * write tools only when the host can raise an approval prompt — a surface that cannot
 * ask must never write.
 */

import { spawnAgentTool, delegationRole } from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import { resolveChildPersona, type SubagentToolDeps } from "./childRunPolicy";

/** Message returned when a writable subagent was requested but this host cannot prompt. */
export const WRITE_DECLINED =
  "This host cannot raise an approval prompt, so the sub-agent runs read-only. Its findings are an investigation — make any change yourself.";

export function subagentToolDef(deps: SubagentToolDeps & Required<Pick<SubagentToolDeps, "children">>): ToolDef {
  const schema = spawnAgentTool.schema.function;
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters as Record<string, unknown>,
    // Starting a child changes nothing; its writes raise their OWN prompts, naming the file.
    mutating: false,
    execute: async (args) => {
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      const task = str(args.task);
      const label = str(args.label) || task.slice(0, 60);
      if (!task) {
        return JSON.stringify({ ok: false, error: "task is required — the child sees none of your conversation" });
      }
      // Writable only when the owner asked AND this run can reach a human.
      const asked = args.read_only === false;
      const writable = asked && deps.children.canWrite;
      const role = delegationRole(args.role, !writable);
      // WHO does this slice. An unresolvable name is REFUSED rather than run anonymously.
      const who = await resolveChildPersona(deps, str(args.as_agent), role);
      if (!who.ok) return JSON.stringify({ ok: false, label, error: who.error });
      const started = deps.children.spawn({
        label,
        task,
        writable,
        role,
        ...(who.persona ? { persona: who.persona } : {}),
        ...(who.asAgent ? { asAgent: who.asAgent } : {}),
      });
      return JSON.stringify({
        ...started,
        ...(started.ok ? { running: true, readOnly: !writable } : {}),
        ...(who.note ? { staffing: who.note } : {}),
        ...(asked && !writable ? { writeDeclined: WRITE_DECLINED } : {}),
      });
    },
  };
}
