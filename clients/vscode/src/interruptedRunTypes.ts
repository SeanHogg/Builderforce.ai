/**
 * The VIEW types of the run list's "Interrupted" rows (G22) — what the host sends as `run.interrupted` and the webview
 * renders and resumes from (`interruptedRunsView.ts` builds them, `interruptedResumeTurn.ts` turns one into the
 * continuation turn).
 *
 * Pure DATA, no imports: the webview type-imports this module, so nothing of the extension host (the journal, the run
 * store, the guard packages) enters the webview's type graph through it. The host side asserts its own types still fit
 * these shapes (`interruptedRunsView.ts`), so the two cannot drift apart silently.
 */

/** The journaled resume state of a run — the shape of brain-embedded's `RunResumeState`, restated here as plain data. */
export interface ResumeStateView {
  /** The person's request that started the run, verbatim. */
  ask?: string;
  /** The run's task state (`update_task_state`), rendered as the model wrote it. */
  plan?: string;
  /** Files the run changed so far (workspace-relative). */
  files?: string[];
  /** The run's last tool steps, oldest first. */
  steps?: string[];
}

/** A sub-agent's state as the journal kept it (`ChildState`). */
export type InterruptedChildState = "running" | "done" | "failed" | "stopped";

/**
 * One sub-agent the interrupted run had started, as DATA: the renderer (`renderInterruptedChildren`) words it in the
 * person's language; the handle, label, owner, ticket, brief and report stay literal.
 */
export interface InterruptedChildView {
  handle: string;
  label: string;
  /** The name of the run that started it (a nested child's owner is another child). */
  owner: string;
  ticket?: string;
  state: InterruptedChildState;
  /** Its brief — kept for a child that died with the editor, so it can be re-spawned or done by hand. */
  brief?: string;
  /** How its report reached the owner: a `wait_agents` result, or the owner's inbox. */
  deliveredBy?: "wait" | "inbox";
  /** Its report as the owner reads it (`childReportText`), when one was kept and not already returned by `wait_agents`. */
  report?: string;
}

/** The DATA of a resume: the run's journaled state, plus what became of the sub-agents it started. */
export interface InterruptedRunResume extends ResumeStateView {
  /** Every sub-agent the run had started; absent when it started none. */
  children?: InterruptedChildView[];
}

/** One interrupted run, as the webview lists it. */
export interface InterruptedRunView {
  runId: string;
  /** The chat the run belonged to (the host's local chat id), when it had one. */
  chatId?: string;
  /** When the run was marked interrupted (ISO). */
  interruptedAt: string;
  /** What Resume continues from (`interruptedResumeTurn.ts`): the journaled resume state and its sub-agents. */
  resume?: InterruptedRunResume;
}
