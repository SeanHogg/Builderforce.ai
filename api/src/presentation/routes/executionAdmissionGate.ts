import type { Context } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  CONCURRENT_RUN_RETRY_AFTER_SECONDS,
  type AdmissionRefusal,
} from '../../application/runtime/dispatchAdmission';
import { admissionRefusalResponse, admitHumanDispatch, type DispatchRefusal } from '../../application/runtime/humanDispatchAdmission';
import { steerRateLimited, steerTextTooLong, STEER_MAX_TEXT_CHARS } from '../../application/runtime/steerGuard';

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
