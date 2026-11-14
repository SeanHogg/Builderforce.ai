/**
 * The person's words typed at a run — STEERING it (PRD 35 E10, §6.3). Split from
 * `brainRunHost.ts`: one subsystem, four windows, and a message is never dropped in any:
 *
 *   - RUNNING: a stop command ("STOP executing") IS the Stop button; anything else goes in
 *     front of the run's next turn and INTERRUPTS the step in flight (a foreground
 *     command, a wait on a job). A run parked in `wait_agents` gives way.
 *   - SETTING UP (claimed by the host, the loop not started yet): it is queued, shown in
 *     the chat, and heard before the run's first model turn.
 *   - UNWINDING (the loop has ended, the host is still closing the run): it is queued and
 *     sent on as a turn of its own once the run has settled (`settled`).
 *   - IDLE (the run ended as the message was sent): the message IS the next turn.
 *   - SETTLED with messages still waiting (they arrived as the run ended): they are sent
 *     on, together and in order, as one new turn — unless the run was STOPPED, which ends
 *     the conversation's work, waiting words included.
 *
 * No `vscode` import: tested through the host (`brainRunHost.steer.test.ts`) and directly
 * (`runSteer.test.ts`).
 */
import { drainRunSteering, isRunning, queueRunSteering, requeueRunSteering, savedChatOf } from "@seanhogg/builderforce-brain-embedded";
import { stopIntent } from "@builderforce/run-guards";
import { directionText } from "./childRunSpawner";
export function createRunSteer(deps) {
    /** Runs stopped on purpose — their waiting words do not restart them. */
    const stopped = new Set();
    /** The keys of the turns already heard, per run (the newest few: a repeat arrives close behind the original). */
    const heard = new Map();
    const MAX_HEARD = 256; // a backstop: a run's keys are cleared when it settles - not when it is stopped, so a repeated batch while the stopped run unwinds stays deduped
    const firstHearing = (runKey, key) => {
        const keys = heard.get(runKey) ?? new Set();
        heard.set(runKey, keys);
        if (keys.has(key))
            return false;
        keys.add(key);
        if (keys.size > MAX_HEARD)
            keys.delete(keys.values().next().value);
        return true;
    };
    /** Show the person's words in the chat the run lives in. */
    const say = (runKey, text) => {
        const lineage = deps.registry.lineageOf(runKey);
        deps.childHost.postDirection(savedChatOf(runKey, lineage), "person", lineage?.ownerName ?? deps.ownerName, lineage?.agent ?? null, text);
    };
    const stop = (runKey) => {
        // The Stop is ALWAYS forwarded to the run's own stop (`childHost.stop` -> `stopRun`),
        // which is itself a safe no-op when nothing is running: a Stop pressed in the gap
        // between the host claiming a key and its `beginRun` must still reach the abort the
        // moment the loop starts, never be swallowed here. Only the END-OF-WORK side effects
        // (dropping what waits, marking the run stopped so `settled` drops its words) are
        // gated on there being work to end - a Stop while truly idle leaves no mark that
        // could swallow the NEXT run's words.
        const busy = deps.isBusy(runKey);
        if (busy) {
            deps.dropParked?.(runKey);
            stopped.add(runKey);
        }
        deps.childHost.stop(runKey);
    };
    /**
     * Take one message: shown/queued/interrupting as the run's state says. `idle`: no run is reading, the words are queued for
     * the chat's next turn and the caller wakes it (once, however many were taken); `stopped`: it was the Stop; `stop-idle`: a
     * typed stop with nothing to stop (a batch drops what it queued before it).
     */
    const take = (runKey, text, attachments) => {
        if (!text.trim())
            return "done";
        const lineage = deps.registry.lineageOf(runKey);
        // A sub-agent hears it as direction from its owner; the chat's own run hears the person.
        const direction = lineage ? directionText(lineage.ownerName, text) : text;
        const running = isRunning(runKey);
        if (stopIntent(text)) {
            // "STOP executing" typed mid-run IS the Stop button; the words still land in the
            // chat and the model gets no further turn. With nothing running there is nothing
            // to stop — it is not started as a turn either.
            if (!running && !deps.isBusy(runKey))
                return "stop-idle";
            say(runKey, text);
            stop(runKey);
            return "stopped";
        }
        if (running) {
            // In front of the run's NEXT turn, not after it — and it INTERRUPTS the step now.
            // Attachments the person attached ride along so a mid-run image reaches the model.
            queueRunSteering(runKey, direction, { interrupt: true, attachments, fromPerson: true });
            // A run sitting in `wait_agents` would otherwise hear this only once every child
            // settled; the wait gives way and the next turn answers.
            deps.registry.interrupt(runKey);
            say(runKey, text);
            return "done";
        }
        queueRunSteering(runKey, direction, { fromPerson: true });
        if (deps.isSettingUp(runKey)) {
            // Heard before the first turn as direction — shown now, as a steer always is.
            say(runKey, text);
            return "done";
        }
        // Unwinding: `settled` sends it on as a turn of its own (which persists it).
        if (deps.isBusy(runKey))
            return "done";
        // Idle: the message is the next turn — persisted by that turn, like any other.
        // A key this host cannot start (no spec, the native participant) keeps it queued
        // for its next turn instead.
        return "idle";
    };
    return {
        stop,
        stopped: (runKey) => stopped.has(runKey),
        steer(runKey, text, attachments) {
            if (take(runKey, text, attachments) === "idle")
                deps.childHost.wake(runKey);
        },
        steerTurns(runKey, turns) {
            let idle = false;
            let queued = 0; // the words THIS batch put in the chat's inbox (the newest ones: the inbox is read oldest first)
            for (const turn of turns) {
                if (!firstHearing(runKey, turn.eventKey))
                    continue;
                const taken = take(runKey, turn.text, turn.attachments);
                if (taken === "stopped")
                    return;
                // A stop for a chat with nothing running ends the work this batch queued: what the batch HELD is dropped and nothing
                // is woken. Unlike sequential `steer` calls (the first wakes a run, the stop stops it, and `settled` has already
                // persisted/said what that run heard), the dropped words are never persisted or said. Words queued EARLIER for this
                // chat (e.g. while the host could not start it) are not the batch's: they go back, in order, at the front.
                if (taken === "stop-idle" && idle) {
                    const inbox = drainRunSteering(runKey);
                    requeueRunSteering(runKey, inbox.slice(0, Math.max(0, inbox.length - queued)));
                    return;
                }
                if (taken !== "stop-idle" && turn.text.trim())
                    queued += 1; // "done" and "idle" each queued exactly this turn's words
                idle = idle || taken === "idle";
            }
            // Idle: everything queued is ONE new turn, oldest first (`wake` drains it).
            if (idle)
                deps.childHost.wake(runKey);
        },
        settled(runKey) {
            heard.delete(runKey);
            if (stopped.delete(runKey)) {
                drainRunSteering(runKey);
                return;
            }
            // Everything still queued becomes ONE new turn, oldest first (`wake` drains it).
            deps.childHost.wake(runKey);
        },
    };
}
//# sourceMappingURL=runSteer.js.map