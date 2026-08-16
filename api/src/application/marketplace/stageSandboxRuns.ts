/**
 * THE STAGE SANDBOX RUN LIFECYCLE — the only module that writes
 * `stage_sandbox_runs`.
 *
 * A run moves `queued → running → passed|failed|error` (or `capped`, written
 * once and never advanced — a cap refusal never reaches the container). Every
 * write here is scoped to `tenant_id`, including the two the CONTAINER makes:
 * its bearer token carries `tid`, and the routes that call
 * {@link claimStageSandboxRun}/{@link completeStageSandboxRun} pass it through
 * rather than trusting a tenant id in the request body.
 */

import { and, desc, eq, lt } from 'drizzle-orm';
import { snapshots, stageSandboxRuns } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { ListingHarness, StageCheck } from '@builderforce/creation-canvas-contract';
import type { StageSandboxState, StageSandboxStatus } from './stageSandboxChecks';
import { dispatchStageSandbox } from './dispatchStageSandbox';
import { enforceStageSandboxCap } from './stageSandboxLedger';

/** A run still `running` after this long is presumed dead — the container
 *  crashed without reporting, or the DO binding silently dropped the request.
 *  Chosen well above the container's own MAX_RUN_MS wall-clock cap so a run
 *  that is genuinely still executing is never reaped out from under it. */
const STALE_RUNNING_MS = 5 * 60_000;

type RunRow = typeof stageSandboxRuns.$inferSelect;

function toState(row: RunRow, lastVerifiedAt: string | null): StageSandboxState {
  const stale = row.status === 'running' && Date.now() - row.updatedAt.getTime() > STALE_RUNNING_MS;
  const status: StageSandboxStatus = stale ? 'error' : (row.status as StageSandboxStatus);
  return {
    status,
    runId: row.id,
    findings: (row.findings as StageCheck[] | null) ?? [],
    summary: row.summary,
    errorMessage: stale ? 'The sandbox did not report back in time.' : row.errorMessage,
    lastVerifiedAt,
  };
}

/**
 * Resolve the sandbox state for a payload hash — the one read both the panel
 * (via `stagedView`) and the publish gate use. Not sandbox-applicable harnesses
 * return `not_applicable` without touching the table at all.
 *
 * `lastVerifiedAt` is read from the newest TERMINAL run for the same
 * `snapshotId` regardless of hash, so a `missing` verdict can say "edited since
 * last verified" — wording only, never severity.
 */
export async function resolveStageSandboxState(
  db: Db,
  input: { tenantId: number; snapshotId: string; harness: ListingHarness; payloadHash: string; sandboxApplicable: boolean },
): Promise<StageSandboxState | null> {
  if (!input.sandboxApplicable) return null;

  const [current] = await db
    .select()
    .from(stageSandboxRuns)
    .where(and(
      eq(stageSandboxRuns.tenantId, input.tenantId),
      eq(stageSandboxRuns.payloadHash, input.payloadHash),
    ))
    .orderBy(desc(stageSandboxRuns.createdAt))
    .limit(1);

  if (current) {
    const lastVerifiedAt = current.finishedAt?.toISOString() ?? null;
    return toState(current, lastVerifiedAt);
  }

  const [previous] = await db
    .select({ finishedAt: stageSandboxRuns.finishedAt, status: stageSandboxRuns.status })
    .from(stageSandboxRuns)
    .where(and(
      eq(stageSandboxRuns.tenantId, input.tenantId),
      eq(stageSandboxRuns.snapshotId, input.snapshotId),
      eq(stageSandboxRuns.status, 'passed'),
    ))
    .orderBy(desc(stageSandboxRuns.createdAt))
    .limit(1);

  return {
    status: 'missing',
    runId: null,
    findings: [],
    summary: null,
    errorMessage: null,
    lastVerifiedAt: previous?.finishedAt?.toISOString() ?? null,
  };
}

/** Expected loser of two near-simultaneous Stage presses racing to insert the
 *  same in-flight row. Mirrors `isCreationEventWriteConflict`'s reading. */
function isUniqueViolation(error: unknown): boolean {
  const detail = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : null;
  const text = [detail?.message, error instanceof Error ? error.message : String(error)]
    .filter((v): v is string => typeof v === 'string').join(' ');
  return detail?.code === '23505' || /duplicate key|unique constraint/i.test(text);
}

/**
 * Ensure a sandbox run exists for this payload hash — dispatching a new one,
 * reusing an in-flight or already-clean one, or recording a cap refusal.
 * Called once per Stage press, from the ROUTE layer via `waitUntil` so Stage
 * itself stays a sub-second request; the container reports back asynchronously.
 */
export async function ensureStageSandboxRun(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    userId: string;
    projectId?: number | null;
    snapshotId: string;
    listingId: string | null;
    harness: ListingHarness;
    payloadHash: string;
  },
): Promise<void> {
  const [existing] = await db
    .select({ id: stageSandboxRuns.id, status: stageSandboxRuns.status })
    .from(stageSandboxRuns)
    .where(and(
      eq(stageSandboxRuns.tenantId, input.tenantId),
      eq(stageSandboxRuns.payloadHash, input.payloadHash),
    ))
    .orderBy(desc(stageSandboxRuns.createdAt))
    .limit(1);
  // Already in flight, or already clean for this EXACT build — never re-dispatch.
  if (existing && (existing.status === 'queued' || existing.status === 'running' || existing.status === 'passed')) return;

  const cap = await enforceStageSandboxCap(db, input.tenantId, env);
  if (!cap.allowed) {
    await db.insert(stageSandboxRuns).values({
      tenantId: input.tenantId,
      snapshotId: input.snapshotId,
      listingId: input.listingId,
      payloadHash: input.payloadHash,
      harness: input.harness,
      status: 'capped',
      createdBy: input.userId,
      finishedAt: new Date(),
    });
    return;
  }

  let runId: string;
  try {
    const [row] = await db.insert(stageSandboxRuns).values({
      tenantId: input.tenantId,
      snapshotId: input.snapshotId,
      listingId: input.listingId,
      payloadHash: input.payloadHash,
      harness: input.harness,
      status: 'queued',
      createdBy: input.userId,
    }).returning({ id: stageSandboxRuns.id });
    if (!row) return;
    runId = row.id;
  } catch (error) {
    // Lost the race to insert the in-flight row — someone else's dispatch
    // already owns this build. Nothing further to do.
    if (isUniqueViolation(error)) return;
    throw error;
  }

  const dispatched = await dispatchStageSandbox(env, {
    runId, tenantId: input.tenantId, projectId: input.projectId ?? null,
  });
  if (!dispatched) {
    // Binding not provisioned (no Containers-enabled deploy, local dev) — fail
    // OPEN exactly like `dispatchQaRunner`: every existing environment behaves
    // unchanged, and the publish gate reads this as `sandbox.unavailable` (warn).
    await db.update(stageSandboxRuns)
      .set({ status: 'error', errorMessage: 'Sandbox runner not provisioned', finishedAt: new Date(), updatedAt: new Date() })
      .where(scopedToTenant(stageSandboxRuns, input.tenantId, eq(stageSandboxRuns.id, runId)));
  }
}

/**
 * The container's claim — flips `queued → running`. Conditional on the CURRENT
 * status so a duplicate/retried claim (a DO retry, a slow network) is a no-op
 * rather than a second concurrent driver of the same build.
 */
export async function claimStageSandboxRun(
  db: Db,
  input: { runId: string; tenantId: number },
): Promise<{ snapshotId: string; harness: ListingHarness } | null> {
  const [row] = await db
    .update(stageSandboxRuns)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(stageSandboxRuns.id, input.runId),
      eq(stageSandboxRuns.tenantId, input.tenantId),
      eq(stageSandboxRuns.status, 'queued'),
    ))
    .returning({ snapshotId: stageSandboxRuns.snapshotId, harness: stageSandboxRuns.harness });
  return row ? { snapshotId: row.snapshotId, harness: row.harness as ListingHarness } : null;
}

/**
 * Claim a run AND hand back the exact payload objects a buyer would receive —
 * the one assembly the container's claim response needs. Kept in the
 * application layer (not the route) so the route never queries `snapshots`
 * directly; a presentation handler takes an application port, never a table.
 */
export async function claimStageSandboxRunBundle(
  db: Db,
  input: { runId: string; tenantId: number },
): Promise<{ harness: ListingHarness; objects: unknown } | null> {
  const claimed = await claimStageSandboxRun(db, input);
  if (!claimed) return null;

  const [row] = await db
    .select({ payload: snapshots.payload })
    .from(snapshots)
    .where(scopedToTenant(snapshots, input.tenantId, eq(snapshots.id, claimed.snapshotId)))
    .limit(1);
  const objects = (row?.payload as { objects?: unknown } | null)?.objects ?? [];
  return { harness: claimed.harness, objects };
}

/** The container's result report — the only writer of `passed`/`failed`/`error`. */
export async function completeStageSandboxRun(
  db: Db,
  input: {
    runId: string;
    tenantId: number;
    status: 'passed' | 'failed' | 'error';
    findings?: StageCheck[];
    summary?: string | null;
    errorMessage?: string | null;
    durationMs?: number | null;
  },
): Promise<boolean> {
  const [row] = await db
    .update(stageSandboxRuns)
    .set({
      status: input.status,
      findings: input.findings ?? null,
      summary: input.summary ?? null,
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs ?? null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(stageSandboxRuns.id, input.runId),
      eq(stageSandboxRuns.tenantId, input.tenantId),
    ))
    .returning({ id: stageSandboxRuns.id });
  return !!row;
}

/**
 * Housekeeping only — never called from the request path. Exported for a
 * future cron sweep; the lazy reap in {@link resolveStageSandboxState} is what
 * actually protects a caller from reading a dead `running` row today.
 *
 * Genuinely cross-tenant: a sweep has no caller and therefore no tenant to
 * filter by — it is the platform reaping every tenant's stale rows on its own
 * schedule, which is what a sweep is. `acrossTenants('scheduled_sweep', ...)`
 * declares that rather than silently dropping the tenant predicate.
 */
export async function reapStaleStageSandboxRuns(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const rows = await db
    .update(stageSandboxRuns)
    .set({ status: 'error', errorMessage: 'The sandbox did not report back in time.', finishedAt: new Date(), updatedAt: new Date() })
    .where(acrossTenants(stageSandboxRuns, 'scheduled_sweep', eq(stageSandboxRuns.status, 'running'), lt(stageSandboxRuns.updatedAt, cutoff)))
    .returning({ id: stageSandboxRuns.id });
  return rows.length;
}
