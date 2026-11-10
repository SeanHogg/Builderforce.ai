/**
 * The run delta card's lifecycle in the chat (PRD 41 §C11.1): a run whose delta starts computing gets a `pending` card AT
 * ONCE ("Measuring what this run changed…"), each computed delta replaces it, and a computation that ends without one (an
 * error, the budget) leaves a `failed` card instead — a card never sits pending forever. `run-delta/get` answers the same:
 * the stored cards, plus the progress card of a run this session is still measuring (or failed to).
 *
 * Also where a card's anchor comes from: {@link lastReplySince}, the last assistant message the run persisted.
 */

import type { RunDeltaCardPayload, RunDeltaProgressCard } from "@builderforce/run-delta";

/** Failed cards are kept for this session's `run-delta/get`, at most this many runs. */
const MAX_TRACKED = 100;

/** The id of the last assistant message persisted at or after `since` (the run's start), or undefined when it wrote none. */
export function lastReplySince(messages: readonly { id: number; role: string; createdAt: string }[], since: string): number | undefined {
  const from = Date.parse(since);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const at = Date.parse(m.createdAt);
    if (Number.isNaN(from) || Number.isNaN(at) || at >= from) return m.id;
    return undefined; // the newest reply predates the run: it wrote none
  }
  return undefined;
}

export interface RunDeltaProgress {
  /** Posts every card, progress or computed: the relay to the chat panels. */
  post(card: RunDeltaCardPayload): void;
  /**
   * A run's deltas start (`repos` change sets to measure): its `pending` card is posted now. Returns the call that marks
   * the computation over — it posts the `failed` card when no computed card was posted for the run. No-op for no repos.
   */
  begin(run: { chatId: number; runId: string; at?: number; repos: number }): () => void;
  /** `run-delta/get`: the stored cards, plus the progress card of each matching run that has none stored. */
  withProgress(query: { runId?: string; chatId?: number }, stored: readonly RunDeltaCardPayload[]): RunDeltaCardPayload[];
}

export function createRunDeltaProgress(relay: (card: RunDeltaCardPayload) => void): RunDeltaProgress {
  const runs = new Map<string, RunDeltaProgressCard>();
  /** The runs being measured now: whether each has posted a computed card yet. Only these are tracked — a computed card
   *  posted again later (a release's re-post) must not leave an entry nobody removes. */
  const measuring = new Map<string, boolean>();
  const post = (card: RunDeltaCardPayload): void => {
    if (card.status !== "pending" && card.status !== "failed") {
      if (measuring.has(card.runId)) measuring.set(card.runId, true);
      runs.delete(card.runId);
    }
    relay(card);
  };
  return {
    post,
    begin({ repos, ...run }) {
      if (repos <= 0) return () => {};
      const pending: RunDeltaProgressCard = { ...run, status: "pending" };
      runs.set(run.runId, pending);
      while (runs.size > MAX_TRACKED) runs.delete(runs.keys().next().value!);
      measuring.set(run.runId, false);
      relay(pending);
      let over = false;
      return () => {
        if (over) return;
        over = true;
        const computed = measuring.get(run.runId) === true;
        measuring.delete(run.runId);
        if (computed) return;
        const failed: RunDeltaProgressCard = { ...run, status: "failed" };
        runs.set(run.runId, failed);
        relay(failed);
      };
    },
    withProgress(query, stored) {
      if (query.runId === undefined && query.chatId === undefined) return [...stored];
      const has = new Set(stored.map((c) => c.runId));
      const progress = [...runs.values()].filter((c) =>
        !has.has(c.runId) && (query.runId === undefined || c.runId === query.runId) && (query.chatId === undefined || c.chatId === query.chatId));
      return [...stored, ...progress];
    },
  };
}
