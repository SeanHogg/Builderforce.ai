/**
 * `spawn_agent` on the MACHINE — delegation for the editor-hosted Brain.
 *
 * Same tool, same brief and same budget as the cloud's (both take the schema from
 * `@builderforce/agent-tools` and the run from `@builderforce/agent-loop`, so a model
 * that learned to delegate in one surface delegates identically in the other), and now
 * the same answer to what a child may touch: a child can WRITE, and every write it makes
 * is approved by the same human, on the same prompt, under the same governance gates as
 * a write the parent makes.
 *
 * That was the one thing this surface could not do. The approval prompt is raised by the
 * Brain run cell that owns the chat UI, and a nested loop had no way to reach it — so a
 * writable child would have been a disk write nobody approved, and the honest thing was
 * to run children read-only and say so. The cell's confirm channel is now callable from
 * outside it (`requestRunConfirm`), so the child asks the question rather than skipping
 * it, and `createChildWriteGate` is where the answer is decided.
 *
 * Read-only is still the DEFAULT, because it is the right default: most delegation is
 * investigation, and a read-only child cannot cost anything but time. A parent gets a
 * writable child only by asking for one (`read_only: false`) — and only when the host
 * supplied a gate, because a surface with no way to prompt must still never write.
 */

import { runSubagent, SUBAGENT_MAX_STEPS } from "@builderforce/agent-loop";
import { spawnAgentTool } from "@builderforce/agent-tools";
import type { BrainStreamFn, BrainToolSpec, ChatCompletionMessage } from "@seanhogg/builderforce-brain-embedded";
import type { ChildWriteDecision } from "./childWriteGate";
import type { ToolDef } from "./fileTools";

/** What the local `spawn_agent` needs from the host: a model route and the catalog the
 *  parent is running with. Both are resolved per call — a run can outlive a model
 *  switch, and the catalog depends on whether a workspace is open. */
export interface SubagentToolDeps {
  stream(): Promise<BrainStreamFn>;
  /** The parent's full tool catalog; the child gets the local subset of it. */
  catalog(): ToolDef[];
  /**
   * Decide one write the child wants to make — governance, then the run's Auto switch,
   * then the human. ABSENT means this host cannot raise a prompt, and a child here is
   * then read-only whatever the parent asked for: the alternative is writing to someone's
   * disk with no way to ask them, which is the thing the gate exists to prevent.
   */
  confirmWrite?(req: { name: string; args: Record<string, unknown> }): Promise<ChildWriteDecision>;
}

/**
 * The child's tools: local ones only (never the server-side platform catalog — a
 * delegated task is about THIS workspace, and the parent keeps the platform reach),
 * minus `spawn_agent` itself, which is what makes recursion impossible here in the same
 * way withholding the capability does in the cloud.
 *
 * `writable` keeps the mutating half. It is false by default and false whenever the host
 * gave no way to ask a human — the tools a child is HANDED are the boundary, so a child
 * that must not write is never shown a tool that writes, rather than being shown one and
 * refused at dispatch.
 */
export function childToolDefs(catalog: readonly ToolDef[], writable = false): ToolDef[] {
  return catalog.filter(
    (t) => !t.remote && t.name !== spawnAgentTool.name && (writable || !t.mutating),
  );
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
      // Writable only when the parent asked AND this host can reach a human. Both
      // halves are required: the first is the tool's contract, the second is the reason
      // the contract was unavailable here until now.
      const writable = args.read_only === false && !!deps.confirmWrite;
      const defs = childToolDefs(deps.catalog(), writable);
      const specs = toSpecs(defs);
      const byName = new Map(defs.map((d) => [d.name, d]));
      // Say it plainly rather than silently narrowing: a parent that believes a child
      // made an edit will not make it, and the change would be lost.
      const declinedWrite =
        args.read_only === false && !writable
          ? "This host cannot raise an approval prompt, so the sub-agent ran read-only. The findings below are an investigation — make any change yourself."
          : undefined;

      try {
        const stream = await deps.stream();
        const run = await runSubagent<BrainToolSpec>({
          task,
          readOnly: !writable,
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
            // A write asks the human FIRST, on the parent run's own modal, naming the
            // file. A refusal comes back as an ordinary tool result with its reason, so
            // the child adapts (or reports what it found) instead of failing the
            // delegation — the same shape a blocked call takes in the parent's loop.
            if (def.mutating && deps.confirmWrite) {
              const decision = await deps.confirmWrite({ name: call.name, args: call.args });
              if (!decision.ok) return { data: { ok: false, error: decision.reason }, isError: true };
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
          readOnly: !writable,
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
