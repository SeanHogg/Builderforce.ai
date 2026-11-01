/**
 * run-governance — what ONE run learns about tenant governance, shared by every attempt of that run.
 *
 * The embedded runner re-attempts a run (an auth-profile rotation, a compaction retry). Each attempt builds its own session, so anything
 * an attempt learned would be lost: which gates refused its calls, and which approval-gated calls were already refused (so the approver is
 * not asked for the same call again). The run creates one of these and hands it to every attempt.
 */
import type { RunRefusals } from "@builderforce/agent-run";

export interface RunGovernance extends RunRefusals {
  /** A governance gate refused a tool call of this run. */
  refusedBy(gateId: string): void;
}

export function createRunGovernance(): RunGovernance & { refusals(): string[] } {
  const gates = new Set<string>();
  const remembered = new Map<string, string>();
  return {
    refusedBy: (gateId) => void gates.add(gateId),
    recall: (key) => remembered.get(key),
    remember: (key, message) => void remembered.set(key, message),
    refusals: () => [...gates],
  };
}
