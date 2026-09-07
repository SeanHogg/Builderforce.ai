/**
 * Fire the workflow behind an ADDRESSED trigger — one reached by its own random
 * token rather than by a session: a webhook POST, or an email arriving at the
 * inbox whose local-part IS that token.
 *
 * WHY IT IS IN THE APPLICATION LAYER. It lived in
 * `presentation/routes/workflowTriggerRoutes` and `application/workflow/inboundEmail`
 * imported it from there — but the email path has no HTTP request at all (it is
 * driven by the Worker `email()` handler), so the route module was load-bearing for
 * a transport it never serves (see `check-application-layering`). Both entrypoints
 * now call in here, which is what kept them from drifting in the first place.
 */
import { and, eq } from 'drizzle-orm';
import { workflowDefinitions, workflowTriggers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseDefinition } from '../../domain/workflowGraph';
import { instantiateWorkflowRun, type RunTarget } from './instantiateRun';
import type { Db } from '../../infrastructure/database/connection';

/** Build the run target a trigger row fires onto. */
function targetFromTrigger(row: typeof workflowTriggers.$inferSelect): RunTarget {
  return row.runtime === 'cloud'
    ? { runtime: 'cloud', cloudAgentRef: row.cloudAgentRef }
    : { runtime: 'host', agentHostId: row.agentHostId };
}

/**
 * Fire the workflow behind an addressed (webhook / inbound-email) trigger.
 * Shared by the HTTP route and the inbound-email handler.
 */
export async function fireAddressedTrigger(
  db: Db,
  row: typeof workflowTriggers.$inferSelect,
  payload: unknown,
  source: string,
): Promise<{ ok: true; workflowId: string } | { ok: false; error: string }> {
  const [defRow] = await db
    .select({ name: workflowDefinitions.name, projectId: workflowDefinitions.projectId, definition: workflowDefinitions.definition })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, row.definitionId), eq(workflowDefinitions.tenantId, row.tenantId)));
  if (!defRow) return { ok: false, error: 'workflow definition not found' };

  const result = await instantiateWorkflowRun(db, {
    tenantId: row.tenantId,
    segmentId: row.segmentId,
    definition: parseDefinition(defRow.definition),
    name: defRow.name,
    projectId: defRow.projectId,
    definitionId: row.definitionId,
    target: targetFromTrigger(row),
    triggerPayload: payload,
    triggerSource: source,
  });

  await db
    .update(workflowTriggers)
    .set({
      lastRunAt: new Date(),
      lastStatus: (result.ok ? `ok: ${result.workflowId}` : `error: ${result.error}`).slice(0, 32),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(workflowTriggers, row.tenantId, eq(workflowTriggers.id, row.id)));

  return result.ok ? { ok: true, workflowId: result.workflowId } : { ok: false, error: result.error };
}
