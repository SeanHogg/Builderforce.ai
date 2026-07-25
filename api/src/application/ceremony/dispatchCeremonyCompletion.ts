/**
 * Server-side "dispatch agent work when a ceremony completes".
 *
 * This used to live in the browser (CeremonyStage.completeSession looped over the
 * client's loaded task list and POSTed raw executions, fire-and-forget). That made a core
 * automation depend on a tab staying open, silently swallowed failures, and only saw the
 * tasks the client happened to have fetched.
 *
 * Now it runs from `concludeCeremonySession`. Rather than submitting executions directly,
 * each candidate goes through the canonical `maybeAutoRunOnLaneEntry` gate — which already
 * applies the terminal/board/lane/gate resolution, the capability guardrail, the re-run
 * cooldown, the token gate and the live-run idempotency check. That last one subsumes the
 * client's hand-rolled `latestExecByTask` dedupe entirely.
 *
 * Lives in its own module (extracted from `runDueCeremonies`, 0365) because the conclude
 * path calls it and the sweep calls the conclude path — leaving it beside the sweep would
 * have made that a cycle.
 *
 * BOUNDED: at most MAX_DISPATCH_PER_CEREMONY runs per completed ceremony.
 */

import { and, asc, eq, isNotNull, ne, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks } from '../../infrastructure/database/schema';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { buildRuntimeService } from '../../buildRuntimeService';

/** Hard ceiling on agent runs kicked off by one completed ceremony. */
export const MAX_DISPATCH_PER_CEREMONY = 20;

export async function dispatchCeremonyCompletion(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; sessionId: string },
): Promise<{ candidates: number; dispatched: number }> {
  const runtimeService = buildRuntimeService(env, db);

  // Agent-OWNED, non-done tickets on this project — the same population the client loop
  // targeted ("humans keep their assignments; agents start running"). Filtering in SQL
  // keeps the number of gate evaluations (each of which reads) bounded.
  const candidates = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(
      // `tasks` has no tenant_id — it is tenant-scoped through its project, and the caller
      // has already verified this session (hence projectId) belongs to the tenant.
      and(
        eq(tasks.projectId, args.projectId),
        ne(tasks.status, 'done'),
        or(isNotNull(tasks.assignedAgentHostId), isNotNull(tasks.assignedAgentRef)),
      ),
    )
    .orderBy(asc(tasks.id))
    .limit(MAX_DISPATCH_PER_CEREMONY * 2);

  let dispatched = 0;
  for (const t of candidates) {
    if (dispatched >= MAX_DISPATCH_PER_CEREMONY) break;
    try {
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId: args.tenantId,
        projectId: args.projectId,
        taskId: t.id,
        status: t.status,
        submittedBy: `system:ceremony:${args.sessionId}`,
      });
      if (started) dispatched += 1;
    } catch (err) {
      console.error(`[ceremony:complete] dispatch failed task=${t.id}`, err);
    }
  }

  return { candidates: candidates.length, dispatched };
}
