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

import { drainRunSteering, isRunning, queueRunSteering, type ChatInputAttachment } from "@seanhogg/builderforce-brain-embedded";
import { stopIntent } from "@builderforce/run-guards";
import { directionText, type ChildRunHost } from "./childRunSpawner";

export interface RunSteerDeps {
  registry: Pick<ChildRunHost["registry"], "lineageOf" | "interrupt">;
  childHost: Pick<ChildRunHost, "postDirection" | "stop" | "wake">;
  /** Whether the host has claimed this key (setting up, running or unwinding). */
  isBusy(runKey: number): boolean;
  /** Whether the host has claimed this key and its loop has not started yet. */
  isSettingUp(runKey: number): boolean;
  /** The top-level owner's name, as the chat shows it. */
  ownerName: string;
}

export interface RunSteer {
  steer(runKey: number, text: string, attachments?: ChatInputAttachment[]): void;
  /** The Stop button (or a typed stop): stop the run, and drop what waits for it. */
  stop(runKey: number): void;
  /** A run settled: what still waits for it is its next turn (a stopped run's is dropped). */
  settled(runKey: number): void;
  /** Stopped while it was still setting up — the host does not start its loop. */
  stopped(runKey: number): boolean;
}

export function createRunSteer(deps: RunSteerDeps): RunSteer {
  /** Runs stopped on purpose — their waiting words do not restart them. */
  const stopped = new Set<number>();

  /** Show the person's words in the chat the run lives in. */
  const say = (runKey: number, text: string): void => {
    const lineage = deps.registry.lineageOf(runKey);
    deps.childHost.postDirection(lineage?.rootChatId ?? runKey, "person", lineage?.ownerName ?? deps.ownerName, lineage?.agent ?? null, text);
  };

  const stop = (runKey: number): void => {
    // Nothing claimed: nothing to stop, and no mark left to swallow the NEXT run's words.
    if (!deps.isBusy(runKey)) return;
    stopped.add(runKey);
    deps.childHost.stop(runKey);
  };

  return {
    stop,
    stopped: (runKey) => stopped.has(runKey),

    steer(runKey, text, attachments) {
      if (!text.trim()) return;
      const lineage = deps.registry.lineageOf(runKey);
      // A sub-agent hears it as direction from its owner; the chat's own run hears the person.
      const heard = lineage ? directionText(lineage.ownerName, text) : text;
      const running = isRunning(runKey);
      if (stopIntent(text)) {
        // "STOP executing" typed mid-run IS the Stop button; the words still land in the
        // chat and the model gets no further turn. With nothing running there is nothing
        // to stop — it is not started as a turn either.
        if (!running && !deps.isBusy(runKey)) return;
        say(runKey, text);
        stop(runKey);
        return;
      }
      if (running) {
        // In front of the run's NEXT turn, not after it — and it INTERRUPTS the step now.
        // Attachments the person attached ride along so a mid-run image reaches the model.
        queueRunSteering(runKey, heard, { interrupt: true, attachments, fromPerson: true });
        // A run sitting in `wait_agents` would otherwise hear this only once every child
        // settled; the wait gives way and the next turn answers.
        deps.registry.interrupt(runKey);
        say(runKey, text);
        return;
      }
      queueRunSteering(runKey, heard, { fromPerson: true });
      if (deps.isSettingUp(runKey)) {
        // Heard before the first turn as direction — shown now, as a steer always is.
        say(runKey, text);
        return;
      }
      // Unwinding: `settled` sends it on as a turn of its own (which persists it).
      if (deps.isBusy(runKey)) return;
      // Idle: the message is the next turn — persisted by that turn, like any other.
      // A key this host cannot start (no spec, the native participant) keeps it queued
      // for its next turn instead.
      deps.childHost.wake(runKey);
    },

    settled(runKey) {
      if (stopped.delete(runKey)) {
        drainRunSteering(runKey);
        return;
      }
      // Everything still queued becomes ONE new turn, oldest first (`wake` drains it).
      deps.childHost.wake(runKey);
    },
  };
}
