import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Event-trigger dispatch — the synchronous, internal-event half of trigger
 * activation (the sibling of runDueTriggers' cron sweep and the addressed
 * webhook/inbound-email entrypoints).
 *
 * When a domain event happens — a monitor breaches, an incident opens, a task is
 * moved on the board, a form is submitted, an order is paid, a campaign email is
 * opened — the service that OWNS that event calls `fireEventTriggers`. It looks up
 * every enabled `workflow_triggers` row of that event type for the tenant, applies
 * the row's saved filters (see TRIGGER_FILTER_KEYS — a blank filter means "any"),
 * and instantiates a run of each matching definition on its stored target, carrying
 * the event payload and stamping the originating incident/monitor onto the run for
 * back-linking.
 *
 * ── THE LISTENER GATE ───────────────────────────────────────────────────────
 * The Growth events are on genuinely hot paths: a page view happens on every hosted
 * site request, an open pixel on every campaign mail read. Querying `workflow_triggers`
 * per event would put a DB round-trip on each of those, and the honest answer is
 * almost always "nobody is listening". `hasEventTriggerListeners` answers that from
 * the read-through cache (L1 map + L2 KV) keyed by (tenant, type), so an event with
 * no subscriber costs no round-trip at all. `bumpEventTriggerListeners` — called by
 * `syncDefinitionTriggers` on every definition save — is what re-arms it, so a
 * newly published trigger starts firing immediately rather than after a TTL.
 *
 * Best-effort by contract: each row is isolated, and the function never throws — a
 * bad definition or target can't fail the incident-open / task-move that raised it.
 */

import { and, eq } from 'drizzle-orm';
import { workflowDefinitions, workflowTriggers } from '../../infrastructure/database/schema';
import { parseDefinition } from '../../domain/workflowGraph';
import { instantiateWorkflowRun, type RunTarget } from './instantiateRun';
import { EVENT_TRIGGER_TYPES, TRIGGER_FILTER_KEYS, type EventTriggerType, type TriggerFilterKey, type TriggerMatchContext } from '../../domain/workflowTriggers';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Cache key for "does this tenant have any enabled trigger of this type?". */
function listenerKey(tenantId: number, eventType: string): string {
  return `wf:evt-listeners:${tenantId}:${eventType}`;
}

/**
 * Whether any enabled trigger row of `eventType` exists for the tenant. Cached, so
 * a high-frequency emitter (page view, email open) pays nothing when nobody listens.
 * Without `env` there is no cache to consult and the answer is an honest `true` —
 * the caller then does the real lookup, which is the pre-cache behaviour.
 */
export async function hasEventTriggerListeners(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  eventType: EventTriggerType,
): Promise<boolean> {
  if (!env) return true;
  return getOrSetCached(env, listenerKey(tenantId, eventType), async () => {
    const [row] = await db
      .select({ id: workflowTriggers.id })
      .from(workflowTriggers)
      .where(and(
        eq(workflowTriggers.tenantId, tenantId),
        eq(workflowTriggers.triggerType, eventType),
        eq(workflowTriggers.enabled, true),
      ))
      .limit(1);
    return !!row;
  }, { kvTtlSeconds: 300, l1TtlMs: 30_000 });
}

/** Drop the cached listener answers for a tenant — called whenever the registry
 *  changes, so publishing a trigger takes effect on the next event, not after a TTL. */
export async function bumpEventTriggerListeners(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  await Promise.all(EVENT_TRIGGER_TYPES.map((type) =>
    invalidateCached(env, listenerKey(tenantId, type)).catch(() => undefined)));
}

export interface FireEventTriggersParams {
  tenantId: number;
  eventType: EventTriggerType;
  /** Payload merged into the fired run's trigger node (consumed downstream via {{input}}). */
  payload: Record<string, unknown>;
  /** Run→source linkage stamped on each fired run (for the incident detail's run list). */
  sourceIncidentId?: string | null;
  sourceMonitorId?: string | null;
  /** Context matched against each trigger row's saved filter config, keyed by the
   *  filter it satisfies ({@link TRIGGER_FILTER_KEYS}). A blank/absent config value
   *  means "any", so an unfiltered trigger fires on every event. */
  match?: TriggerMatchContext;
  /**
   * Worker env, when the caller has one. Enables the cached listener gate — an
   * event with no subscribing trigger then costs zero DB round-trips, which is what
   * makes it safe to emit `page-view` / `email-open` on their hot paths. Omitting it
   * is correct and simply skips the gate.
   */
  env?: Env;
}

export interface FireEventResult {
  matched: number;
  fired: number;
  errors: number;
}

/** A saved filter passes when it is blank ("any") or equals ANY of the event's
 *  aliases for that key (case-insensitive). */
function filterPasses(configValue: unknown, contextValue: TriggerMatchContext[TriggerFilterKey]): boolean {
  const filter = typeof configValue === 'string' ? configValue.trim() : '';
  if (!filter) return true;
  const aliases = Array.isArray(contextValue) ? contextValue : [contextValue as string | null | undefined];
  return aliases.some((alias) => filter.toLowerCase() === String(alias ?? '').trim().toLowerCase());
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
  const m: TriggerMatchContext = params.match ?? {};

  // Nobody listening → no query, no work. Cached per (tenant, type); a definition
  // save re-arms it via `bumpEventTriggerListeners`.
  if (!(await hasEventTriggerListeners(params.env, db, params.tenantId, params.eventType).catch(() => true))) {
    return result;
  }

  let rows: (typeof workflowTriggers.$inferSelect)[];
  try {
    rows = await db.select().from(workflowTriggers).where(and(
      eq(workflowTriggers.tenantId, params.tenantId),
      eq(workflowTriggers.triggerType, params.eventType),
      eq(workflowTriggers.enabled, true),
    ));
  } catch (e) {
    reportCaughtError(e, { source: "application/workflow/eventTriggers.ts", operation: "fireEventTriggers", context: { logMessage: `[wf-event-triggers] lookup failed for ${params.eventType}`, details: e } });
    return result;
  }

  const now = new Date();
  for (const row of rows) {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(row.config || '{}') as Record<string, unknown>; } catch { config = {}; }

    // Each blank filter passes; a set filter must equal the event's value. Driven by
    // the shared key list so a new trigger family is DATA here, not a new branch.
    if (TRIGGER_FILTER_KEYS.some((key) => !filterPasses(config[key], m[key]))) continue;
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
    } catch (error) { /* best-effort bookkeeping */ 
      reportCaughtError(error, { source: "application/workflow/eventTriggers.ts", operation: "fireEventTriggers" });
    }
  }

  return result;
}
