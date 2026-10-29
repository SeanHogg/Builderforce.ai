/**
 * vscodeAdapter — the VS Code host adapted to the ONE agent (PRD 35 §3.1 / §4 WS4).
 *
 * An adapter ONLY supplies what the editor can do: it has no loop, no policy and no branch
 * on behaviour. The Brain's ports over the run store (model, events, store, human, steering)
 * are shared with the web and Rovr (`brain-embedded` `run/webAdapter.ts`); what is the
 * editor's own is here — the capability provider over the open folder, the structured
 * context pack the host gathers before turn 1, and the run-end memory commit. The label
 * `'vscode'` goes on the outcome row for telemetry and is read by nothing that decides.
 *
 * No `vscode` import: the host hands in what it resolved.
 */

import type { BrainRunBinding, ContextPack, RunTask } from "@seanhogg/builderforce-brain-embedded";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import type { BrainRunHostPorts } from "../brainRunHostContract";

/** What the editor knows about the run it is adapting. */
export interface VsCodeRunHost {
  /** The open folder; '' when none is open (the file tools are then absent). */
  root: string;
  /** The run's key — the owner of its background shell jobs. */
  runKey: number;
  /** The run's default checkout, once resolved (PRD 35 E3). */
  defaultRepo?: string;
  /** The chat's Memory switch: off ⇒ no project facts in the pack. */
  memory: boolean;
  /** The task context pack builder (`runSetupPorts.ts`); absent ⇒ the served files only. */
  contextPack?: BrainRunHostPorts["contextPack"];
  /** The run-end write-back (the workspace note, codemap facts, learned facts). */
  commitMemory?: (consolidated: unknown) => Promise<void> | void;
  /** Where the uniform outcome row goes (the chat's usage ledger / learned routing). */
  reportOutcome?: BrainRunBinding["reportOutcome"];
  /** The tenant's governance gates for the run — approved through the confirm gate. */
  approvalGates?: BrainRunBinding["approvalGates"];
}

/** The structured pack for a task, from the host's builder. */
async function gatherPack(host: VsCodeRunHost, task: RunTask): Promise<ContextPack | undefined> {
  if (!host.contextPack) return undefined;
  const pack = await host.contextPack({
    ...(task.projectId != null ? { projectId: task.projectId } : {}),
    serverChatId: typeof task.chatId === "number" ? task.chatId : null,
    request: task.prompt,
    memory: host.memory,
  });
  return pack?.structured;
}

/**
 * The editor's part of a run's binding: merge it over the Brain's (`cell`, `req`, `request`)
 * to get the ports `runViaAgent` drives. Everything returned is a port or a fact — nothing
 * selects behaviour.
 */
export function vscodeBinding(host: VsCodeRunHost): Pick<BrainRunBinding, "entryPoint" | "capabilities" | "gatherContext" | "commitMemory" | "reportOutcome" | "approvalGates"> {
  return {
    entryPoint: "vscode",
    capabilities: buildLocalCapabilityProvider(host.root, {
      ...(host.defaultRepo ? { defaultRepo: host.defaultRepo } : {}),
      jobOwner: host.runKey,
    }),
    gatherContext: (task) => gatherPack(host, task),
    ...(host.commitMemory ? { commitMemory: host.commitMemory } : {}),
    ...(host.reportOutcome ? { reportOutcome: host.reportOutcome } : {}),
    ...(host.approvalGates ? { approvalGates: host.approvalGates } : {}),
  };
}
