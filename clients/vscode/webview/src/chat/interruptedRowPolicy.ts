/**
 * The history list's two interrupted-run questions, answered PURELY (no React, no
 * store): which interrupted chats stay dedicated interrupted rows, and which normal
 * rows carry a Resume action. `VsCodeChatHistory.tsx` is the thin React layer over
 * this; the policy lives here so it is unit-testable.
 *
 * Policy:
 * - An interrupted chat whose linked tickets are 100% complete is FINISHED: its
 *   Resume would be a no-op, so it stays a dedicated interrupted row and is excluded
 *   from the normal rows (no duplicate listing).
 * - An interrupted chat that is NOT complete is shown as a NORMAL row carrying the
 *   Resume action — but only while no resume is in flight for it and its chat is not
 *   already running (one resume per chat — `interruptedResume.ts`).
 */

/** What the list knows about one interrupted run (a row of `useInterruptedRuns`). */
export interface InterruptedRunRef {
  runId: string;
  /** The run's chat as the host sent it (`InterruptedRunView.chatId`: a numeric string when known, absent when not). */
  chatId?: string | null;
}

/** The resume state the shared `useInterruptedResume` exposes (`ResumeSnapshot` + guards). */
export interface InterruptedResumeView {
  /** Run ids with a resume in flight. */
  pending: ReadonlySet<string>;
  /** Is this chat running now? A resume into a running chat is refused. */
  isRunning(chatId: number): boolean;
}

export interface ResumeTarget {
  runId: string;
  chatId: number;
  /**
   * True when the target is a JOURNALED interrupted run (its continuation is sent through
   * the composer). False when the chat is under 100% but has no journaled interrupted run:
   * Resume just OPENS the chat so the person continues the work themselves — no turn is sent.
   */
  journaled: boolean;
}

/** A chat's completion, as the row knows it (`BrainChat.ticketProgressPct`). */
export function isCompleteProgress(progressPct: number | null | undefined): boolean {
  return !(typeof progressPct === 'number' && Number.isFinite(progressPct) && progressPct < 100);
}

/** The pending-resume chats: one resume per chat blocks another run's resume in the same chat. */
export function pendingChatIds(runs: readonly InterruptedRunRef[], pending: ReadonlySet<string>): Set<number> {
  return new Set(
    runs
      .filter((r) => r.chatId != null && pending.has(r.runId))
      .map((r) => Number(r.chatId))
      .filter((n) => Number.isInteger(n)),
  );
}

/**
 * The normal row's Resume target for a chat: the chat is NOT complete (under 100%), with
 * no resume already pending for it and its chat not running. Returns undefined when the
 * row must NOT offer Resume — a complete chat, a running chat, or a resume already in
 * flight. When the chat has a JOURNALED interrupted run the target carries it (its
 * continuation is sent through the composer, journaled: true); when it has none the
 * target is OPEN-ONLY (journaled: false) — the play button opens the chat so the person
 * continues the work, and no turn is sent (there is nothing journaled to continue).
 */
export function resumableInterruptedRun(
  chatId: number,
  progressPct: number | null | undefined,
  runs: readonly InterruptedRunRef[],
  interrupted: InterruptedResumeView,
): ResumeTarget | undefined {
  if (isCompleteProgress(progressPct)) return undefined;
  if (interrupted.isRunning(chatId)) return undefined;
  const run = runs.find((r) => r.chatId != null && Number(r.chatId) === chatId);
  if (!run) {
    // Under 100% but nothing journaled: still offer Resume, as an OPEN-ONLY action.
    return { runId: `open-${chatId}`, chatId, journaled: false };
  }
  // Same refusal the dedicated interrupted rows use: a resume already pending in this
  // chat (one resume per chat — `interruptedResume.ts`). The pending run itself still
  // resolves (its button shows the in-flight state).
  if (!interrupted.pending.has(run.runId) && pendingChatIds(runs, interrupted.pending).has(chatId)) return undefined;
  return { runId: run.runId, chatId, journaled: true };
}

/**
 * The chat ids that render as dedicated interrupted rows: interrupted chats the
 * normal-row policy above does NOT give a Resume target to (finished, running, or a
 * resume already in flight). Every other interrupted chat is a normal row carrying
 * Resume, so it is listed exactly once.
 */
export function interruptedCompleteIds(
  chatIds: readonly number[],
  runs: readonly InterruptedRunRef[],
  interrupted: InterruptedResumeView,
  progressPctOf: (chatId: number) => number | null | undefined,
): Set<number> {
  return new Set(
    chatIds.filter(
      (id) => runs.some((r) => r.chatId != null && Number(r.chatId) === id)
        && resumableInterruptedRun(id, progressPctOf(id), runs, interrupted) === undefined,
    ),
  );
}
