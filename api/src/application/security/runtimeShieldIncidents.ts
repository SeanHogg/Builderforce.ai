/**
 * runtimeShieldIncidents — the use case behind `POST /api/security/shield-incidents`
 * (make.md › PRD 31 §4 W10, design decision 9 / phase 7).
 *
 * The browser runtime's `SecurityEventSink` adapter reports a quarantine or a block; this records it
 * as a `security_incidents` row through the `shield` finding kind (findingIncidentKinds.ts):
 * `detection_source = 'runtime-shield'`, `attestation = 'client-attested'`, the redacted evidence,
 * and `source_ref = shield:<projectId>:<applicationId>:<ruleId>` so repeats of one rule on one
 * application land on ONE incident (reopened when it was resolved, left alone while it is worked).
 *
 * The severity floor and the "a probe does not open an incident" rule are applied HERE, server-side,
 * by the registry — never trusted from the client. The project must belong to the caller's tenant.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ActorIdentity } from '../activity/activityLog';
import { projectInTenantCached } from '../project/projectOwnership';
import { openKindIncident, type KindIncidentContext, type KindIncidentOutcome } from './findingIncidentKinds';
import type { RuntimeShieldEvent } from './runtimeShieldEvent';

export type ShieldIncidentResult = KindIncidentOutcome | { outcome: 'unknown_project' };

export async function recordRuntimeShieldEvent(
  env: Env | undefined, db: Db, actor: ActorIdentity, ctx: KindIncidentContext, event: RuntimeShieldEvent,
): Promise<ShieldIncidentResult> {
  if (!(await projectInTenantCached(env, db, ctx.tenantId, event.projectId))) return { outcome: 'unknown_project' };
  return openKindIncident(env, db, actor, 'shield', event, ctx, {
    projectId: event.projectId, applicationId: event.applicationId, serviceId: event.serviceId,
    ruleId: event.ruleId, reasonCode: event.reasonCode, action: event.action, attestation: 'client-attested',
  });
}
