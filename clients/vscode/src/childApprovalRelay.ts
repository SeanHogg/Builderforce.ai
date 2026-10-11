/**
 * A sub-agent's write prompt, raised where its owner can answer it.
 *
 * A child pauses on a confirm like any run: its cell carries `pendingConfirm` and the
 * Brain panel renders the question. The native `@builderforce` view cannot render a
 * cell, so an owner there registers an APPROVER for its chat, and this relay asks it
 * whenever one of that chat's children pauses — the same modal the native turn uses
 * for its own calls. Whichever surface answers first wins; a late answer is dropped
 * rather than applied to a question asked after it.
 */

import type { NativeApprovalRequest } from "./nativeBrainRun";
import type { ChildRuns } from "./childRuns";

/** A paused call, as the store holds it. */
type Pending = { name: string; args: unknown };

/** Asks a person about one child's paused call. */
export type ChildApprover = (req: NativeApprovalRequest & { agentName: string }) => Promise<boolean>;

export interface ChildApprovalRelayDeps {
  registry: Pick<ChildRuns, "lineageOf">;
  /** What a run is paused on right now — the store's own object, compared by reference. */
  pendingOf(key: number): Pending | null;
  resolve(key: number, ok: boolean): void;
}

export function createChildApprovalRelay(deps: ChildApprovalRelayDeps) {
  /** By the chat a tree lives in. */
  const approvers = new Map<number, ChildApprover>();
  /** How each live run phrases a paused call (its own catalog and gates). */
  const describers = new Map<number, (name: string, args: unknown) => NativeApprovalRequest>();
  /** The question each run is being asked about, so a cell update does not ask twice. */
  const asking = new Map<number, Pending>();

  return {
    register(rootChatId: number, approve: ChildApprover): void {
      approvers.set(rootChatId, approve);
    },
    describeWith(key: number, describe: (name: string, args: unknown) => NativeApprovalRequest): void {
      describers.set(key, describe);
    },
    forget(key: number): void {
      describers.delete(key);
      asking.delete(key);
    },
    /** A run's cell changed — ask, if it is a child newly paused in a chat with an approver. */
    changed(key: number): void {
      const lineage = deps.registry.lineageOf(key);
      const approve = lineage ? approvers.get(lineage.rootChatId) : undefined;
      const describe = describers.get(key);
      const pending = deps.pendingOf(key);
      if (!lineage || !approve || !describe || !pending || asking.get(key) === pending) return;
      asking.set(key, pending);
      void approve({ ...describe(pending.name, pending.args), agentName: lineage.agent.name })
        .catch(() => false)
        .then((ok) => {
          if (asking.get(key) === pending) asking.delete(key);
          // Answered elsewhere already (or a newer question is up): not ours to resolve.
          if (deps.pendingOf(key) === pending) deps.resolve(key, ok);
        });
    },
  };
}

export type ChildApprovalRelay = ReturnType<typeof createChildApprovalRelay>;
