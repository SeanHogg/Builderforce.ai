/**
 * The run host's lifecycle journal (G22): start, step checkpoints, and the TERMINAL
 * status of every run the editor host starts, recorded through `installRunRecovery`.
 *
 * Before this, only the start was journaled, so every past run — finished or not —
 * was rewritten to `interrupted` on the next activation (and that event mirrored to
 * the platform). The terminal status comes from the host's own run-status events,
 * observed as a run sink (`BrainRunHost.attach`), never from a settled start promise:
 *
 *   - `run.failed`   → `failed` (the run never got going)
 *   - `run.settled`  → `failed` when the run cell carries an error, `cancelled` when
 *                      the person pressed Stop during this run, otherwise `completed`
 *   - before the terminal status is written, `beforeTerminal` (the finalize gate,
 *     `runDelta/runHoldGate.ts`) may HOLD a completed run: it is journaled
 *     `awaiting_input` with the hold (PRD 41 §12.5), never `completed`
 *   - `run.tool`     → a checkpoint; `safeToResume` only after a successful,
 *                      non-mutating, local tool (a step whose replay cannot repeat an
 *                      external effect). Each checkpoint carries the run's resume state
 *                      (`resumeStateOf`: ask, plan, files changed, last steps).
 *
 * Sub-agent runs (started inside the host) are not tracked here: only the keys this
 * module was told about are. No `vscode` import; journal failures go to `log`.
 */
import { resumeStateOf, STOPPED_TURN_STEP } from "@seanhogg/builderforce-brain-embedded";
/** How a settled run ended, from its cell. Stop wins over an error the abort raised. */
export function terminalStatusOf(message, snapshot, startedAt) {
    if (message.type === "run.failed")
        return "failed";
    if (snapshot.trace.some((event) => event.label === STOPPED_TURN_STEP && event.ts >= startedAt))
        return "cancelled";
    return snapshot.error ? "failed" : "completed";
}
/** The resume state to journal, or undefined when the run has nothing to continue from yet (no ask, no step). */
function journaledResume(ask, events) {
    const state = resumeStateOf(ask, events);
    return Object.keys(state).length ? state : undefined;
}
export function createHostRunLifecycle(deps) {
    const live = new Map();
    const now = deps.now ?? (() => new Date());
    const report = (what, runId) => (error) => {
        deps.log(`[run journal] ${what} ${runId} failed: ${error instanceof Error ? error.message : String(error)}`);
    };
    /** The terminal write, after the gate (if any) has decided. A gate that throws holds nothing. */
    const finish = async (runId, chatId, status) => {
        const hold = deps.beforeTerminal
            ? await deps.beforeTerminal({ runId, chatId, status }).catch((error) => (report("hold gate", runId)(error), undefined))
            : undefined;
        const held = hold && status === "completed" ? hold : undefined;
        try {
            if (held)
                await deps.recovery.recordHeld({ runId, hold: held }).catch(report("held", runId));
            else
                await deps.recovery.recordFinished({ runId, status }).catch(report(status, runId));
        }
        finally {
            deps.onTerminal?.({ runId, ...(held ? { hold: held } : {}) });
        }
    };
    return {
        started(chatId, runId, ask) {
            live.set(chatId, { runId, startedAt: now().toISOString(), step: 0, ...(ask ? { ask } : {}) });
            const state = journaledResume(ask, []);
            void deps.recovery.recordStarted({ runId, chatId: String(chatId), ...(state ? { state } : {}) });
        },
        sink: {
            post(message) {
                if (message.type !== "run.tool" && message.type !== "run.settled" && message.type !== "run.failed")
                    return;
                const run = live.get(message.chatId);
                if (!run)
                    return;
                if (message.type === "run.tool") {
                    run.step += 1;
                    const safeToResume = message.ok && !message.mutating && !message.remote;
                    // What a Resume continues from: the ask, the plan, the files changed and the last steps of THIS run (G22, chat #61651).
                    const state = journaledResume(run.ask, deps.snapshot(message.chatId).trace.filter((event) => event.ts >= run.startedAt));
                    void deps.recovery
                        .recordCheckpoint({ runId: run.runId, step: run.step, safeToResume, ...(state ? { state } : {}) })
                        .catch(report("checkpoint", run.runId));
                    return;
                }
                live.delete(message.chatId);
                void finish(run.runId, message.chatId, terminalStatusOf(message, deps.snapshot(message.chatId), run.startedAt));
            },
        },
    };
}
//# sourceMappingURL=hostRunLifecycle.js.map