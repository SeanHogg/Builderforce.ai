/**
 * Scheduler sweep — the cron-driven half of trigger activation. Fires every
 * `schedule` and `rss` trigger whose `next_run_at` is due, instantiates a run on
 * the trigger's stored target, and re-arms the trigger:
 *
 *   schedule → run now; next_run_at = nextCronTime(cron, now, tz)
 *   rss      → fetch the feed; if there are items newer than the cursor, run with
 *              them as payload and advance the cursor; next_run_at = now + poll
 *
 * Invoked from the Worker `scheduled()` handler. Each trigger is processed
 * independently and failures are isolated so one bad feed/target can't stall the
 * rest of the sweep. Designed to be cheap on an idle tick (a single indexed
 * "due rows" query that returns nothing).
 */

import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { workflowDefinitions, workflowTriggers } from '../../infrastructure/database/schema';
import { parseDefinition } from '../../domain/workflowGraph';
import { nextCronTime } from '../../domain/workflowSchedule';
import { configString, configPositiveInt } from '../../domain/workflowTriggers';
import { instantiateWorkflowRun, type RunTarget } from './instantiateRun';
import { fetchFeedItems, type FeedItem } from './rssFeed';
import type { Db } from '../../infrastructure/database/connection';

export interface SchedulerEnv {
  NEON_DATABASE_URL: string;
}

const DEFAULT_RSS_POLL_MINUTES = 15;

/** Build the run target a trigger row fires onto. */
function targetFromTrigger(row: typeof workflowTriggers.$inferSelect): RunTarget {
  return row.runtime === 'cloud'
    ? { runtime: 'cloud', cloudAgentRef: row.cloudAgentRef }
    : { runtime: 'host', agentHostId: row.agentHostId };
}

/** Load the owning definition's name + parsed graph. */
async function loadDefinition(db: Db, definitionId: string, tenantId: number) {
  const [row] = await db
    .select({ name: workflowDefinitions.name, projectId: workflowDefinitions.projectId, definition: workflowDefinitions.definition })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.tenantId, tenantId)));
  if (!row) return null;
  return { name: row.name, projectId: row.projectId, definition: parseDefinition(row.definition) };
}

/** Fire a schedule trigger and re-arm its next run from the cron expression. */
async function runScheduleTrigger(db: Db, row: typeof workflowTriggers.$inferSelect, now: Date): Promise<string> {
  const config = JSON.parse(row.config || '{}') as Record<string, unknown>;
  const cron = configString(config, 'cron');
  const tz = configString(config, 'timezone') ?? 'UTC';

  const def = await loadDefinition(db, row.definitionId, row.tenantId);
  let status = 'ok';
  if (!def) {
    status = 'error: definition missing';
  } else {
    const result = await instantiateWorkflowRun(db, {
      tenantId: row.tenantId,
      segmentId: row.segmentId,
      definition: def.definition,
      name: def.name,
      projectId: def.projectId,
      definitionId: row.definitionId,
      target: targetFromTrigger(row),
      triggerSource: `schedule:${row.nodeId}`,
    });
    status = result.ok ? `ok: ${result.workflowId}` : `error: ${result.error}`;
  }

  const nextRunAt = cron ? nextCronTime(cron, now, tz) : null;
  await db
    .update(workflowTriggers)
    .set({ lastRunAt: now, lastStatus: status.slice(0, 32), nextRunAt, updatedAt: now })
    .where(eq(workflowTriggers.id, row.id));
  return status;
}

/** Poll an rss trigger; run once with any new items, advance cursor, re-arm. */
async function runRssTrigger(db: Db, row: typeof workflowTriggers.$inferSelect, now: Date): Promise<string> {
  const config = JSON.parse(row.config || '{}') as Record<string, unknown>;
  const feedUrl = configString(config, 'feedUrl');
  const pollMinutes = configPositiveInt(config, 'pollMinutes') ?? DEFAULT_RSS_POLL_MINUTES;
  const nextRunAt = new Date(now.getTime() + pollMinutes * 60_000);

  let status = 'ok: no new items';
  if (!feedUrl) {
    status = 'error: no feedUrl';
    await db
      .update(workflowTriggers)
      .set({ lastRunAt: now, lastStatus: status.slice(0, 32), nextRunAt, updatedAt: now })
      .where(eq(workflowTriggers.id, row.id));
    return status;
  }

  let items: FeedItem[] = [];
  try {
    items = await fetchFeedItems(feedUrl);
  } catch (e) {
    status = `error: ${e instanceof Error ? e.message : 'fetch failed'}`;
    await db
      .update(workflowTriggers)
      .set({ lastRunAt: now, lastStatus: status.slice(0, 32), nextRunAt, updatedAt: now })
      .where(eq(workflowTriggers.id, row.id));
    return status;
  }

  // New items are those above the stored cursor (the last-seen item id). On the
  // first poll (no cursor) we adopt the newest id WITHOUT firing, so a new
  // trigger doesn't replay the entire backlog.
  const newestId = items[0]?.id ?? null;
  let newCursor = row.cursor;
  if (row.cursor === null || row.cursor === undefined) {
    newCursor = newestId;
  } else {
    const seenIdx = items.findIndex((it) => it.id === row.cursor);
    const fresh = seenIdx === -1 ? items : items.slice(0, seenIdx);
    if (fresh.length > 0) {
      const def = await loadDefinition(db, row.definitionId, row.tenantId);
      if (!def) {
        status = 'error: definition missing';
      } else {
        const result = await instantiateWorkflowRun(db, {
          tenantId: row.tenantId,
          segmentId: row.segmentId,
          definition: def.definition,
          name: def.name,
          projectId: def.projectId,
          definitionId: row.definitionId,
          target: targetFromTrigger(row),
          triggerPayload: { feedUrl, items: fresh },
          triggerSource: `rss:${row.nodeId}`,
        });
        status = result.ok ? `ok: ${fresh.length} new` : `error: ${result.error}`;
      }
      newCursor = newestId;
    }
  }

  await db
    .update(workflowTriggers)
    .set({ lastRunAt: now, lastStatus: status.slice(0, 32), nextRunAt, cursor: newCursor, updatedAt: now })
    .where(eq(workflowTriggers.id, row.id));
  return status;
}

export interface SweepResult {
  due: number;
  fired: number;
  errors: number;
}

/** Process all due schedule + rss triggers. Safe to call on every cron tick. */
export async function runDueTriggers(env: SchedulerEnv): Promise<SweepResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);
  const now = new Date();

  const due = await db
    .select()
    .from(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.enabled, true),
        inArray(workflowTriggers.triggerType, ['schedule', 'rss']),
        isNotNull(workflowTriggers.nextRunAt),
        lte(workflowTriggers.nextRunAt, now),
      ),
    );

  let fired = 0;
  let errors = 0;
  for (const row of due) {
    try {
      const status =
        row.triggerType === 'rss'
          ? await runRssTrigger(db, row, now)
          : await runScheduleTrigger(db, row, now);
      if (status.startsWith('error')) errors++;
      else fired++;
    } catch (e) {
      errors++;
      console.error(`[cron:wf-triggers] trigger ${row.id} failed`, e);
    }
  }

  console.log(`[cron:wf-triggers] due=${due.length} fired=${fired} errors=${errors}`);
  return { due: due.length, fired, errors };
}
