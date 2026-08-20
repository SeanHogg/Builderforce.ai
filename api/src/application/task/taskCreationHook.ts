/**
 * The composition-root wiring for `TaskService`'s creation-attribution hook.
 *
 * `TaskService` lives in the application layer and must not reach into the activity
 * infrastructure itself, so it takes the emitter as an injected function. Every place
 * that constructs a `TaskService` needs the SAME function — and there are ten of them
 * (the HTTP root, the MCP tool service, the QA finding router, the Validator, the
 * Incident and Security services, the delta capture, the site-ticket bridge, the pause
 * path and the PMO conversion) — so the wiring lives here rather than being retyped at
 * each, which is exactly how the original single emitter came to cover only one writer.
 *
 * See `activity/taskCreated.ts` for the measurement that made this necessary: 722 of 821
 * tickets (88%) carried no creation row at all.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projects } from '../../infrastructure/database/schema';
import { eq } from 'drizzle-orm';
import { recordTaskCreated } from '../activity/taskCreated';
import type { CreationActor } from './TaskService';

/** The hook shape `TaskService` accepts as its last constructor argument. */
export type TaskCreatedHook = (info: {
  taskId: number; projectId: number; title: string; key: string | null;
  taskType: string; via: string; actor?: CreationActor;
}) => Promise<void>;

/**
 * Build the hook. Resolves the ticket's tenant from its project — the service knows the
 * project but not the tenant, and the activity row is tenant-scoped.
 *
 * Never throws: `recordTaskCreated` already swallows its own failures, and a missing
 * project simply means there is nothing to attribute.
 *
 * `env` is OPTIONAL because three of the constructing services (Incident, Validation,
 * Security audit) hold only a `Db` — `recordActivity` already tolerates its absence
 * (it only affects which connection the insert uses and the cache bump), and an
 * attributed row written on the plain connection is worth far more than no row.
 */
export function taskCreatedHook(db: Db, env?: Env): TaskCreatedHook {
  return async (info) => {
    const [project] = await db
      .select({ tenantId: projects.tenantId, segmentId: projects.segmentId })
      .from(projects)
      .where(eq(projects.id, info.projectId))
      .limit(1);
    if (!project) return;
    await recordTaskCreated(env, db, {
      tenantId: project.tenantId,
      segmentId: project.segmentId ?? null,
      taskId: info.taskId,
      projectId: info.projectId,
      title: info.title,
      key: info.key,
      via: info.via,
      metadata: { taskType: info.taskType },
      ...(info.actor ? { actor: info.actor } : {}),
    });
  };
}
