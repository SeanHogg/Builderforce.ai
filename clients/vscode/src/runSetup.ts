/**
 * What a host run resolves around its loop before turn 1 — split from `brainRunHost.ts`
 * (one subsystem: the run's CONTEXT, not its lifecycle):
 *
 *   - the run's default checkout (PRD 35 E3), resolved ONCE, in parallel with the setup;
 *   - the request's context fields: the platform context + memory and the workspace's
 *     run notes (the system-prompt augmentation seam), the task context pack (E2 — always
 *     the volatile turn context, its recall hint, the files it served whole) and the BYO
 *     model preflight (E7).
 *
 * Any part failing costs that part, never the run. No `vscode` import.
 */

import type { BrainRunRequest } from "@seanhogg/builderforce-brain-embedded";
import type { BrainRunHostPorts } from "./brainRunHostContract";

/** The run's default checkout: `current()` is undefined until (and unless) it resolves. */
export interface RunRepo {
  /** Settles once the port answered (or failed) — a tool call waits for it. */
  ready: Promise<void>;
  current(): string | undefined;
}

/** Start resolving the run's default checkout now; the port bounds itself. */
export function startRunRepo(ports: Pick<BrainRunHostPorts, "defaultRepo">, input: { projectId?: number; request?: string }): RunRepo {
  let resolved: string | undefined;
  const ready = ports.defaultRepo
    ? ports.defaultRepo(input).then(
        (repo) => { resolved = repo; },
        // A failed resolve means "no default checkout": the tools run at the root.
        () => { resolved = undefined; },
      )
    : Promise.resolve();
  return { ready, current: () => resolved };
}

export interface RunContextInput {
  projectId?: number;
  serverChatId: number | null;
  /** The user's request for this run. */
  request: string;
  /** The chat's Memory switch: off ⇒ no project facts in the pack. */
  memory: boolean;
  /** A sub-agent shares its owner's accounts, so it does not repeat the preflight. */
  child: boolean;
}

type RunContextFields = Pick<BrainRunRequest, "augmentSystemPrompt" | "turnContext" | "recallHint" | "servedReads" | "modelPreflight">;

/**
 * The system-prompt augmentation (the same seam the limbic block uses): the project's
 * platform context + memory, and the workspace's run notes as they are now.
 */
function augmentFor(ports: BrainRunHostPorts, projectId: number | undefined, serverChatId: number | null): Pick<RunContextFields, "augmentSystemPrompt"> {
  const platform = projectId != null && ports.runContext ? ports.runContext : undefined;
  const recent = ports.recentActivity;
  if (!platform && !recent) return {};
  return {
    augmentSystemPrompt: async (text: string) => {
      const parts = await Promise.all([
        platform ? platform(projectId!, serverChatId, text).catch(() => "") : "",
        recent ? recent().catch(() => "") : "",
      ]);
      return parts.filter((part) => part.trim()).join("\n\n") || undefined;
    },
  };
}

/** The request's per-run context fields. Starts the context pack now; the loop awaits it before turn 1. */
export function runContextFields(ports: BrainRunHostPorts, input: RunContextInput): RunContextFields {
  const { projectId, serverChatId } = input;
  // Settled once, so a pack that fails is never an unhandled rejection; the failure is
  // re-thrown to the loop ONCE (by `turnContext`), which keeps it on the run's trace.
  const pack = ports.contextPack
    ? ports.contextPack({ ...(projectId != null ? { projectId } : {}), serverChatId, request: input.request, memory: input.memory })
        .then((value) => ({ value }), (error: unknown) => ({ error }))
    : undefined;
  const value = async () => {
    const r = await pack!;
    return "value" in r ? r.value : undefined;
  };
  const preflight = ports.modelPreflight && !input.child ? ports.modelPreflight : undefined;
  return {
    ...augmentFor(ports, projectId, serverChatId),
    ...(pack
      ? {
          turnContext: async () => {
            const r = await pack;
            if ("error" in r) throw r.error;
            return r.value?.block;
          },
          recallHint: async () => (await value())?.recallHint,
          servedReads: async () => (await value())?.servedReads,
        }
      : {}),
    ...(preflight ? { modelPreflight: () => preflight() } : {}),
  };
}
