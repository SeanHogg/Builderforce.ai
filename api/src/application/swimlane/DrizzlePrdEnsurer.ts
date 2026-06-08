/**
 * Drizzle-backed {@link TaskPrdEnsurer} — the swimlane auto-PRD gate. When a task
 * with no PRD enters its first agent stage, this drafts one (from task + project
 * context), persists it at project level, and links it to the task as primary,
 * via the shared {@link ensureTaskPrdRecord} core. Idempotent and best-effort.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projects, tasks } from '../../infrastructure/database/schema';
import { ensureTaskPrdRecord } from '../prd/taskPrd';
import type { TaskPrdEnsurer } from './SwimlaneCoordinator';

export class DrizzlePrdEnsurer implements TaskPrdEnsurer {
  constructor(private readonly db: Db, private readonly env: Env) {}

  async ensureTaskPrd(taskId: number, tenantId: number): Promise<void> {
    const [task] = await this.db
      .select({ projectId: tasks.projectId, title: tasks.title, description: tasks.description })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)));
    if (!task) return;

    await ensureTaskPrdRecord(this.db, this.env, {
      taskId,
      tenantId,
      projectId: task.projectId,
      title: task.title,
      description: task.description ?? null,
      agentLabel: 'Product Manager',
    });
  }
}
