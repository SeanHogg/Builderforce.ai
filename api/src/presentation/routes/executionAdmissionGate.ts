import type { Context, MiddlewareHandler } from 'hono';
import { idempotentReplay } from '../middleware/idempotentReplay';
import { evaluateExecutionApprovalGate, type ApprovalGateTask } from '../../application/runtime/executionApprovalGate';
import { executionTokenGate } from './executionTokenGate';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  CONCURRENT_RUN_RETRY_AFTER_SECONDS,
  type AdmissionRefusal,
} from '../../application/runtime/dispatchAdmission';
import { admissionRefusalResponse, admitHumanDispatch, type DispatchRefusal } from '../../application/runtime/humanDispatchAdmission';
import { steerRateLimited, steerTextTooLong, STEER_MAX_TEXT_CHARS } from '../../application/runtime/steerGuard';
import { unbindableRunChat, UNBINDABLE_RUN_CHAT_ERROR } from '../../application/runtime/runChatBinding';

/**
 * THE HTTP adapters for run admission, beside {@link ./executionTokenGate}. They hold no
 * policy: the policy (live-run dedupe, concurrent cap, budget floor, steer limits) lives
 * in `application/runtime`. Each maps a typed refusal to its response.
 */

function respond<E extends HonoEnv>(c: Context<E>, refusal: DispatchRefusal): Response {
  if (refusal.retryAfterSeconds != null) c.header('Retry-After', String(refusal.retryAfterSeconds));
  return c.json(refusal.body, refusal.status);
}

/** Maps a typed admission refusal (from the choke point) to 409 (live run exists) or 429 (cap, with Retry-After). */
export function admissionRefusalToResponse<E extends HonoEnv>(c: Context<E>, refusal: AdmissionRefusal): Response {
  return respond(c, admissionRefusalResponse(refusal, CONCURRENT_RUN_RETRY_AFTER_SECONDS));
}

/**
 * The pre-row fast path for both submit routes (`/executions`, `/tasks/submit`). Returns
 * the 409 / 429 Response to return straight from the handler, or null to proceed.
 *
 * `pinnedHost` = the run is pinned to an On-Prem host or comes from the editor. It only
 * decides whether the optimistic cap look and budget floor are worth a query; a pinned
 * run that falls back to the cloud is still gated at the choke point.
 *
 * ACCEPTED DEVIATION: `pinnedHost` comes from the client's `X-AgentHost-Id` header / body, so
 * a client can claim a host to skip the pre-row CAP LOOK and the BUDGET FLOOR (B3). Both are
 * advisory fast paths (an early, explainable refusal), not entitlements: the cap is enforced
 * at the choke point from the routing outcome, and the token gate still refuses an exhausted
 * allowance. Forging the header buys a failed run instead of a fast 429, nothing more.
 */
export async function executionAdmissionGate<E extends HonoEnv>(
  c: Context<E>,
  db: Db,
  args: { taskId: number; pinnedHost: boolean },
): Promise<Response | null> {
  const refusal = await admitHumanDispatch(c.env as Env, db, {
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    taskId: args.taskId,
    cloudBound: !args.pinnedHost && c.get('clientSurface') !== 'vscode',
  });
  return refusal ? respond(c, refusal) : null;
}

/** Steer abuse limits (PRD 09 S3): 413 for an over-long message. */
export function steerTextAdmission<E extends HonoEnv>(c: Context<E>, text: string): Response | null {
  return steerTextTooLong(text)
    ? c.json({ error: `Message is too long (max ${STEER_MAX_TEXT_CHARS} characters)`, code: 'message_too_long', maxChars: STEER_MAX_TEXT_CHARS }, 413)
    : null;
}

/** Steer abuse limits (PRD 09 S3): 429 once the execution's per-minute bucket is full. */
export async function steerRateAdmission<E extends HonoEnv>(c: Context<E>, executionId: number): Promise<Response | null> {
  const retryAfter = await steerRateLimited(c.env as Env, executionId);
  if (retryAfter == null) return null;
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: 'Too many messages to this run. Slow down.', code: 'steer_rate_limited', retryAfterSeconds: retryAfter }, 429);
}

/**
 * `Idempotency-Key` replay for the submit routes (PRD 09 D6): the same tenant + key within 24h answers with the
 * ORIGINAL response instead of starting a second billable run. Bound to the request body, because the body decides
 * what runs. Generic over the route's env, so the runtime router (wider Bindings) mounts it without a cast.
 */
export function replayOnIdempotencyKey<E extends HonoEnv>(): MiddlewareHandler<E> {
  return idempotentReplay<E>({ bindBody: true });
}

/**
 * EVERY pre-row gate of the two submit routes (`/executions`, `/tasks/submit`), in order, so the routes cannot drift:
 *   0. the chat binding - a `payload.chatId` the submitter cannot open -> 404 (same rule and words as run-now);
 *   1. admission - live-run dedupe, concurrent cap, budget floor (PRD 09 D6/D8/B3) -> 409 / 429;
 *   2. the token gate - no budget, no run (shared with Run-now and the board Run; the superadmin bypass lives there) -> 429;
 *   3. the approval gate - a ticket that needs sign-off answers 202 `awaiting_approval` instead of running.
 * Returns the Response to return straight from the handler, or null to proceed.
 *
 * `agentHostId` is the host the caller named (header, else body); the ticket's own pinned host only counts for admission.
 */
export async function submitRunGates<E extends HonoEnv>(
  c: Context<E>,
  db: Db,
  a: { task: ApprovalGateTask; agentHostId: number | null; payload?: string },
): Promise<Response | null> {
  // 0. A `payload.chatId` binds the run to a chat — only one the submitter can open (the run-now rule, one helper).
  if (await unbindableRunChat(db, c.get('tenantId'), c.get('userId'), a.payload) != null) {
    return c.json({ error: UNBINDABLE_RUN_CHAT_ERROR }, 404);
  }

  const admissionBlock = await executionAdmissionGate(c, db, {
    taskId: a.task.id,
    pinnedHost: (a.agentHostId ?? a.task.assignedAgentHostId) != null,
  });
  if (admissionBlock) return admissionBlock;

  const tokenBlock = await executionTokenGate(c, db);
  if (tokenBlock) return tokenBlock;

  const gate = await evaluateExecutionApprovalGate(db, c.get('tenantId'), c.get('userId'), a.task, a.agentHostId, { payload: a.payload });
  if (gate.allowed) return null;
  return c.json({ status: 'awaiting_approval', approvalId: gate.approvalId, taskId: a.task.id, reason: gate.reason }, 202);
}
