/**
 * The owner's side of a LIVE delegation on the machine — collect, redirect, stop.
 *
 * The verbs themselves (`wait_agents`, `message_agent`, `stop_agent`), their schemas and
 * the words an owner reads are the shared ones in `@builderforce/agent-tools`, which the
 * durable cloud runner runs too. This file only adapts them to this host's `ToolDef` and
 * hands them the editor's child registry as their `orchestrate.live` backing.
 */

import {
  SUBAGENT_CONTROL_TOOLS,
  type CapabilityProvider,
  type LiveChildControls,
} from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import type { ChildControls } from "./childRunSpawner";


/** The editor's registry, as the shared tools' `orchestrate.live` backing. */
function liveBacking(children: ChildControls): LiveChildControls {
  return {
    wait: (handles, timeoutMs, signal) => children.wait(handles, timeoutMs, signal),
    message: async (handle, text) => children.message(handle, text, "owner"),
    stop: async (handles) => children.stop(handles),
  };
}

export function subagentControlToolDefs(children: ChildControls, signal: () => AbortSignal | undefined): ToolDef[] {
  const caps = { orchestration: { spawn: async () => ({ ok: false }), live: liveBacking(children) } } as unknown as CapabilityProvider;
  return SUBAGENT_CONTROL_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.schema.function.description,
    parameters: tool.schema.function.parameters as Record<string, unknown>,
    mutating: false,
    execute: async (args: Record<string, unknown>) => {
      const s = signal();
      const out = await tool.execute(args, { caps, ...(s ? { signal: s } : {}) });
      return JSON.stringify(out.data);
    },
  }));
}
