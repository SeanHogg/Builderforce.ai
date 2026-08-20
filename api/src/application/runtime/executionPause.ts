import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Parking a cloud run on `ask_human` — the ONE place a run becomes `paused`.
 *
 * Every cloud surface reaches the same three effects through this module, so a
 * pause means the same thing everywhere:
 *
 *   1. a `question` approval is opened (the human-requests queue + notifications),
 *   2. the ticket is routed to the board's needs-attention lane so a person
 *      actually SEES that the work has stopped on a question, and
 *   3. everything resume needs is written down: which surface parked the run, the
 *      lane it came from, and — for the surfaces that cannot survive their own
 *      process — the conversation to restart from.
 *
 * (3) is what makes the container / GitHub-Actions pause possible at all. Those
 * two surfaces drive the whole loop inside one process; when it exits, its
 * `messages` are gone. The durable surface keeps its loop in the DO cursor and so
 * writes no `loopState` here — but it still records the surface and the origin
 * lane, because those are properties of the PAUSE, not of the executor.
 *
 * The mirror image lives in `executionResume.ts`.
 */
import { and, eq } from 'drizzle-orm';
import { approvals, executionPauseState, swimlanes, tasks } from '../../infrastructure/database/schema';
import { notifyApprovalRequested } from '../approval/approvalNotifier';
import { notifyExecutionSubscribers } from './executionEvents';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { onTaskLandedInLane } from '../swimlane/laneEntryTrigger';
import { TaskService } from '../task/TaskService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskStatus } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * How long an unanswered agent question waits before the /escalate sweep expires it
 * and alerts. Shorter than the 72h paused-run reap deadline on purpose: escalation
 * should get a human's attention well BEFORE the backstop kills the run.
 */
export const CLOUD_QUESTION_ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The cloud surfaces a pause can happen on. `durable` resumes from its DO cursor;
 *  the other two are exit-and-redispatch and resume from {@link PausedLoopState}. */
export type PausedSurface = 'durable' | 'container' | 'github_actions';

/**
 * The in-process loop state an exit-and-redispatch surface hands back so its
 * successor picks up mid-conversation instead of restarting the task.
 *
 * Deliberately the SAME three fields both image loops already keep (`messages`,
 * `writtenPaths`, the step index) — no surface-specific shape, so one resume path
 * serves both.
 */
export interface PausedLoopState {
  messages: Array<Record<string, unknown>>;
  writtenPaths: string[];
  /** Steps already spent, so the resumed run gets the REMAINING budget and a
   *  question asked on step 38 of 40 cannot buy a fresh 40. */
  step: number;
}

/** A parked run, as resume reads it back. */
export interface PausedRunState {
  executionId: number;
  tenantId: number;
  taskId: number;
  surface: PausedSurface;
  approvalId: string | null;
  originLane: string | null;
  routedLane: string | null;
  loopState: PausedLoopState | null;
}

function parseSurface(value: string | null | undefined): PausedSurface {
  return value === 'container' || value === 'github_actions' ? value : 'durable';
}

function parseLoopState(raw: string | null | undefined): PausedLoopState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PausedLoopState>;
    if (!Array.isArray(parsed.messages)) return null;
    return {
      messages: parsed.messages as Array<Record<string, unknown>>,
      writtenPaths: Array.isArray(parsed.writtenPaths) ? parsed.writtenPaths.filter((p): p is string => typeof p === 'string') : [],
      step: typeof parsed.step === 'number' && Number.isFinite(parsed.step) ? parsed.step : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Coerce whatever the image sent into a {@link PausedLoopState}. The container is a
 * separate deployable, so its payload is UNTRUSTED shape-wise (an older image may
 * send nothing at all) — an unusable payload degrades to "no resume state", which
 * makes the resumed run restart the task rather than crash.
 */
export function coercePausedLoopState(args: Record<string, unknown>): PausedLoopState | null {
  const messages = Array.isArray(args.messages) ? (args.messages as Array<Record<string, unknown>>) : null;
  if (!messages || messages.length === 0) return null;
  return {
    messages,
    writtenPaths: Array.isArray(args.writtenPaths) ? (args.writtenPaths as unknown[]).filter((p): p is string => typeof p === 'string') : [],
    step: typeof args.step === 'number' && Number.isFinite(args.step) ? args.step : 0,
  };
}

/** What the model is told the `ask_human` call returned. Lives here rather than in
 *  either image so both surfaces resume with the identical transcript. */
export const PAUSED_TOOL_RESULT_NOTE =
  'Question sent to a human. Stop now WITHOUT reporting success or failure — this run is parked and will be restarted with the answer.';

/**
 * Close the tool-call pairing before the conversation is frozen.
 *
 * An assistant turn that carries `tool_calls` MUST be followed by one `tool`
 * message per call — every vendor rejects a request where one dangles. On the
 * pause path that invariant is easy to break twice over: the `ask_human` call's own
 * result is not in `messages` yet (the image posts this op from inside the tool
 * handler, before pushing the result), and if the model emitted `ask_human`
 * alongside other calls, the ones after it never run at all because the loop stops.
 *
 * Both leave a dangling call, and the failure would surface much later and
 * somewhere else — as a 400 on the FIRST llm step of the resumed run, i.e. exactly
 * when a human has finally answered. So the transcript is completed here, at the
 * moment it is written down: the asking call gets its real paused result, anything
 * still open gets an honest "not executed", and a call that already has a result is
 * left alone.
 *
 * Pure, so the rule is testable without a container.
 */
export function withPausedToolResults(
  messages: Array<Record<string, unknown>>,
  args: { askToolCallId?: string; toolCallIds?: string[] },
): Array<Record<string, unknown>> {
  const askId = args.askToolCallId?.trim() ?? '';
  const ids = (args.toolCallIds ?? []).filter((id) => typeof id === 'string' && id.trim());
  const all = askId && !ids.includes(askId) ? [askId, ...ids] : ids;
  if (all.length === 0) return messages;
  const answered = new Set(
    messages
      .filter((m) => m.role === 'tool' && typeof m.tool_call_id === 'string')
      .map((m) => m.tool_call_id as string),
  );
  const additions = all
    .filter((id) => !answered.has(id))
    .map((id) => ({
      role: 'tool',
      tool_call_id: id,
      content: JSON.stringify(id === askId
        ? { ok: true, paused: true, note: PAUSED_TOOL_RESULT_NOTE }
        : { ok: false, error: 'Not executed — the run paused on a human question before reaching this call. Decide whether it is still needed once you have the answer.' }),
    }));
  return additions.length > 0 ? [...messages, ...additions] : messages;
}

/**
 * The lane a paused ticket should be parked in, for a human to notice.
 *
 * The board carries a `needs_attention_lane` pointer, which until now nothing
 * consumed. It is a POINTER, not a guarantee: the default seed ships no
 * `needs-attention` swimlane, and a board can be re-templated at any time. So the
 * pointer is honoured ONLY when a swimlane with that key actually exists — a lane
 * key with no lane behind it is an unroutable ticket status, which is strictly
 * worse than the fallback.
 *
 * Falls back to `blocked`, which every seeded board has and which already reads as
 * "a human has to do something". Null when there is no board at all — nothing to
 * route into, so the pause leaves the ticket where it is.
 */
export async function resolveNeedsAttentionLane(
  db: Db,
  args: { tenantId: number; projectId: number },
): Promise<string | null> {
  const board = await findCanonicalBoard(db, args.projectId, args.tenantId);
  if (!board) return null;
  const configured = board.needsAttentionLane?.trim();
  if (configured) {
    const [lane] = await db
      .select({ key: swimlanes.key })
      .from(swimlanes)
      .where(and(eq(swimlanes.tenantId, args.tenantId), eq(swimlanes.boardId, board.id), eq(swimlanes.key, configured)))
      .limit(1);
    if (lane) return lane.key;
  }
  return TaskStatus.BLOCKED;
}

/**
 * A blocked cloud agent's `ask_human` call: record a `question` approval scoped to
 * this execution (so the answer routes back to this exact run) into the SAME
 * approvals queue self-hosted agents use, fan out the team notification (Slack +
 * email), and surface the question on the live execution stream. Returns the new
 * approval id so the loop can carry it in the pause result. Best-effort on notify;
 * the row insert is the durable part.
 */
async function createCloudQuestion(
  env: Env,
  db: Db,
  args: {
    tenantId: number; cloudAgentRef?: string; executionId: number;
    agentLabel: string; question: string; context?: string;
  },
): Promise<string> {
  const approvalId = crypto.randomUUID();
  const now = new Date();
  // An agent's question MUST carry an expiry. `expiresAt` is caller-supplied and has
  // no default, and this path used to set none — so the /escalate sweep (which only
  // sees `expiresAt < now`) could never escalate an unanswered agent question. It sat
  // pending forever, and because `paused` counts as a LIVE run in evaluateTaskAutoRun
  // + laneRequirementGate, one ignored question silently froze all future autonomy on
  // that ticket. Escalation is the FIRST line here (it pings the manager); the 72h
  // paused-run reaper in staleExecutionReaper is the backstop that eventually frees
  // the ticket if nobody ever answers. Deliberately generous: a question asked on a
  // Friday afternoon must still be answerable on Monday morning.
  const expiresAt = new Date(now.getTime() + CLOUD_QUESTION_ESCALATE_AFTER_MS);
  const description = args.context?.trim()
    ? `${args.question.trim()}\n\nContext: ${args.context.trim()}`
    : args.question.trim();
  await db.insert(approvals).values({
    id:           approvalId,
    tenantId:     args.tenantId,
    // segment_id is set by the DB trigger (0056); omitted like the on-prem POST path.
    executionId:  args.executionId,
    cloudAgentRef: args.cloudAgentRef ?? null,
    requestedBy:  args.agentLabel,
    kind:         'question',
    actionType:   'clarify.blocked',
    description,
    status:       'pending',
    expiresAt,
    createdAt:    now,
    updatedAt:    now,
  });

  await notifyApprovalRequested(env, db, {
    tenantId: args.tenantId, approvalId, kind: 'question',
    actionType: 'clarify.blocked', description,
  });

  // Mirror onto the live execution stream so an open panel shows the ask immediately.
  notifyExecutionSubscribers(args.executionId, {
    type: 'message', executionId: args.executionId, role: 'assistant',
    text: `⏸ Paused — waiting on a human answer:\n${args.question.trim()}`,
    ts: now.toISOString(),
  });

  return approvalId;
}

/** Move a ticket into `laneKey` through the canonical funnel (status write, then
 *  the lane-entry trigger), returning the lane it came from. Null when nothing
 *  moved. A paused run counts as LIVE to `evaluateTaskAutoRun`, so firing the
 *  trigger here cannot start a second agent on the ticket — it only makes the
 *  arrival visible to the same machinery a board drag goes through. */
async function moveTicketToLane(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; taskId: number; laneKey: string; submittedBy: string },
): Promise<string | null> {
  const [row] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, args.taskId), eq(tasks.tenantId, args.tenantId)))
    .limit(1);
  const originLane = row?.status ?? null;
  if (!originLane || originLane === args.laneKey) return null;

  const taskService = new TaskService(new TaskRepository(db), new ProjectRepository(db));
  await taskService.updateTask(args.taskId, { status: args.laneKey });
  await onTaskLandedInLane(env, db, {
    tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId,
    status: args.laneKey, submittedBy: args.submittedBy, originLaneKey: originLane,
  });
  return originLane;
}

/**
 * Park a cloud run on a human question. Returns the approval id the caller reports
 * back to the model (and threads through the paused/resumed chat milestones).
 *
 * Callers do NOT flip the execution row — each surface owns that transition (the DO
 * writes `paused` on its own tick; the container/Actions op writes it before the
 * image exits) — but every caller comes through here for the approval, the lane
 * routing and the resume record, so the three can never drift apart.
 */
export async function pauseExecutionForQuestion(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    executionId: number;
    taskId: number;
    projectId: number;
    cloudAgentRef?: string;
    agentLabel: string;
    question: string;
    context?: string;
    surface: PausedSurface;
    /** Exit-and-redispatch surfaces only — the conversation to resume from. */
    loopState?: PausedLoopState | null;
  },
): Promise<{ approvalId: string }> {
  const approvalId = await createCloudQuestion(env, db, {
    tenantId: args.tenantId, executionId: args.executionId,
    ...(args.cloudAgentRef ? { cloudAgentRef: args.cloudAgentRef } : {}),
    agentLabel: args.agentLabel, question: args.question,
    ...(args.context ? { context: args.context } : {}),
  });

  // Route the ticket where a human looks. Best-effort: a board/lane problem must
  // never lose the question that was just recorded.
  let originLane: string | null = null;
  let routedLane: string | null = null;
  try {
    const laneKey = await resolveNeedsAttentionLane(db, { tenantId: args.tenantId, projectId: args.projectId });
    if (laneKey) {
      originLane = await moveTicketToLane(env, db, {
        tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId,
        laneKey, submittedBy: 'system:ask-human',
      });
      if (originLane) routedLane = laneKey;
    }
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/executionPause.ts", operation: "pauseExecutionForQuestion", context: { logMessage: '[execution-pause] needs-attention routing failed; run is still paused', details: {
      tenantId: args.tenantId, executionId: args.executionId, taskId: args.taskId, error,
    } } });
  }

  await savePauseState(db, {
    tenantId: args.tenantId,
    executionId: args.executionId,
    taskId: args.taskId,
    surface: args.surface,
    approvalId,
    originLane,
    routedLane,
    loopState: args.loopState ?? null,
  });

  return { approvalId };
}

/**
 * What a resume records as the answer when the person resuming did not give one.
 *
 * Resuming without an answer is a real choice ("carry on — you already have what
 * you need"), not an empty string: the agent asked a question and something has to
 * come back, or the resumed loop drains a blank user turn and asks again.
 */
export const DEFAULT_RESUME_ANSWER =
  'Continue with your best judgement — no further clarification is being provided. State the assumption you made in your summary.';

/**
 * Close every still-pending question this run is blocked on, as `answered` with the
 * given text.
 *
 * Resuming from the execution panel and answering in the approvals queue are two
 * doors onto the SAME state, so whichever one is used the other must not keep
 * asking. Without this, resuming from the chip left the question pending forever:
 * it would eventually be escalated and then expired against a run that had long
 * since carried on.
 */
export async function answerOpenExecutionQuestions(
  db: Db,
  args: { tenantId: number; executionId: number; answer: string; userId?: string | null },
): Promise<void> {
  await db.update(approvals)
    .set({
      status: 'answered',
      responseText: args.answer,
      reviewedBy: args.userId ?? null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(approvals.tenantId, args.tenantId),
      eq(approvals.executionId, args.executionId),
      eq(approvals.kind, 'question'),
      eq(approvals.status, 'pending'),
    ))
    .catch((error) => reportCaughtError(error, { source: "application/runtime/executionPause.ts", operation: "answerOpenExecutionQuestions", context: { logMessage: '[execution-pause] closing the open question failed; the run still resumes', details: {
      tenantId: args.tenantId, executionId: args.executionId, error,
    } } }));
}

/** Upsert the resume record. One row per execution — a re-pause overwrites. */
export async function savePauseState(
  db: Db,
  state: {
    tenantId: number; executionId: number; taskId: number; surface: PausedSurface;
    approvalId: string | null; originLane: string | null; routedLane: string | null;
    loopState: PausedLoopState | null;
  },
): Promise<void> {
  const values = {
    tenantId: state.tenantId,
    executionId: state.executionId,
    taskId: state.taskId,
    surface: state.surface,
    approvalId: state.approvalId,
    originLane: state.originLane,
    routedLane: state.routedLane,
    loopState: state.loopState ? JSON.stringify(state.loopState) : null,
    updatedAt: new Date(),
  };
  await db.insert(executionPauseState).values(values)
    .onConflictDoUpdate({ target: executionPauseState.executionId, set: values })
    .catch((error) => reportCaughtError(error, { source: "application/runtime/executionPause.ts", operation: "savePauseState", context: { logMessage: '[execution-pause] resume state persistence failed', details: {
      tenantId: state.tenantId, executionId: state.executionId, surface: state.surface, error,
    } } }));
}

/** Read a parked run's resume record. Null when the run was never paused through
 *  this module (legacy rows) — callers then fall back to the durable wake. */
export async function loadPauseState(
  db: Db,
  args: { tenantId: number; executionId: number },
): Promise<PausedRunState | null> {
  const [row] = await db
    .select({
      executionId: executionPauseState.executionId,
      tenantId: executionPauseState.tenantId,
      taskId: executionPauseState.taskId,
      surface: executionPauseState.surface,
      approvalId: executionPauseState.approvalId,
      originLane: executionPauseState.originLane,
      routedLane: executionPauseState.routedLane,
      loopState: executionPauseState.loopState,
    })
    .from(executionPauseState)
    .where(and(eq(executionPauseState.tenantId, args.tenantId), eq(executionPauseState.executionId, args.executionId)))
    .limit(1);
  if (!row) return null;
  return {
    executionId: row.executionId,
    tenantId: row.tenantId,
    taskId: row.taskId,
    surface: parseSurface(row.surface),
    approvalId: row.approvalId ?? null,
    originLane: row.originLane ?? null,
    routedLane: row.routedLane ?? null,
    loopState: parseLoopState(row.loopState),
  };
}

/** Drop the resume record once the run has been woken. */
export async function clearPauseState(
  db: Db,
  args: { tenantId: number; executionId: number },
): Promise<void> {
  await db.delete(executionPauseState)
    .where(and(eq(executionPauseState.tenantId, args.tenantId), eq(executionPauseState.executionId, args.executionId)))
    .catch((error) => reportCaughtError(error, { source: "application/runtime/executionPause.ts", operation: "clearPauseState", context: { logMessage: '[execution-pause] resume state cleanup failed', details: {
      tenantId: args.tenantId, executionId: args.executionId, error,
    } } }));
}

/**
 * Put the ticket back where it was before the pause moved it.
 *
 * Only when the ticket is STILL in the lane the pause routed it to: if a person
 * has since dragged it somewhere else, their move is the newer decision and
 * "restoring" would silently undo it.
 */
export async function restoreTicketLane(
  env: Env,
  db: Db,
  state: PausedRunState,
): Promise<void> {
  if (!state.routedLane || !state.originLane) return;
  try {
    const [row] = await db
      .select({ status: tasks.status, projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, state.taskId), eq(tasks.tenantId, state.tenantId)))
      .limit(1);
    if (!row || row.status !== state.routedLane || row.projectId == null) return;
    await moveTicketToLane(env, db, {
      tenantId: state.tenantId, projectId: row.projectId, taskId: state.taskId,
      laneKey: state.originLane, submittedBy: 'system:ask-human-resume',
    });
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/executionPause.ts", operation: "restoreTicketLane", context: { logMessage: '[execution-pause] origin-lane restore failed; run still resumes', details: {
      tenantId: state.tenantId, executionId: state.executionId, taskId: state.taskId, error,
    } } });
  }
}
