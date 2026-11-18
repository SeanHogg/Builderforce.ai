/**
 * Runtime Security Shield ingest — /api/security/shield-incidents
 * (make.md › PRD 31 §4 W10, design decision 9 / phase 7).
 *
 *   POST /api/security/shield-incidents   one incident-worthy SecurityEvent from the browser runtime
 *        → 201 { outcome: 'opened', incidentId }   a new incident, or a resolved one reopened
 *        → 200 { outcome: 'deduplicated' }         already open for this project/application/rule
 *        → 202 { outcome: 'ignored' }              below the severity floor, or a probe (not a block)
 *        → 404 { error }                           the project is not this tenant's
 *        → 400 / 429                               invalid body / over the shield bucket
 *
 * Called by Builderforce's `SecurityEventSink` adapter for `@seanhogg/builderforce-webcontainers`
 * with the signed-in user's session — the tenant and segment come from the session, never the body.
 * Every report is CLIENT-ATTESTED. The floor and the probe rule are the server's (the `shield`
 * finding kind); nothing in the body can raise an incident above what the registry allows, and this
 * is the ONLY way a `shield:` ref is written (the `/api/governance/incidents` tracker cannot set
 * `sourceRef` at all).
 *
 * Mounted inside `createSecurityReviewRoutes`, BEHIND its authMiddleware. Rate-limited twice: the
 * global tenant window (`/api/*`) plus its own `${tenantId}:shield` window.
 */
import { Hono } from 'hono';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import { SHIELD_INGEST_RPM, shieldIngestBucketKey } from '../../application/ratelimit/tenantBuckets';
import { INCIDENT_SEVERITIES } from '../../application/security/findingIncidentKinds';
import { recordRuntimeShieldEvent } from '../../application/security/runtimeShieldIncidents';
import {
  evidenceByteLength, findForbiddenEvidenceKey, SHIELD_ACTIONS, SHIELD_CATEGORIES, SHIELD_EVIDENCE_MAX_BYTES,
  SHIELD_REASON_CODES,
} from '../../application/security/runtimeShieldEvent';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { slidingWindowLimited } from '../middleware/rateLimitResponse';
import { scope } from './segmentTrackerRoutes';
import { parseBody, zPositiveInt, z } from './requestBody';

/** An identifier the runtime minted — it becomes part of `source_ref`, so no whitespace and no `:`. */
const zShieldId = z.string().regex(/^[\w.@/-]{1,128}$/, 'must be 1-128 characters of letters, digits, _ . @ / -');

const ShieldEventBody = z.object({
  category: z.enum(SHIELD_CATEGORIES),
  ruleId: zShieldId,
  severity: z.enum(INCIDENT_SEVERITIES),
  reasonCode: z.enum(SHIELD_REASON_CODES),
  action: z.enum(SHIELD_ACTIONS),
  applicationId: zShieldId,
  serviceId: zShieldId,
  projectId: zPositiveInt,
  evidence: z.record(z.string(), z.unknown()).superRefine((evidence, ctx) => {
    const forbidden = findForbiddenEvidenceKey(evidence);
    if (forbidden) ctx.addIssue({ code: 'custom', message: `evidence must be redacted: "${forbidden}" is a credential key or nests too deep` });
    else if (evidenceByteLength(evidence) > SHIELD_EVIDENCE_MAX_BYTES) ctx.addIssue({ code: 'custom', message: `evidence must be at most ${SHIELD_EVIDENCE_MAX_BYTES} bytes` });
  }),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

export function createRuntimeShieldRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/', async (c) => {
    const ctx = scope(c);
    const limited = await slidingWindowLimited(c, shieldIngestBucketKey(ctx.tenantId), SHIELD_INGEST_RPM);
    if (limited) return limited;
    const event = await parseBody(c, ShieldEventBody);
    const env = c.env as Env;
    const actor = await resolveActorFromContext(env, db, c);
    const result = await recordRuntimeShieldEvent(env, db, actor, ctx, event);
    switch (result.outcome) {
      case 'unknown_project': return c.json({ error: 'project not found' }, 404);
      case 'opened': return c.json(result, 201);
      case 'deduplicated': return c.json(result, 200);
      case 'ignored': return c.json(result, 202);
    }
  });

  return router;
}
