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
 *   - `run.tool`     → a checkpoint; `safeToResume` only after a successful,
 *                      non-mutating, local tool (a step whose replay cannot repeat an
 *                      external effect). Each checkpoint carries the run's resume state
 *                      (`resumeStateOf`: ask, plan, files changed, last steps).
 *
 * Sub-agent runs (started inside the host) are not tracked here: only the keys this
 * module was told about are. No `vscode` import; journal failures go to `log`.
 */

import { resumeStateOf, STOPPED_TURN_STEP, type ResumeTraceEvent, type RunResumeState } from "@seanhogg/builderforce-brain-embedded";
import type { RunHostMessage, RunSink } from "./brainRunHostProtocol";
import type { InstalledRunRecovery } from "./installRunRecovery";
import type { RunTerminalStatus } from "./runRecovery";

/** The slice of a run snapshot the terminal-status decision reads. */
export interface RunOutcomeSnapshot {
  error: string;
  /** The cell's trace; the resume state reads THIS run's tool steps from it (`resumeStateOf`). */
  trace: ReadonlyArray<ResumeTraceEvent>;
}

export interface HostRunLifecycleDeps {
  recovery: Pick<InstalledRunRecovery, "recordStarted" | "recordCheckpoint" | "recordFinished">;
  snapshot(chatId: number): RunOutcomeSnapshot;
  log(line: string): void;
  now?: () => Date;
}

export interface HostRunLifecycle {
  /** The host is starting a run it owns for this chat; `ask` is the person's request, journaled for a resume. */
  started(chatId: number, runId: string, ask?: string): void;
  /** Attach to the host (`host.attach(lifecycle.sink)`). */
  readonly sink: RunSink;
}

/** How a settled run ended, from its cell. Stop wins over an error the abort raised. */
export function terminalStatusOf(
  message: Extract<RunHostMessage, { type: "run.settled" | "run.failed" }>,
  snapshot: RunOutcomeSnapshot,
  startedAt: string,
): RunTerminalStatus {
  if (message.type === "run.failed") return "failed";
  if (snapshot.trace.some((event) => event.label === STOPPED_TURN_STEP && event.ts >= startedAt)) return "cancelled";
  return snapshot.error ? "failed" : "completed";
}

/** The resume state to journal, or undefined when the run has nothing to continue from yet (no ask, no step). */
function journaledResume(ask: string | undefined, events: ReadonlyArray<ResumeTraceEvent>): RunResumeState | undefined {
  const state = resumeStateOf(ask, events);
  return Object.keys(state).length ? state : undefined;
}

export function createHostRunLifecycle(deps: HostRunLifecycleDeps): HostRunLifecycle {
  const live = new Map<number, { runId: string; startedAt: string; step: number; ask?: string }>();
  const now = deps.now ?? (() => new Date());
  const report = (what: string, runId: string) => (error: unknown): void => {
    deps.log(`[run journal] ${what} ${runId} failed: ${error instanceof Error ? error.message : String(error)}`);
  };

  return {
    started(chatId, runId, ask) {
      live.set(chatId, { runId, startedAt: now().toISOString(), step: 0, ...(ask ? { ask } : {}) });
      const state = journaledResume(ask, []);
      void deps.recovery.recordStarted({ runId, chatId: String(chatId), ...(state ? { state } : {}) });
    },
    sink: {
      post(message) {
        if (message.type !== "run.tool" && message.type !== "run.settled" && message.type !== "run.failed") return;
        const run = live.get(message.chatId);
        if (!run) return;
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
        const status = terminalStatusOf(message, deps.snapshot(message.chatId), run.startedAt);
        void deps.recovery.recordFinished({ runId: run.runId, status }).catch(report(status, run.runId));
      },
    },
  };
}
