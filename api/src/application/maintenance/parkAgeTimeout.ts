/**
 * Park-age timeout sweep — the fallback edge for tickets parked on a spawned
 * `run_workflow` lane action (lifecycle 'awaiting_workflow', migration 0171).
 *
 * {@link runParkedWorkflowSweep} resumes a parked ticket only when its awaited
 * workflow reaches a TERMINAL status. If that workflow is dropped, never reports,
 * or its row is gone, the ticket waits in 'awaiting_workflow' forever — a
 * permanently-stuck lane ticket with no human signal. There is no heartbeat on
 * the park itself, so this is the bound: any ticket parked longer than
 * PARK_AGE_TIMEOUT_MS is unparked to 'needs_attention' (the same terminal a
 * failed workflow yields), so a human picks it up.
 *
 * The park-age clock is `ticket_runs.updated_at`: it is bumped on the park
 * transition and on nothing else while parked, so "now − updated_at" is the park
 * age. Run from the frequent scheduled() tick alongside resumeParkedWorkflows;
 * idempotent (only touches rows past the deadline) and cheap on an idle tick.
 *
 * Threshold is env-tunable via PARK_AGE_TIMEOUT_MS (default 6h). Each unpark
 * writes a `swimlane_transitions` audit row (reason 'failed', detail naming the
 * timeout) so the move is visible on the ticket timeline, not silent.
 */

import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { ticketRuns, swimlaneTransitions } from '../../infrastructure/database/schema';

/** Default park-age cap before a stuck `awaiting_workflow` ticket is surfaced. */
export const DEFAULT_PARK_AGE_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6h

/** Env reads it tolerates without depending on env.ts carrying the field. */
type ParkAgeEnv = {
  NEON_DATABASE_URL: string;
  /** Override the park-age cap (ms). Sub-1 / non-numeric falls back to default. */
  PARK_AGE_TIMEOUT_MS?: string | number;
};

export interface ParkAgeTimeoutResult {
  /** Stale parked tickets found past the deadline. */
  stale: number;
  /** Tickets actually moved to needs_attention this sweep. */
  unparked: number;
}

/** Resolve the configured park-age cap, falling back to the default. */
export function resolveParkAgeTimeoutMs(env: ParkAgeEnv): number {
  const raw = env.PARK_AGE_TIMEOUT_MS;
  const n = typeof raw === 'number' ? raw : raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PARK_AGE_TIMEOUT_MS;
}

/**
 * Surface every ticket parked on `awaiting_workflow` past the park-age cap by
 * routing it to 'needs_attention' and clearing the dangling awaited-workflow ref.
 * `now` is injectable for tests; defaults to the cron's wall clock.
 */
export async function runParkAgeTimeoutSweep(
  env: ParkAgeEnv,
  now: number = Date.now(),
): Promise<ParkAgeTimeoutResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);
  const timeoutMs = resolveParkAgeTimeoutMs(env);
  const cutoff = new Date(now - timeoutMs);

  // Stale parked tickets: lifecycle still 'awaiting_workflow', an awaited
  // workflow ref present, and parked (updated_at) before the cutoff.
  const stale = await db
    .select({
      id: ticketRuns.id,
      tenantId: ticketRuns.tenantId,
      currentSwimlaneId: ticketRuns.currentSwimlaneId,
      awaitingWorkflowId: ticketRuns.awaitingWorkflowId,
    })
    .from(ticketRuns)
    .where(
      and(
        eq(ticketRuns.lifecycle, 'awaiting_workflow'),
        isNotNull(ticketRuns.awaitingWorkflowId),
        lt(ticketRuns.updatedAt, cutoff),
      ),
    );

  const result: ParkAgeTimeoutResult = { stale: stale.length, unparked: 0 };
  if (stale.length === 0) return result;

  const detail = `Park-age timeout: parked on run_workflow > ${Math.round(timeoutMs / 60000)}m without the workflow settling; surfaced for review.`;

  for (const row of stale) {
    try {
      // Flip to needs_attention and drop the dangling awaited-workflow ref so the
      // resume sweep can't later double-resume it. Guard the WHERE on the parked
      // state so a concurrent settle (resumeParkedWorkflows) wins instead of us.
      const updated = await db
        .update(ticketRuns)
        .set({
          lifecycle: 'needs_attention',
          awaitingWorkflowId: null,
          error: detail,
          updatedAt: new Date(now),
        })
        .where(and(eq(ticketRuns.id, row.id), eq(ticketRuns.lifecycle, 'awaiting_workflow')))
        .returning({ id: ticketRuns.id });

      if (updated.length === 0) continue; // raced — settled or unparked elsewhere

      // Timeline signal so the unpark is visible on the ticket, not silent.
      await db.insert(swimlaneTransitions).values({
        tenantId: row.tenantId,
        ticketRunId: row.id,
        fromSwimlaneId: row.currentSwimlaneId,
        toSwimlaneId: row.currentSwimlaneId,
        reason: 'failed',
        workflowStatus: null,
        detail,
        at: new Date(now),
      });

      result.unparked++;
    } catch (e) {
      console.error(`[cron:park-age] unpark of ticket_run ${row.id} failed`, e);
    }
  }

  console.log(`[cron:park-age] stale=${result.stale} unparked=${result.unparked} timeoutMs=${timeoutMs}`);
  return result;
}
