import type * as vscode from "vscode";
import { authed, authedRaw } from "./transport";

interface BfExecution {
  id: number;
  taskId?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The outcome of dispatching a platform run (POST /api/runtime/executions). Either a
 * real execution was started (`execution`), or a priority/policy gate intercepted it and
 * a human approval is now pending (`awaitingApproval`). Mutually exclusive.
 */
interface BfSubmitResult {
  execution?: BfExecution;
  awaitingApproval?: { approvalId: string; taskId: number; reason?: string };
}

/** Cross-surface "needs attention" state for a work item (GET /api/runtime/attention).
 *  `awaiting_input` = an agent paused on ask_human and a person must answer;
 *  `running` = actively executing. Idle items are omitted. */
export type BfAttentionState = "running" | "awaiting_input";
interface BfAttentionItem {
  state: BfAttentionState;
  executionId?: number;
  approvalId?: string;
}
/** AI Manager cadence carried on the same attention signal (tenant-wide, or the
 *  selected project) so the editor can show an ambient "Manager active" status. */
export interface BfAttentionManager {
  /** ISO of the freshest manager pass in scope, or null if never managed. */
  lastRunAt: string | null;
  /** A pass landed in the last few minutes. */
  recentlyActive: boolean;
}
export interface BfAttention {
  /** Keyed by task id. */
  tasks: Record<number, BfAttentionItem>;
  /** Keyed by Brain chat id (a chat inherits the state of its linked task). */
  chats: Record<number, BfAttentionItem & { taskId?: number }>;
  counts: { running: number; awaiting: number };
  /** AI Manager cadence (present on every response). */
  manager?: BfAttentionManager;
}

const EMPTY_ATTENTION: BfAttention = { tasks: {}, chats: {}, counts: { running: 0, awaiting: 0 }, manager: { lastRunAt: null, recentlyActive: false } };

/**
 * Fetch the tenant's live "what's running / what needs a human answer" map — the
 * SAME signal the web app renders, so the Sessions and Project trees light up in
 * lockstep with the board and the browser. Scoped to `projectId` when given.
 * Degrades to an empty map when signed out / unreachable (never throws).
 */
/** The live map, or `null` when the gateway could not be reached — the poller
 *  keeps its last map and backs off, rather than painting every session idle
 *  and asking again in eight seconds. An unauthenticated read is an EMPTY map,
 *  not a failure: there is genuinely nothing live for this person. */
export async function getAttention(
  secrets: vscode.SecretStorage,
  projectId?: number,
  /** Skip the server's cached snapshot — only when the caller knows state just moved. */
  fresh = false,
): Promise<BfAttention | null> {
  try {
    const params = new URLSearchParams();
    if (projectId != null) params.set("projectId", String(projectId));
    if (fresh) params.set("fresh", "1");
    const q = params.size > 0 ? `?${params.toString()}` : "";
    const r = await authed<BfAttention>(secrets, `/api/runtime/attention${q}`);
    return r ?? EMPTY_ATTENTION;
  } catch {
    return null;
  }
}

/**
 * A failed platform dispatch, carrying the structured detail the command layer needs
 * to show a SPECIFIC, actionable message instead of the raw HTTP dump. `httpStatus`
 * branches the outcome (402 → run-limit upgrade, 429 → token-budget), `code` is the
 * gateway's machine code (e.g. `plan_token_limit_exceeded`), and `serverMessage` is
 * the human-readable reason the API already tailored to the tenant's plan.
 */
export class BfDispatchError extends Error {
  readonly httpStatus: number;
  readonly code?: string;
  readonly serverMessage?: string;
  constructor(message: string, detail: { httpStatus: number; code?: string; serverMessage?: string }) {
    super(message);
    this.name = "BfDispatchError";
    this.httpStatus = detail.httpStatus;
    this.code = detail.code;
    this.serverMessage = detail.serverMessage;
  }
}

/**
 * Dispatch a PLATFORM run for a task — the SAME endpoint the web app's
 * `runtimeApi.submitExecution` hits (POST /api/runtime/executions). This is DISTINCT
 * from the local in-editor agent loop: it asks the platform to run the task on its
 * assigned AgentHost / cloud agent. The run is then observable on the board / web app.
 *
 * Returns either the started execution (HTTP 201) or, when a priority/policy gate fires,
 * an `awaitingApproval` descriptor (HTTP 202). On any other status throws a
 * {@link BfDispatchError} carrying the HTTP status, the gateway's machine `code`, and
 * the server's tailored message so the command layer can branch (402 → run-limit
 * upgrade, 429 → token-budget) and show the specific reason.
 */
export async function submitExecution(
  secrets: vscode.SecretStorage,
  taskId: number,
  opts?: { agentHostId?: number | null; sessionId?: string; payload?: string },
): Promise<BfSubmitResult> {
  const { status, body, text } = await authedRaw<
    BfExecution & { status?: string; approvalId?: string; reason?: string; error?: string; code?: string }
  >(secrets, "/api/runtime/executions", {
    method: "POST",
    body: JSON.stringify({ taskId, ...opts }),
  });

  if (status === 202 && body?.approvalId) {
    return { awaitingApproval: { approvalId: body.approvalId, taskId, reason: body.reason } };
  }
  if (status === 201 || status === 200) {
    return { execution: body as BfExecution };
  }
  // Non-2xx: hand the command layer structured detail (status + code + the server's
  // tailored message) instead of a raw dump. Falls back to the verbatim status line
  // when the body carried no JSON `error` (e.g. an infra 5xx).
  const serverMessage = typeof body?.error === "string" ? body.error : undefined;
  throw new BfDispatchError(
    serverMessage ?? `/api/runtime/executions → HTTP ${status} ${text.slice(0, 200)}`,
    { httpStatus: status, code: typeof body?.code === "string" ? body.code : undefined, serverMessage },
  );
}
