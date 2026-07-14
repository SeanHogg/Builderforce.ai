/**
 * Event-trigger dispatch — the synchronous, internal-event half of trigger
 * activation (the sibling of runDueTriggers' cron sweep and the addressed
 * webhook/inbound-email entrypoints).
 *
 * When a Reliability domain event happens (a monitor breaches, an incident opens /
 * resolves / changes status), the emitting service calls `fireEventTriggers`. It
 * looks up every enabled `workflow_triggers` row of that event type for the tenant,
 * applies the row's saved filters (severity / affected system / source / monitor
 * type / status — blank filter = "any"), and instantiates a run of each matching
 * definition on its stored target, carrying the event payload and stamping the
 * originating incident/monitor onto the run for back-linking.
 *
 * Best-effort by contract: each row is isolated, and the function never throws — a
 * bad definition or target can't fail the incident-open / breach that raised it.
 */

import { and, eq } from 'drizzle-orm';
import { workflowDefinitions, workflowTriggers } from '../../infrastructure/database/schema';
import { parseDefinition } from '../../domain/workflowGraph';
import { instantiateWorkflowRun, type RunTarget } from './instantiateRun';
import type { EventTriggerType } from '../../domain/workflowTriggers';
import type { Db } from '../../infrastructure/database/connection';

export interface FireEventTriggersParams {
  tenantId: number;
  eventType: EventTriggerType;
  /** Payload merged into the fired run's trigger node (consumed downstream via {{input}}). */
  payload: Record<string, unknown>;
  /** Run→source linkage stamped on each fired run (for the incident detail's run list). */
  sourceIncidentId?: string | null;
  sourceMonitorId?: string | null;
  /** Context matched against each trigger row's saved filter config. A blank/absent
   *  config value means "any", so an unfiltered trigger fires on every event. */
  match?: {
    severity?: string | null;
    affectedSystem?: string | null;
    incidentSource?: string | null;
    monitorType?: string | null;
    status?: string | null;
  };
}

export interface FireEventResult {
  matched: number;
  fired: number;
  errors: number;
}

/** A saved filter passes when it is blank ("any") or equals the event's value (case-insensitive). */
function filterPasses(configValue: unknown, contextValue: string | null | undefined): boolean {
  const filter = typeof configValue === 'string' ? configValue.trim() : '';
  if (!filter) return true;
  return filter.toLowerCase() === String(contextValue ?? '').trim().toLowerCase();
}

/** The run target a trigger row fires onto (snapshotted from its definition at sync). */
function targetFromTrigger(row: typeof workflowTriggers.$inferSelect): RunTarget {
  return row.runtime === 'cloud'
    ? { runtime: 'cloud', cloudAgentRef: row.cloudAgentRef }
    : { runtime: 'host', agentHostId: row.agentHostId };
}

/**
 * Fire every enabled workflow whose trigger node listens for `eventType` and whose
 * filters match the event. Never throws; returns a small counters summary.
 */
export async function fireEventTriggers(db: Db, params: FireEventTriggersParams): Promise<FireEventResult> {
  const result: FireEventResult = { matched: 0, fired: 0, errors: 0 };
  const m = params.match ?? {};

  let rows: (typeof workflowTriggers.$inferSelect)[];
  try {
    rows = await db.select().from(workflowTriggers).where(and(
      eq(workflowTriggers.tenantId, params.tenantId),
      eq(workflowTriggers.triggerType, params.eventType),
      eq(workflowTriggers.enabled, true),
    ));
  } catch (e) {
    console.error(`[wf-event-triggers] lookup failed for ${params.eventType}`, e);
    return result;
  }

  const now = new Date();
  for (const row of rows) {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(row.config || '{}') as Record<string, unknown>; } catch { config = {}; }

    // Each blank filter passes; a set filter must equal the event's value.
    if (!filterPasses(config.severity, m.severity)) continue;
    if (!filterPasses(config.affectedSystem, m.affectedSystem)) continue;
    if (!filterPasses(config.incidentSource, m.incidentSource)) continue;
    if (!filterPasses(config.monitorType, m.monitorType)) continue;
    if (!filterPasses(config.status, m.status)) continue;
    result.matched++;

    let status = 'ok';
    try {
      const [def] = await db
        .select({ name: workflowDefinitions.name, projectId: workflowDefinitions.projectId, definition: workflowDefinitions.definition })
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.id, row.definitionId), eq(workflowDefinitions.tenantId, params.tenantId)));
      if (!def) {
        status = 'error: definition missing';
        result.errors++;
      } else {
        const run = await instantiateWorkflowRun(db, {
          tenantId: params.tenantId,
          segmentId: row.segmentId,
          definition: parseDefinition(def.definition),
          name: def.name,
          projectId: def.projectId,
          definitionId: row.definitionId,
          target: targetFromTrigger(row),
          triggerPayload: params.payload,
          triggerSource: `${params.eventType}:${row.nodeId}`,
          sourceIncidentId: params.sourceIncidentId ?? null,
          sourceMonitorId: params.sourceMonitorId ?? null,
        });
        if (run.ok) { status = `ok: ${run.workflowId}`; result.fired++; }
        else { status = `error: ${run.error}`; result.errors++; }
      }
    } catch (e) {
      status = `error: ${e instanceof Error ? e.message : 'fire failed'}`;
      result.errors++;
    }

    try {
      await db.update(workflowTriggers)
        .set({ lastRunAt: now, lastStatus: status.slice(0, 32), updatedAt: now })
        .where(eq(workflowTriggers.id, row.id));
    } catch { /* best-effort bookkeeping */ }
  }

  return result;
}
