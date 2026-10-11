/**
 * Direction for a run that is ALREADY running — redirecting it without stopping it.
 *
 * A run used to accept input only at its start: once it was going, the only lever was
 * Stop. That is wrong for a run that has an OWNER — a sub-agent its parent spawned, which
 * the parent (or the person) needs to correct mid-task ("only the API half", "Ada already
 * did the schema") — and it is wrong for a parent that needs to hear a child finished
 * while it is itself still working. Both are the same act: put a message in front of a
 * live run's next turn.
 *
 * Keyed by RUN KEY (the run store's cell key), not by chat: an owner and its children
 * share one chat, and each needs its own inbox. The loop drains the queue before every
 * model turn and, when the model was about to end, re-opens the run for what arrived
 * (`brainRunStore.ts`). A message queued for a run that is not running waits for its next
 * turn — the host decides whether to start one.
 */

const inboxes = new Map<number, string[]>();

/** Queue one message for a run's next turn. Blank text is ignored. */
export function queueRunSteering(runKey: number, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const queue = inboxes.get(runKey) ?? [];
  queue.push(trimmed);
  inboxes.set(runKey, queue);
}

/** Take every message queued for a run, oldest first. Empty when none are waiting. */
export function drainRunSteering(runKey: number): string[] {
  const queue = inboxes.get(runKey);
  if (!queue?.length) return [];
  inboxes.delete(runKey);
  return queue;
}

/** Test-only: forget every queue. */
export function resetRunSteering(): void {
  inboxes.clear();
}
