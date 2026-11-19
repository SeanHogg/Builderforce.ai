/**
 * Worker egress policy minting — /api/runtime/worker-policy
 * (make.md › PRD 31 §4 W10, control 6).
 *
 *   POST /api/runtime/worker-policy   { projectId, applicationId: 'app:<projectId>:<16 hex>' }
 *        → 200 { policy, expiresAt, originKey }  a signed policy id bound to the app's origin, 24 h
 *        → 404 { error }               the project is not this tenant's (or this segment's)
 *        → 422 { error }               the project's declared egress cannot be signed (generic message)
 *        → 400 / 403 / 429             invalid body / below developer / over the worker-policy bucket
 *
 * Called by the browser runtime before it starts an application's process Workers on the app's
 * own origin `https://<originKey>-preview.builderforce.ai`; it appends `?policy=<policy>` to their
 * URLs. The SERVER derives `originKey` from (projectId, applicationId) with the runtime's own
 * function and decides the origins (application/runtime/workerEgressGrant). The body is strict, so
 * a client that sends `origins`, `originKey` (or anything else) is refused, never honoured.
 *
 * Mounted on its own, ahead of `/api/runtime`, with its own authMiddleware. Rate-limited twice: the
 * global tenant window (`/api/*`) plus its own `${tenantId}:worker-policy` window.
 */
import { Hono } from 'hono';
import { WORKER_POLICY_MINT_RPM, workerPolicyBucketKey } from '../../application/ratelimit/tenantBuckets';
import { applicationIdPattern } from '../../application/runtime/previewOriginKey';
import { grantWorkerEgressPolicy } from '../../application/runtime/workerEgressGrant';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { TenantRole } from '../../domain/shared/types';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { slidingWindowLimited } from '../middleware/rateLimitResponse';
import { scope } from './requestScope';
import { parseBody, zPositiveInt, z } from './requestBody';

const WorkerPolicyBody = z.object({
  projectId: zPositiveInt,
  applicationId: z.string().max(64),
}).strict().superRefine((body, ctx) => {
  if (!applicationIdPattern(body.projectId).test(body.applicationId)) {
    ctx.addIssue({ code: 'custom', path: ['applicationId'], message: 'must be app:<projectId>:<16 lowercase hex> for this project' });
  }
});

export function createWorkerPolicyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // A viewer (or a contributor) never starts the runtime: it runs for people who build.
  router.post('/', requireRole(TenantRole.DEVELOPER), async (c) => {
    const ctx = scope(c);
    const limited = await slidingWindowLimited(c, workerPolicyBucketKey(ctx.tenantId), WORKER_POLICY_MINT_RPM);
    if (limited) return limited;
    const body = await parseBody(c, WorkerPolicyBody);
    const result = await grantWorkerEgressPolicy(c.env as Env, db, ctx, body);
    switch (result.outcome) {
      case 'unknown_project': return c.json({ error: 'project not found' }, 404);
      case 'invalid_declaration': return c.json({ error: 'the project\'s declared egress cannot be allowed' }, 422);
      case 'minted': return c.json({ policy: result.policy, expiresAt: result.expiresAt, originKey: result.originKey }, 200);
    }
  });

  return router;
}
