/**
 * `spawn_agent` on the MACHINE — delegation for the editor-hosted Brain.
 *
 * Same tool, same brief and same budget as the cloud's (both take the schema from
 * `@builderforce/agent-tools` and the run from `@builderforce/agent-loop`, so a model
 * that learned to delegate in one surface delegates identically in the other), and the
 * same answer to what a child may touch: a child can WRITE, and every write it makes is
 * approved by the same human, on the same prompt, under the same governance gates as a
 * write the parent makes.
 *
 * Read-only is the DEFAULT, because it is the right default: most delegation is
 * investigation, and a read-only child cannot cost anything but time. A parent gets a
 * writable child only by asking for one (`read_only: false`) — and only when the run
 * supplied a write gate, because a surface with no way to prompt must still never write.
 *
 * The child itself is `runLocalChild` (`subagentRun.ts`), the ONE child run this tool and
 * `spawn_agents` share: its Stop, its model route and role, the files it changed and its
 * report into the chat all come from the run binding there, not from a second copy here.
 */

import { spawnAgentTool, delegationRole } from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import { childToolDefs, resolveChildPersona, runLocalChild, type SubagentToolDeps } from "./subagentRun";

export { childToolDefs };
export type { SubagentToolDeps };

/** Message returned when a writable subagent was requested but this host cannot prompt. */
export const WRITE_DECLINED =
  "This host cannot raise an approval prompt, so the sub-agent ran read-only. The findings below are an investigation — make any change yourself.";

export function subagentToolDef(deps: SubagentToolDeps): ToolDef {
  const schema = spawnAgentTool.schema.function;
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters as Record<string, unknown>,
    // The tool itself changes nothing, and a child's writes raise their OWN prompt at
    // the moment they happen — naming the file being written, which "run spawn_agent?"
    // never could. Marking it mutating would ask twice and ask worse.
    mutating: false,
    execute: async (args, root) => {
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      const task = str(args.task);
      const label = str(args.label) || task.slice(0, 60);
      if (!task) {
        return JSON.stringify({ ok: false, error: "task is required — the child sees none of your conversation" });
      }
      // WHO is doing this slice. An unresolvable name is REFUSED rather than run
      // anonymously: a parent that believes Ada did the work will report that she did,
      // and a silently persona-less run makes that report false.
      const who = await resolveChildPersona(deps, str(args.as_agent));
      if (!who.ok) return JSON.stringify({ ok: false, label, error: who.error });
      // Writable only when the parent asked AND this run can reach a human. Both halves
      // are required: the first is the tool's contract, the second is the reason a
      // surface without a prompt never writes.
      const asked = args.read_only === false;
      const writable = asked && !!deps.run?.confirmWrite;
      const report = await runLocalChild(deps, {
        // The timeline row says who, not just what — "as Ada: port the auth middleware".
        label: who.asAgent ? `as ${who.asAgent.name}: ${label}` : label,
        task,
        writable,
        role: delegationRole(args.role, !writable),
        tools: childToolDefs(deps.catalog(), writable),
        ...(who.persona ? { persona: who.persona } : {}),
        ...(who.asAgent ? { asAgent: who.asAgent } : {}),
      }, root);
      // Say it plainly rather than silently narrowing: a parent that believes a child
      // made an edit will not make it, and the change would be lost.
      return JSON.stringify({ ...report, ...(asked && !writable ? { writeDeclined: WRITE_DECLINED } : {}) });
    },
  };
}
