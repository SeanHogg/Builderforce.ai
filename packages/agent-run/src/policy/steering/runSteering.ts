/**
 * runSteering — direction for a run that is ALREADY running, keyed by run.
 *
 * Ported from `brain-embedded/src/runSteering.ts` (WS2c, PRD 35 §4 row 2c): the composer
 * queue a surface posts mid-run messages to. Keyed by RUN KEY, not by chat — an owner and
 * its children share one chat and each needs its own inbox. A message marked `interrupt`
 * (the person's own words, PRD 35 E10) also aborts the run's interruptible step in flight
 * and skips the rest of its turn; a child's report waits for the step to end.
 *
 * {@link runSteeringSource} binds one run's inbox to the agent's `SteeringSource` port, so
 * a surface that keeps its queue in-process supplies the port with one call. The
 * vision-part rendering the Brain adds on top (`steerModelContent`) stays with the Brain:
 * attachments ride here untyped, as data.
 *
 * No `node:*` imports, no DOM.
 */

import type { SteerInput, SteeringSource } from "../../contract.js";

/** A queued direction for a run. */
export interface RunSteerMessage {
  text: string;
  attachments?: unknown;
  /** The person typed it — not a child's report or an owner's direction to a sub-agent. */
  fromPerson?: boolean;
  /**
   * No surface has shown or saved this message yet — the run must, when it drains it. A host
   * that shows the person's words itself as it queues them (the editor's `say`) leaves it unset.
   */
  persist?: boolean;
}

const inboxes = new Map<number, RunSteerMessage[]>();
/** Runs whose waiting direction INTERRUPTS the step in flight. Cleared on drain. */
const interrupting = new Set<number>();
const interruptListeners = new Map<number, Set<() => void>>();

/**
 * Queue one message for a run's next turn. Blank text is ignored. `interrupt` also
 * aborts the run's interruptible step now and skips the rest of its turn's calls.
 */
export function queueRunSteering(runKey: number, text: string, opts?: { interrupt?: boolean; attachments?: unknown; fromPerson?: boolean; persist?: boolean }): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const queue = inboxes.get(runKey) ?? [];
  queue.push({ text: trimmed, attachments: opts?.attachments, ...(opts?.fromPerson ? { fromPerson: true } : {}), ...(opts?.persist ? { persist: true } : {}) });
  inboxes.set(runKey, queue);
  if (!opts?.interrupt) return;
  interrupting.add(runKey);
  for (const listener of [...(interruptListeners.get(runKey) ?? [])]) listener();
}

/** Take every message queued for a run, oldest first. Empty when none are waiting. */
export function drainRunSteering(runKey: number): RunSteerMessage[] {
  interrupting.delete(runKey);
  const queue = inboxes.get(runKey);
  if (!queue?.length) return [];
  inboxes.delete(runKey);
  return queue;
}

/** True while an interrupting message waits for the run's next turn. */
export function hasRunInterrupt(runKey: number): boolean {
  return interrupting.has(runKey);
}

/** Be told when an interrupting message arrives for a run. Returns the unsubscribe. */
export function onRunInterrupt(runKey: number, listener: () => void): () => void {
  const set = interruptListeners.get(runKey) ?? new Set<() => void>();
  set.add(listener);
  interruptListeners.set(runKey, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) interruptListeners.delete(runKey);
  };
}

/** Test-only: forget every queue. */
export function resetRunSteering(): void {
  inboxes.clear();
  interrupting.clear();
  interruptListeners.clear();
}

/** One run's inbox as the agent's `SteeringSource` port. */
export function runSteeringSource(runKey: number): SteeringSource {
  return {
    drain: (): SteerInput[] => {
      const interrupt = hasRunInterrupt(runKey);
      return drainRunSteering(runKey).map((m) => ({
        text: m.text,
        ...(m.attachments !== undefined ? { attachments: m.attachments } : {}),
        ...(interrupt ? { interrupt: true } : {}),
      }));
    },
    hasInterrupt: () => hasRunInterrupt(runKey),
    onInterrupt: (listener) => onRunInterrupt(runKey, listener),
  };
}
