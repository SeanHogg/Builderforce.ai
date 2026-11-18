/**
 * runtimeShieldIncidents — the use case behind `POST /api/security/shield-incidents`
 * (make.md › PRD 31 §4 W10, design decision 9 / phase 7).
 *
 * The browser runtime's `SecurityEventSink` adapter reports a quarantine or a block; this records it
 * as a `security_incidents` row through the `shield` finding kind (findingIncidentKinds.ts):
 * `detection_source = 'runtime-shield'`, `attestation = 'client-attested'`, the redacted evidence,
 * and `source_ref = shield:<projectId>:<applicationId>:<server ruleId>` so repeats of one reason on
 * one application land on ONE incident (reopened when it was resolved, left alone while it is worked).
 *
 * The severity and rule come from the SERVER's table for the reason code (`SHIELD_REASON_POLICY`),
 * and the floor and the "a probe does not open an incident" rule are applied HERE by the registry —
 * never trusted from the client. The project must belong to the caller's tenant AND, when the session
 * is segment-scoped, to that segment. A project holds at most `SHIELD_OPEN_INCIDENTS_PER_PROJECT`
 * open client-attested incidents; past that a report is ignored with `reason: 'cap'`.
 */
import { and, eq, like, notInArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projects, securityIncidents } from '../../infrastructure/database/schema';
import type { ActorIdentity } from '../activity/activityLog';
import { loadProjectInTenant, projectInTenantCached } from '../project/projectOwnership';
import {
  FINDING_KINDS, kindOpensIncident, openKindIncident, type KindIncidentContext, type KindIncidentOutcome,
} from './findingIncidentKinds';
import { SHIELD_OPEN_INCIDENTS_PER_PROJECT, type RuntimeShieldEvent } from './runtimeShieldEvent';

export type ShieldIncidentResult =
  | KindIncidentOutcome
  | { outcome: 'ignored'; reason: 'cap' }
  | { outcome: 'unknown_project' };

/**
 * True when the project is the caller's: the tenant's, and — when the session has a segment — that
 * segment's. A tenant-wide session keeps the cached tenant gate; a segment-scoped one reads the
 * project's segment through the same tenant-scoped gate, in one query.
 */
async function projectInCallerScope(env: Env | undefined, db: Db, ctx: KindIncidentContext, projectId: number): Promise<boolean> {
  if (!ctx.segmentId) return projectInTenantCached(env, db, ctx.tenantId, projectId);
  const project = await loadProjectInTenant(db, ctx.tenantId, projectId, { segmentId: projects.segmentId });
  return project != null && project.segmentId === ctx.segmentId;
}

/**
 * True when the project already holds the cap of OPEN (not resolved/closed) client-attested shield
 * incidents. Bounded: reads at most the cap's worth of ids, never a full count.
 */
async function shieldIncidentCapReached(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  const open = await db.select({ id: securityIncidents.id }).from(securityIncidents)
    .where(and(
      eq(securityIncidents.tenantId, tenantId),
      like(securityIncidents.sourceRef, `${FINDING_KINDS.shield.refPrefix}:${projectId}:%`),
      eq(securityIncidents.attestation, 'client-attested'),
      notInArray(securityIncidents.status, ['resolved', 'closed']),
    ))
    .limit(SHIELD_OPEN_INCIDENTS_PER_PROJECT);
  return open.length >= SHIELD_OPEN_INCIDENTS_PER_PROJECT;
}

export async function recordRuntimeShieldEvent(
  env: Env | undefined, db: Db, actor: ActorIdentity, ctx: KindIncidentContext, event: RuntimeShieldEvent,
): Promise<ShieldIncidentResult> {
  if (!(await projectInCallerScope(env, db, ctx, event.projectId))) return { outcome: 'unknown_project' };
  // A probe or a below-floor reason never costs the cap query.
  if (!kindOpensIncident('shield', event)) return { outcome: 'ignored' };
  if (await shieldIncidentCapReached(db, ctx.tenantId, event.projectId)) return { outcome: 'ignored', reason: 'cap' };
  return openKindIncident(env, db, actor, 'shield', event, ctx, {
    projectId: event.projectId, applicationId: event.applicationId, serviceId: event.serviceId,
    ruleId: event.ruleId, reasonCode: event.reasonCode, action: event.action, attestation: 'client-attested',
  });
}
