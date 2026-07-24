/**
 * Incident-agent dispatch — kicks the Incident Manager agent off to triage an open
 * incident: read the ticket, confirm which SYSTEM it pertains to (incidents.classify),
 * post updates to the war room, and page/escalate as needed (oncall.page).
 *
 * The Incident Manager is a normal, assignable cloud agent (seeded, migration 0326)
 * marked builtin_kind='incident_manager'. The incident's bridged INCIDENT board task
 * (already assigned to the agent) IS the anchor the task-centric cloud run hangs on,
 * so we dispatch straight against it with an `incidentTriage` payload marker — the
 * exact shape securityDispatch uses for audits.
 */
import { and, eq } from 'drizzle-orm';
import { ideAgents } from '../../infrastructure/database/schema';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { buildRuntimeService } from '../../buildRuntimeService';
import { INCIDENT_TRIAGE_LANE_KEY } from './incidentTriageMarker';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The tenant's Incident Manager agent id, or null when the tenant has none. An active
 * ide_agents row marked builtin_kind='incident_manager' — stable across a rename.
 */
export async function findTenantIncidentManagerRef(db: Db, tenantId: number): Promise<string | null> {
  const [row] = await db
    .select({ id: ideAgents.id })
    .from(ideAgents)
    .where(and(
      eq(ideAgents.tenantId, tenantId),
      eq(ideAgents.status, 'active'),
      eq(ideAgents.builtinKind, 'incident_manager'),
    ))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Dispatch the Incident Manager to triage one incident. Best-effort: returns false
 * when the tenant has no Incident Manager, the incident has no board task to anchor
 * on, or dispatch fails — the incident + its initial page stand regardless.
 */
export async function dispatchIncidentTriage(
  env: Env,
  db: Db,
  params: { tenantId: number; incidentId: string; boardTaskId: number | null; incidentRef?: string | null },
): Promise<boolean> {
  const incidentRef = params.incidentRef ?? (await findTenantIncidentManagerRef(db, params.tenantId));
  if (!incidentRef || params.boardTaskId == null) return false;

  const runtimeService = buildRuntimeService(env, db);

  // Don't stack a second triage run on a ticket that's already being worked — the
  // runtime has no concurrency guard, so two agents would race the same bridged board
  // task. This makes every caller idempotent: a re-breach, an escalation paging the
  // on-call agent, and the open-time dispatch can all call this safely.
  const active = await runtimeService.listActiveByTasks([params.boardTaskId]).catch(() => []);
  if (active.length > 0) return false;

  const payload = JSON.stringify({ cloudAgentRef: incidentRef, laneKey: INCIDENT_TRIAGE_LANE_KEY, incidentTriage: true, incidentId: params.incidentId });
  const deferred: Promise<unknown>[] = [];
  try {
    await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
      taskId: params.boardTaskId,
      tenantId: params.tenantId,
      payload,
      submittedBy: `incident:${incidentRef}`,
    });
    await Promise.allSettled(deferred);
    return true;
  } catch (err) {
    console.error('[incident] triage dispatch failed', params.incidentId, err);
    return false;
  }
}
