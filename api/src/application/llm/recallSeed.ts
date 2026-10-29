/**
 * Recall seed — Learned Model Routing (PRD 13 §6.6).
 *
 * Warms a browser's LOCAL SSM recall memory from the tenant's recently-scored
 * outcomes (task text + winning model + score), so an interactive run can compute a
 * recall bias on the client GPU. The heavy embed+kNN stays on the client; this is
 * just the seed feed behind `GET /llm/v1/recall-seed`. Tenant-scoped, read-through
 * cached. Carved out of `presentation/routes/llmRoutes.ts`.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { DbHandle } from '../shared/dbHandle';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { tasks, runModelOutcomes } from '../../infrastructure/database/schema';
import { codingEvidence } from '../shared/codingEvidence';

export function getRecallSeed(env: Env, db: DbHandle, tenantId: number, limit: number) {
  return getOrSetCached(
    env,
    `recallseed:${tenantId}:${limit}`,
    async () => {
      // Outcomes live on the run-telemetry database and tasks on core, so the task
      // text is read second, by id, and matched in memory.
      const rows = await runTelemetryDatabase(db)
        .select({
          executionId: runModelOutcomes.executionId,
          model: runModelOutcomes.resolvedModel,
          score: runModelOutcomes.score,
          taskId: runModelOutcomes.taskId,
        })
        .from(runModelOutcomes)
        // Only outcomes that teach: a telemetry-only report (a Creation Canvas run) seeds no recall.
        .where(and(eq(runModelOutcomes.tenantId, tenantId), codingEvidence))
        .orderBy(desc(runModelOutcomes.createdAt))
        .limit(limit);
      const taskIds = [...new Set(rows.flatMap((r) => (r.taskId == null ? [] : [r.taskId])))];
      const taskRows = taskIds.length === 0 ? [] : await db
        .select({ id: tasks.id, title: tasks.title, description: tasks.description })
        .from(tasks)
        .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.id, taskIds)));
      const taskById = new Map(taskRows.map((t) => [t.id, t]));
      return rows.flatMap((r) => {
        const task = r.taskId == null ? undefined : taskById.get(r.taskId);
        if (!r.model || r.model === 'unknown' || !task?.title) return [];
        return [{
          id: r.executionId,
          taskText: `${task.title}\n${task.description ?? ''}`.trim(),
          model: r.model,
          score: r.score,
        }];
      });
    },
    { kvTtlSeconds: 120, l1TtlMs: 30_000 },
  );
}
