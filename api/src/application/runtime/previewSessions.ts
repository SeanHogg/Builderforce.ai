/**
 * Live container preview — the COST CONTROL layer.
 *
 * Phase 2 shipped the transport (signed token → `preview.builderforce.ai/<tok>/*` →
 * the run's `AgentContainerDO` → its dev server). What it did not have was any answer
 * to "what does this cost, and who is allowed to spend it?" — and a per-project live
 * preview is a LONG-LIVED container instance per active editor tab, which is a very
 * different consumption shape from an agent run that starts, works, and exits.
 *
 * Everything that decides the spend lives here — one module, so the mint endpoint, the
 * ingress, and the eviction sweep can never disagree:
 *
 *   • {@link PREVIEW_GLOBAL_INSTANCE_BUDGET}   how many of the deployment's container
 *                                              instances previews may hold at once
 *   • {@link PREVIEW_TENANT_CONCURRENCY_CAP}   how many one tenant may hold of those
 *   • {@link PREVIEW_IDLE_EVICTION_MS}         how long an unwatched preview survives
 *
 * The paid-plan question is NOT decided here: it is `planFeatures.livePreview` resolved
 * through the ONE existing evaluator (`presentation/middleware/featureGate.requireFeature`),
 * which answers 402. This module is only about capacity.
 */
import { eq, inArray, lt, sql } from 'drizzle-orm';
import { executions, previewSessions, tasks } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { isTerminalExecutionStatus } from './cloudDispatch';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * THE INSTANCE BUDGET.
 *
 * `wrangler.toml` caps `AgentContainerDO` at `max_instances`. Before live preview, an
 * instance was always a RUN: it started, worked, and exited, so 5 concurrent instances
 * served far more than 5 users a day. A preview inverts that — one instance is pinned
 * open for as long as an editor tab is open — so the same cap that comfortably served
 * runs cannot serve "a handful of concurrent users" of preview, which is exactly the
 * gap this closes.
 *
 * Chosen: `max_instances = 25`, split 15 preview / ≥10 run.
 *
 *   • 25 is the ceiling we are willing to be billed for on a Containers-Paid account at
 *     this stage; container-seconds are the dearest unit on the platform (the same
 *     reasoning that puts `stageSandboxRunsMonthly` below `cloudRunsMonthly`).
 *   • 15 for preview because a preview instance is IDLE-heavy (it serves a phone
 *     refreshing a page), where a run instance is CPU-heavy; previews are the cheaper
 *     half of the same cap and are what a person watches in real time.
 *   • The remaining ≥10 are RESERVED for agent runs by construction: previews are
 *     refused at 15, so a preview surge can never starve dispatch. That reservation is
 *     the whole point of a preview-specific budget rather than one shared free-for-all.
 */
export const AGENT_CONTAINER_MAX_INSTANCES = 25;
export const PREVIEW_GLOBAL_INSTANCE_BUDGET = 15;

/**
 * THE PER-TENANT CAP. One tenant may hold 2 of the 15.
 *
 * Two because a person legitimately previews a web build and a mobile build side by
 * side; a third simultaneous preview from ONE workspace is a leaked tab, not work. At 2
 * it takes eight distinct paying tenants to exhaust the global budget, so the failure
 * mode is "we are genuinely popular" rather than "one tenant took everything" — the
 * property the roadmap item asks for.
 */
export const PREVIEW_TENANT_CONCURRENCY_CAP = 2;

/**
 * THE IDLE-EVICTION POLICY. 3 minutes, against the DO's 20-minute `sleepAfter`.
 *
 * `sleepAfter = '20m'` is right for a RUN: a container can legitimately sit quiet for
 * minutes inside one `run_command` (an install, a build, a test suite) and killing it
 * would destroy work in progress. A preview has the opposite shape — it is watched or
 * it is abandoned, and it abandons the instant the editor tab closes, with no in-flight
 * state to lose (the dev server is reproducible from the repo). Holding an instance for
 * 20 minutes after the last request therefore bills ~17 minutes of nothing, per tab.
 *
 * 3 minutes is comfortably longer than any believable human pause between preview
 * requests (a phone screen locking, a person reading the page, an HMR reconnect) and
 * ~6× the 30s ingress touch throttle below, so an actively-watched preview can never be
 * evicted by a throttled heartbeat. Evicting a preview is also cheap to undo: the panel
 * re-mints and the run re-starts the dev server.
 *
 * The sweep that enforces it runs on the `frequent` (5-minute) cron, so the real
 * worst case is idle+tick ≈ 8 minutes — still less than half the DO's own 20m, and the
 * `start` op signals pending work so the KV-gated tick actually fires while a preview
 * is open rather than waiting out the 30-minute floor.
 */
export const PREVIEW_IDLE_EVICTION_MS = 3 * 60_000;

/**
 * How often a preview's `last_seen_at` is actually written. One page load is dozens of
 * asset requests plus an HMR socket; writing per request would put a Neon round-trip on
 * the ingress hot path for no extra information. Throttled through the shared
 * read-through cache (never an inline Map+TTL).
 */
export const PREVIEW_TOUCH_THROTTLE_SECONDS = 30;

/** Lifecycle of one preview lease. */
export type PreviewSessionStatus = 'starting' | 'live' | 'failed' | 'idle_evicted' | 'stopped';

/** The statuses that HOLD a container instance (and so count against the budgets). */
const HOLDING_STATUSES: readonly PreviewSessionStatus[] = ['starting', 'live'];

export interface PreviewSessionRow {
  executionId: number;
  projectId: number | null;
  port: number;
  status: PreviewSessionStatus;
  detail: string | null;
  lastSeenAt: Date;
}

export type PreviewCapacityVerdict =
  | { ok: true }
  | { ok: false; reason: 'tenant_cap'; limit: number }
  | { ok: false; reason: 'global_budget'; limit: number };

/** How many previews this tenant is currently holding open. */
export async function countTenantPreviews(db: Db, tenantId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(previewSessions)
    .where(scopedToTenant(previewSessions, tenantId, inArray(previewSessions.status, [...HOLDING_STATUSES])));
  return row?.n ?? 0;
}

/** How many previews the whole deployment is holding open — the global budget read. */
export async function countGlobalPreviews(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(previewSessions)
    // Deliberately cross-tenant: the instance budget is a property of the DEPLOYMENT
    // (one `max_instances` for every tenant), so a tenant-filtered count cannot answer
    // it. The access predicate is the status filter, and only a count leaves here.
    .where(acrossTenants(previewSessions, 'platform_aggregate', inArray(previewSessions.status, [...HOLDING_STATUSES])));
  return row?.n ?? 0;
}

/**
 * May this tenant open ONE more preview? Checks the per-tenant cap first (the answer a
 * user can act on) and the global budget second. An execution that ALREADY holds a
 * lease is re-arming, not acquiring, so it never re-pays the cap.
 */
export async function checkPreviewCapacity(
  db: Db, tenantId: number, executionId: number,
): Promise<PreviewCapacityVerdict> {
  const existing = await loadPreviewSession(db, tenantId, executionId);
  if (existing && HOLDING_STATUSES.includes(existing.status)) return { ok: true };

  const mine = await countTenantPreviews(db, tenantId);
  if (mine >= PREVIEW_TENANT_CONCURRENCY_CAP) {
    return { ok: false, reason: 'tenant_cap', limit: PREVIEW_TENANT_CONCURRENCY_CAP };
  }
  const global = await countGlobalPreviews(db);
  if (global >= PREVIEW_GLOBAL_INSTANCE_BUDGET) {
    return { ok: false, reason: 'global_budget', limit: PREVIEW_GLOBAL_INSTANCE_BUDGET };
  }
  return { ok: true };
}

/** The lease for one execution, or null. */
export async function loadPreviewSession(
  db: Db, tenantId: number, executionId: number,
): Promise<PreviewSessionRow | null> {
  const [row] = await db
    .select({
      executionId: previewSessions.executionId,
      projectId: previewSessions.projectId,
      port: previewSessions.port,
      status: previewSessions.status,
      detail: previewSessions.detail,
      lastSeenAt: previewSessions.lastSeenAt,
    })
    .from(previewSessions)
    .where(scopedToTenant(previewSessions, tenantId, eq(previewSessions.executionId, executionId)))
    .limit(1);
  return row ? { ...row, status: row.status as PreviewSessionStatus } : null;
}

/**
 * The live preview lease for a PROJECT, if it has one — what the Mobile panel mints
 * against (it knows the project, never the execution). Only a lease that is still
 * holding an instance qualifies; an evicted one is not a preview a phone can load.
 */
export async function loadProjectPreviewSession(
  db: Db, tenantId: number, projectId: number,
): Promise<PreviewSessionRow | null> {
  const [row] = await db
    .select({
      executionId: previewSessions.executionId,
      projectId: previewSessions.projectId,
      port: previewSessions.port,
      status: previewSessions.status,
      detail: previewSessions.detail,
      lastSeenAt: previewSessions.lastSeenAt,
    })
    .from(previewSessions)
    .where(scopedToTenant(
      previewSessions, tenantId,
      eq(previewSessions.projectId, projectId),
      inArray(previewSessions.status, [...HOLDING_STATUSES]),
    ))
    .orderBy(sql`${previewSessions.lastSeenAt} desc`)
    .limit(1);
  return row ? { ...row, status: row.status as PreviewSessionStatus } : null;
}

/**
 * Open (or re-arm) the lease for a run's preview. Capacity is checked by the CALLER
 * (so a refusal can be answered with the right HTTP status); this is the write.
 * Idempotent on `execution_id` — one execution can only ever hold one instance.
 */
export async function openPreviewSession(
  db: Db,
  input: { tenantId: number; executionId: number; projectId: number | null; port: number },
): Promise<void> {
  await db.insert(previewSessions).values({
    tenantId: input.tenantId,
    executionId: input.executionId,
    projectId: input.projectId,
    port: input.port,
    status: 'starting',
  }).onConflictDoUpdate({
    target: previewSessions.executionId,
    set: {
      status: 'starting', detail: null, port: input.port, projectId: input.projectId,
      startedAt: new Date(), lastSeenAt: new Date(), stoppedAt: null, updatedAt: new Date(),
    },
  });
}

/** Move a lease to a terminal or live state. */
export async function setPreviewSessionStatus(
  db: Db, tenantId: number, executionId: number, status: PreviewSessionStatus, detail?: string | null,
): Promise<void> {
  const terminal = status === 'failed' || status === 'idle_evicted' || status === 'stopped';
  await db.update(previewSessions)
    .set({
      status,
      detail: detail ?? null,
      updatedAt: new Date(),
      ...(terminal ? { stoppedAt: new Date() } : { lastSeenAt: new Date() }),
    })
    .where(scopedToTenant(previewSessions, tenantId, eq(previewSessions.executionId, executionId)));
}

/**
 * Bump `last_seen_at` for a preview being actively fetched. Called from the INGRESS,
 * which authenticates with a preview token and therefore knows the execution but not
 * the tenant — the token is the access predicate, which is exactly what `share_token`
 * declares. Throttled to one write per {@link PREVIEW_TOUCH_THROTTLE_SECONDS} through
 * the shared read-through cache, and never allowed to fail a preview request.
 */
export async function touchPreviewSession(env: Env, executionId: number): Promise<void> {
  try {
    await getOrSetCached(
      env,
      `preview:touch:${executionId}`,
      async () => {
        const db = buildDatabase(env);
        await db.update(previewSessions)
          .set({ lastSeenAt: new Date(), updatedAt: new Date() })
          .where(acrossTenants(previewSessions, 'share_token', eq(previewSessions.executionId, executionId)));
        return Date.now();
      },
      { kvTtlSeconds: PREVIEW_TOUCH_THROTTLE_SECONDS, l1TtlMs: PREVIEW_TOUCH_THROTTLE_SECONDS * 1000 },
    );
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/previewSessions.ts', operation: 'touchPreviewSession',
      context: { logMessage: '[preview] lease touch failed', details: { executionId } },
    }, { env });
  }
}

/** The DO control path that stops a container holding only a preview. Handled by
 *  `AgentContainerDO.fetch` BEFORE the container proxy, so it never reaches the image. */
export const PREVIEW_CONTROL_STOP_PATH = '/__preview_control__/stop';

/** Ask the run's container DO to stop — the instance is the thing we are reclaiming. */
async function stopPreviewContainer(env: Env, executionId: number): Promise<void> {
  if (!env.AGENT_CONTAINER) return;
  const stub = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(`exec:${executionId}`));
  await stub.fetch(new Request(`https://agent-container${PREVIEW_CONTROL_STOP_PATH}`, { method: 'POST' }));
}

/**
 * Evict previews nobody is watching.
 *
 * ── THE ONE THING THIS MUST NOT DO ─────────────────────────────────────────────────
 * A run and its preview share ONE container instance (`exec:<id>`), so stopping the
 * container to reclaim an idle preview would kill a working agent mid-build. Eviction
 * therefore only touches a lease whose RUN has already finished — the case where the
 * instance is being held open by the preview and nothing else. While the run is still
 * going the instance is the RUN's cost, governed by the DO's own `sleepAfter`, and the
 * lease keeps its budget slot because the instance genuinely exists.
 *
 * Returns what it reclaimed so the cron summary is honest.
 */
export async function sweepIdlePreviews(env: Env): Promise<{ evicted: number }> {
  const db = buildDatabase(env);
  const cutoff = new Date(Date.now() - PREVIEW_IDLE_EVICTION_MS);
  const stale = await db
    .select({
      tenantId: previewSessions.tenantId,
      executionId: previewSessions.executionId,
      runStatus: executions.status,
    })
    .from(previewSessions)
    .innerJoin(executions, eq(executions.id, previewSessions.executionId))
    // A sweep runs for the whole deployment; the access predicate is "holding an
    // instance AND unwatched past the policy", which is the sweep's entire mandate.
    .where(acrossTenants(
      previewSessions, 'scheduled_sweep',
      inArray(previewSessions.status, [...HOLDING_STATUSES]),
      lt(previewSessions.lastSeenAt, cutoff),
    ))
    .limit(50);

  let evicted = 0;
  for (const row of stale) {
    if (!isTerminalExecutionStatus(row.runStatus)) continue; // the RUN owns this instance
    try {
      await stopPreviewContainer(env, row.executionId);
    } catch (error) {
      // A container that has already died is still an eviction — record it either way,
      // or the row stays "live" forever and permanently consumes budget.
      reportCaughtError(error, {
        source: 'application/runtime/previewSessions.ts', operation: 'sweepIdlePreviews',
        context: { logMessage: '[preview] container stop failed', details: { executionId: row.executionId } },
      }, { env });
    }
    await setPreviewSessionStatus(
      db, row.tenantId, row.executionId, 'idle_evicted',
      `No preview traffic for ${Math.round(PREVIEW_IDLE_EVICTION_MS / 1000)}s.`,
    );
    evicted++;
  }
  return { evicted };
}

/** The project a run belongs to — needed to denormalise `project_id` onto the lease. */
export async function projectIdForExecution(db: Db, tenantId: number, executionId: number): Promise<number | null> {
  const [row] = await db
    .select({ projectId: tasks.projectId })
    .from(executions)
    .innerJoin(tasks, eq(tasks.id, executions.taskId))
    .where(scopedToTenant(executions, tenantId, eq(executions.id, executionId)))
    .limit(1);
  return row?.projectId ?? null;
}
