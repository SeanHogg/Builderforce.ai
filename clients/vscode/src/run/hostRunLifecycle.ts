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

import { isMidTurnMetadata } from "@builderforce/agent-loop";
import { isUnsettledAnswer, parseSubagentOrigin, resumeStateOf, STOPPED_TURN_STEP, type ResumeTraceEvent, type RunResumeState } from "@seanhogg/builderforce-brain-embedded";
import type { RunHostMessage, RunSink } from "../brain/brainRunHostProtocol";
import type { InstalledRunRecovery } from "./installRunRecovery";
import type { RunHold, RunTerminalStatus } from "../runRecovery";
import { messageOf } from "../messageOf";

/** The slice of a run snapshot the terminal-status decision reads. */
export interface RunOutcomeSnapshot {
  error: string;
  /** The cell's trace; the resume state reads THIS run's tool steps from it (`resumeStateOf`). */
  trace: ReadonlyArray<ResumeTraceEvent>;
}

export interface HostRunLifecycleDeps {
  recovery: Pick<InstalledRunRecovery, "recordStarted" | "recordCheckpoint" | "recordFinished" | "recordHeld">;
  snapshot(chatId: number): RunOutcomeSnapshot;
  /**
   * Asked before a run's terminal status is written, with that status. A hold — only ever for a `completed` run — is
   * journaled instead of the status. Absent: every run is finished as observed.
   */
  beforeTerminal?(run: { runId: string; chatId: number; status: RunTerminalStatus }): Promise<RunHold | undefined>;
  /**
   * Told once the run's terminal write settled (landed or failed): with its `hold` when it was held. What waits on the
   * journal (a release of a just-held run, the start that reports on it) waits for this.
   */
  onTerminal?(run: { runId: string; hold?: RunHold }): void;
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

/** The slice of a run snapshot the run-end memory step reads: how it ended, and the assistant rows its cell persisted. */
export interface RunAnswerSnapshot extends RunOutcomeSnapshot {
  appended?: ReadonlyArray<{ id: number; role: string; content: string; metadata?: string | null }>;
}

/** The ids of the rows a cell had already persisted before a run began — they are not that run's answer. */
export function appendedIdsOf(snapshot: Pick<RunAnswerSnapshot, "appended">): ReadonlySet<number> {
  return new Set((snapshot.appended ?? []).map((m) => m.id));
}

/**
 * What a run that just ended leaves for project memory: whether it may LEARN (a completed run only, as the kernel path does —
 * the session note and code map are written on every outcome regardless) and its final answer. The answer is read from THIS
 * run's own rows only (`seen` = the cell's rows before it began; the cell's buffer outlives runs), never a delegated child's
 * mid-turn report, and never a reply the run was forced into (a USD-cap stop, the failure-streak closing answer: `isUnsettledAnswer`). Undefined when the
 * run wrote none.
 */
export function settledAnswerOf(
  chatId: number,
  snapshot: RunAnswerSnapshot,
  startedAt: string,
  seen: ReadonlySet<number>,
): { learn: boolean; answer?: string } {
  const status = terminalStatusOf({ type: "run.settled", chatId }, snapshot, startedAt);
  if (status !== "completed") return { learn: false };
  // THIS run's slice of the cell's trace (which spans every turn of the chat): a cap stop, or a run the failure breaker ended.
  const mine = snapshot.trace.filter((event) => event.ts >= startedAt);
  if (isUnsettledAnswer(mine)) return { learn: true };
  const row = [...(snapshot.appended ?? [])]
    .reverse()
    .find((m) => !seen.has(m.id) && m.role === "assistant" && m.content.trim() && !isMidTurnMetadata(m.metadata) && !parseSubagentOrigin(m));
  return { learn: true, ...(row ? { answer: row.content } : {}) };
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
    deps.log(`[run journal] ${what} ${runId} failed: ${messageOf(error)}`);
  };
  /** The terminal write, after the gate (if any) has decided. A gate that throws holds nothing. */
  const finish = async (runId: string, chatId: number, status: RunTerminalStatus): Promise<void> => {
    const hold = deps.beforeTerminal
      ? await deps.beforeTerminal({ runId, chatId, status }).catch((error: unknown) => (report("hold gate", runId)(error), undefined))
      : undefined;
    const held = hold && status === "completed" ? hold : undefined;
    try {
      if (held) await deps.recovery.recordHeld({ runId, hold: held }).catch(report("held", runId));
      else await deps.recovery.recordFinished({ runId, status }).catch(report(status, runId));
    } finally {
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
        void finish(run.runId, message.chatId, terminalStatusOf(message, deps.snapshot(message.chatId), run.startedAt));
      },
    },
  };
}
