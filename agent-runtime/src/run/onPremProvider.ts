/**
 * `buildOnPremProvider` — the on-prem host's `CapabilityProvider`: what THIS machine can
 * do for a run. Node fs (read / write / edit / delete / search / symbols) from
 * `node-capability-provider`, a real shell (`nodeShell`), cross-run memory (`nodeMemory`),
 * and delegation (`childRunner`'s spawn). The shared tool definitions in `agent-tools` run
 * on it unchanged; a tool whose capability this machine does not back is simply not offered.
 *
 * Machine-only tools (browser, process supervision, fleet, channel actions) are NOT here:
 * they stay the native `AgentTool`s the embedded runner drives (see the hand-off note).
 */

import type { Capability, CapabilityProvider, SubagentRequest, SubagentResult } from "@builderforce/agent-tools";
import {
  catalogNodeCapabilityProvider,
  type NodeWriteScope,
} from "../agents/node-capability-provider.js";
import { buildNodeMemory } from "./nodeMemory.js";
import { buildNodeShell } from "./nodeShell.js";

export interface OnPremProviderOptions {
  /** Absolute working-tree root; the shell starts here and list/search are confined to it. */
  workspaceRoot: string;
  /** Write confinement for per-file ops (secure default: the workspace). */
  scope?: NodeWriteScope;
  /** The run's default checkout, when the root holds several (`ShellCapability.defaultRepo`). */
  defaultRepo?: string;
  /** Delegation: absent ⇒ the run cannot spawn sub-agents (a child never can). */
  spawn?: (request: SubagentRequest) => Promise<SubagentResult>;
}

/** The disk + shell + memory provider for one on-prem run. */
export async function buildOnPremProvider(options: OnPremProviderOptions): Promise<CapabilityProvider> {
  const disk = await catalogNodeCapabilityProvider({
    workspaceRoot: options.workspaceRoot,
    ...(options.scope ? { scope: options.scope } : {}),
  });
  const memory = await buildNodeMemory();
  const added: Capability[] = ["shell", ...(memory ? (["memory"] as const) : []), ...(options.spawn ? (["orchestrate"] as const) : [])];
  return {
    ...disk,
    capabilities: new Set<Capability>([...disk.capabilities, ...added]),
    shell: buildNodeShell({
      cwd: options.workspaceRoot,
      ...(options.defaultRepo ? { defaultRepo: options.defaultRepo } : {}),
    }),
    ...(memory ? { memory } : {}),
    ...(options.spawn ? { orchestration: { spawn: options.spawn } } : {}),
  };
}
