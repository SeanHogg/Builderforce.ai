/**
 * mergeGrantRequest — the ONE way a dispatch route accepts a person's "merge into main" grant
 * (PRD 48 §4.6): the body field, the two refusals, and the write. Shared by every route a person
 * starts a cloud run from (`POST /api/runtime/executions`, `POST /api/tasks/:id/run-now`), so the
 * gate cannot differ between them. No agent tool forwards the field: a grant is a person's
 * explicit action in the web UI.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import {
  MERGE_GRANT_REASON_MAX, mergeGrantDispatchRefusal, mergeGrantRefusal, recordMergeGrant,
} from '../../application/runtime/mergeGrants';
import { z } from './requestBody';

/** `mergeGrant: { reason }` — optional; a grant without a reason is a 400. */
export const zMergeGrant = z.object({
  reason: z.string().trim().min(1, 'A merge grant needs a reason').max(MERGE_GRANT_REASON_MAX),
}).optional();

export type MergeGrantBody = z.infer<typeof zMergeGrant>;

/** The database handle the grant is written through (typed off the application call, so this route helper imports no infrastructure). */
type Db = Parameters<typeof recordMergeGrant>[1];

/**
 * Refuse a grant this CALLER may not give — a run, an agent, an API key, a device client, or a
 * person below the in-product merge role — BEFORE anything is dispatched. Null when the request
 * carries no grant or the caller may give it.
 */
export function refuseMergeGrant<E extends HonoEnv>(c: Context<E>, grant: MergeGrantBody): Response | null {
  if (!grant) return null;
  const ctx = c as unknown as Context<HonoEnv>;
  const why = mergeGrantRefusal({
    role: ctx.get('role') as string | undefined,
    machineActor: ctx.get('machineActor'),
    agentActorRef: ctx.get('agentActorRef') ?? null,
    apiKeyId: ctx.get('apiKeyId'),
    clientSurface: ctx.get('clientSurface') ?? null,
  });
  return why ? ctx.json({ error: why, code: 'merge_grant_refused' }, 403) : null;
}

/**
 * Refuse a grant this DISPATCH may not carry — a run the dispatcher would route to an on-prem host,
 * or a ticket spanning several repositories — BEFORE anything is dispatched (400 with the code).
 */
export async function refuseMergeGrantDispatch<E extends HonoEnv>(
  c: Context<E>, db: Db, grant: MergeGrantBody,
  a: { taskId: number; agentHostId?: number | null; payload?: string },
): Promise<Response | null> {
  if (!grant) return null;
  const ctx = c as unknown as Context<HonoEnv>;
  const refusal = await mergeGrantDispatchRefusal(ctx.env as Env, db, { tenantId: ctx.get('tenantId') as number, ...a });
  return refusal ? ctx.json({ error: refusal.error, code: refusal.code }, 400) : null;
}

/**
 * Record the grant for the execution the route just created — AFTER its row exists and BEFORE the
 * run starts, so the run's first tick reads it. NEVER throws: a failed write is REPORTED and
 * answered as `'failed'` (the response says so and the run control shows it) rather than a 500 that
 * hides the run. Undefined when the request carried no grant.
 */
export async function grantMergeFromRequest<E extends HonoEnv>(
  c: Context<E>, db: Db, grant: MergeGrantBody,
  a: { executionId: number; projectId?: number | null },
): Promise<'recorded' | 'failed' | undefined> {
  if (!grant) return undefined;
  const ctx = c as unknown as Context<HonoEnv>;
  const userId = ctx.get('userId') as string | undefined;
  if (!userId) return 'failed';
  try {
    await recordMergeGrant(ctx.env as Env, db, {
      tenantId: ctx.get('tenantId') as number,
      executionId: a.executionId,
      grantedBy: userId,
      reason: grant.reason,
      actor: await resolveActorFromContext(ctx.env as Env, db, ctx),
      projectId: a.projectId ?? null,
    });
    return 'recorded';
  } catch (error) {
    reportCaughtError(error, {
      source: 'presentation/routes/mergeGrantRequest.ts', operation: 'grantMergeFromRequest',
      context: { executionId: a.executionId },
    });
    return 'failed';
  }
}
