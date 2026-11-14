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
 * Its VIEW types live in the pure `interruptedRunTypes.ts`, which the webview imports
 * instead of this module (so the host's graph never enters the webview's).
 * No `vscode` import; failures go to `log`.
 */
import { parseResumeState } from "@seanhogg/builderforce-brain-embedded";
import { interruptedChildrenOf } from "./childRunJournal";
const resumeStateFits = true;
void resumeStateFits;
/** The resume data of an interrupted run's record, or undefined when it journaled nothing to continue from. */
export function resumeOfRecord(record) {
    const state = parseResumeState(record.payload.checkpoint?.state);
    const children = interruptedChildrenOf(record);
    if (!state && !children.length)
        return undefined;
    return { ...state, ...(children.length ? { children } : {}) };
}
/** The pure projection of a recovered run into its list row. */
export function toInterruptedRunView(run) {
    const { chatId } = run.record.payload;
    const resume = resumeOfRecord(run.record);
    return {
        runId: run.runId,
        ...(chatId ? { chatId: String(chatId) } : {}),
        interruptedAt: run.record.updatedAt,
        ...(resume ? { resume } : {}),
    };
}
export function createInterruptedRuns(deps) {
    const { recovery, log } = deps;
    let runs = [];
    const sinks = new Set();
    const views = () => runs.map(toInterruptedRunView);
    const message = () => ({ type: "run.interrupted", runs: views() });
    const broadcast = () => {
        for (const sink of sinks)
            sink.post(message());
    };
    // Loaded once recovery has committed; a journal that cannot be read lists nothing.
    void recovery
        .interrupted()
        .then((found) => {
        runs = found;
        broadcast();
    })
        .catch((error) => log(`[run journal] could not list interrupted runs: ${String(error)}`));
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
            if (!runs.some((run) => run.runId === runId))
                return;
            try {
                await recovery.recordAcknowledged(runId);
                runs = runs.filter((run) => run.runId !== runId);
                broadcast();
            }
            catch (error) {
                // Still listed: the acknowledgement was not journaled, so it would reappear.
                log(`[run journal] acknowledging ${runId} failed: ${String(error)}`);
            }
        },
    };
}
//# sourceMappingURL=interruptedRunsView.js.map