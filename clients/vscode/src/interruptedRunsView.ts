/**
 * The interrupted runs the editor's run list shows (G22).
 *
 * `installRunRecovery` journals every run the previous extension host left in flight as
 * `interrupted`. This module is the host state behind the list that surfaces them: the
 * set lives HERE (not in the webview), so a webview reload re-attaches and is sent the
 * same list again. The list is read from the journal (`recovery.interrupted()`), so a run
 * nobody dismissed is still listed after another restart.
 *
 * The host only lists and acknowledges. RESUMING is not a host start: the webview sends
 * the continuation through its ONE composer (which builds the chat's seed, model, project
 * and spec), and tells the host to acknowledge the run (`run.acknowledgeInterrupted`) once it has
 * seen the new run claim the chat. Dismiss sends the same verb at
 * once. Both are the same idempotent write (`recordRunAcknowledged`): an unknown or
 * already-acknowledged run is a no-op.
 *
 * The list rides the run host's existing relay as `run.interrupted` (`RunHostMessage`).
 * No `vscode` import; failures go to `log`.
 */

import type { RunHostMessage, RunSink } from "./brainRunHostProtocol";
import type { InstalledRunRecovery } from "./installRunRecovery";
import type { InterruptedRun } from "./runRecovery";

/** One interrupted run, as the webview lists it. */
export interface InterruptedRunView {
  runId: string;
  /** The chat the run belonged to (the host's local chat id), when it had one. */
  chatId?: string;
  /** When the run was marked interrupted (ISO). */
  interruptedAt: string;
}

/** The pure projection of a recovered run into its list row. */
export function toInterruptedRunView(run: InterruptedRun): InterruptedRunView {
  const { chatId } = run.record.payload;
  return {
    runId: run.runId,
    ...(chatId ? { chatId: String(chatId) } : {}),
    interruptedAt: run.record.updatedAt,
  };
}

export interface InterruptedRunsDeps {
  recovery: Pick<InstalledRunRecovery, "interrupted" | "recordAcknowledged">;
  log(line: string): void;
}

export interface InterruptedRuns {
  /** The current list. */
  views(): InterruptedRunView[];
  /** A panel: sent the list now and on every change. Returns the detach. */
  attach(sink: RunSink): () => void;
  /** Journal the run as acknowledged (dismissed, or resumed by the webview) and unlist it. Idempotent. */
  acknowledge(runId: string): Promise<void>;
}

export function createInterruptedRuns(deps: InterruptedRunsDeps): InterruptedRuns {
  const { recovery, log } = deps;
  let runs: InterruptedRun[] = [];
  const sinks = new Set<RunSink>();
  const views = (): InterruptedRunView[] => runs.map(toInterruptedRunView);
  const message = (): RunHostMessage => ({ type: "run.interrupted", runs: views() });
  const broadcast = (): void => {
    for (const sink of sinks) sink.post(message());
  };

  // Loaded once recovery has committed; a journal that cannot be read lists nothing.
  void recovery
    .interrupted()
    .then((found) => {
      runs = found;
      broadcast();
    })
    .catch((error: unknown) => log(`[run journal] could not list interrupted runs: ${String(error)}`));

  return {
    views,
    attach(sink) {
      sinks.add(sink);
      sink.post(message());
      return () => {
        sinks.delete(sink);
      };
    },
    async acknowledge(runId) {
      if (!runs.some((run) => run.runId === runId)) return;
      try {
        await recovery.recordAcknowledged(runId);
        runs = runs.filter((run) => run.runId !== runId);
        broadcast();
      } catch (error) {
        // Still listed: the acknowledgement was not journaled, so it would reappear.
        log(`[run journal] acknowledging ${runId} failed: ${String(error)}`);
      }
    },
  };
}
