/**
 * `spawn_agent` on the MACHINE — delegation for the editor-hosted Brain.
 *
 * Same tool, same brief and same budget as the cloud's (both take the schema from
 * `@builderforce/agent-tools` and the run from `@builderforce/agent-loop`, so a model
 * that learned to delegate in one surface delegates identically in the other). What
 * differs is what a child may touch, and that difference is deliberate:
 *
 * A child here is ALWAYS read-only. The local approval prompt — the thing standing
 * between "an agent wants to write to your disk" and it happening — is raised by the
 * Brain run cell that owns the chat UI, and a nested loop has no way to reach it. So
 * rather than run a writable child past an approval gate it cannot raise, the child
 * gets the read-only half of the workspace tools and the parent (which CAN prompt)
 * keeps every write. A parent that asks for a writable child is told so in the result,
 * so it makes the change itself instead of assuming the child did.
 */

import { runSubagent, SUBAGENT_MAX_STEPS } from "@builderforce/agent-loop";
import { spawnAgentTool } from "@builderforce/agent-tools";
import type { BrainStreamFn, BrainToolSpec, ChatCompletionMessage } from "@seanhogg/builderforce-brain-embedded";
import type { ToolDef } from "./fileTools";

/** What the local `spawn_agent` needs from the host: a model route and the catalog the
 *  parent is running with. Both are resolved per call — a run can outlive a model
 *  switch, and the catalog depends on whether a workspace is open. */
export interface SubagentToolDeps {
  stream(): Promise<BrainStreamFn>;
  /** The parent's full tool catalog; the child gets the read-only, local subset. */
  catalog(): ToolDef[];
}

/**
 * The child's tools: local (never the server-side platform catalog — a delegated
 * investigation is about THIS workspace, and the parent keeps the platform reach) and
 * non-mutating, minus `spawn_agent` itself, which is what makes recursion impossible
 * here in the same way withholding the capability does in the cloud.
 */
export function childToolDefs(catalog: readonly ToolDef[]): ToolDef[] {
  return catalog.filter((t) => !t.remote && !t.mutating && t.name !== spawnAgentTool.name);
}

/** A local tool's serialized result, back as data. Not every executor returns JSON
 *  (a shell tool returns raw output), so an unparseable payload passes through as the
 *  string it is rather than becoming an error. */
function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** OpenAI tool specs for the child's turn. */
function toSpecs(defs: readonly ToolDef[]): BrainToolSpec[] {
  return defs.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

export function subagentToolDef(deps: SubagentToolDeps): ToolDef {
  const schema = spawnAgentTool.schema.function;
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters as Record<string, unknown>,
    // The tool itself changes nothing — its child is read-only — so it never raises the
    // approval prompt. The reads the child makes are the same reads the parent could
    // have made without one.
    mutating: false,
    execute: async (args, root) => {
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      const task = str(args.task);
      const label = str(args.label) || task.slice(0, 60);
      if (!task) {
        return JSON.stringify({ ok: false, error: "task is required — the child sees none of your conversation" });
      }
      const defs = childToolDefs(deps.catalog());
      const specs = toSpecs(defs);
      const byName = new Map(defs.map((d) => [d.name, d]));
      // Say it plainly rather than silently narrowing: a parent that believes a child
      // made an edit will not make it, and the change would be lost.
      const declinedWrite =
        args.read_only === false
          ? "This surface only runs read-only sub-agents, because a child cannot raise the local approval prompt. The findings below are an investigation — make any change yourself."
          : undefined;

      try {
        const stream = await deps.stream();
        const run = await runSubagent<BrainToolSpec>({
          task,
          readOnly: true,
          tools: specs,
          complete: async ({ messages, tools }) => {
            const result = await stream({
              messages: messages as unknown as ChatCompletionMessage[],
              ...(tools.length ? { tools, tool_choice: "auto" as const } : {}),
            });
            return {
              content: result.text,
              toolCalls: result.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.args })),
            };
          },
          dispatch: async (call) => {
            const def = byName.get(call.name);
            if (!def) {
              return {
                data: { ok: false, error: `unknown tool '${call.name}' — available here: ${[...byName.keys()].join(", ")}` },
                isError: true,
              };
            }
            try {
              // Local executors hand back an already-serialized payload; the loop's
              // codec serializes what it is given, so parse first or the child reads
              // its own tool results as an escaped string instead of an object.
              return { data: parsePayload(await def.execute(call.args, root)) };
            } catch (e) {
              return { data: { ok: false, error: e instanceof Error ? e.message : String(e) }, isError: true };
            }
          },
        });
        return JSON.stringify({
          ok: run.ok,
          label,
          output: run.output,
          steps: run.steps,
          maxSteps: SUBAGENT_MAX_STEPS,
          readOnly: true,
          ...(run.truncated ? { truncated: true, note: "The sub-agent ran out of turns — treat this as partial." } : {}),
          ...(declinedWrite ? { writeDeclined: declinedWrite } : {}),
          ...(run.ok ? {} : { error: run.cancelled ? "the run was stopped while this sub-agent was working" : "the sub-agent stopped without an answer" }),
        });
      } catch (e) {
        // A failed delegation is information for the parent, not a dead run: it can
        // do the work itself on the next turn.
        return JSON.stringify({ ok: false, label, error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
