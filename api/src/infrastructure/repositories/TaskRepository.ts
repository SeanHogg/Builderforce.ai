import { eq, count, inArray, and, sql, asc } from 'drizzle-orm';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { Task } from '../../domain/task/Task';
import {
  TaskId, ProjectId, TaskStatus, TaskPriority, AgentType,
  asTaskId, asProjectId, asClawId,
} from '../../domain/shared/types';
import { tasks as tasksTable } from '../database/schema';
import type { Db } from '../database/connection';

export class TaskRepository implements ITaskRepository {
  constructor(private readonly db: Db) {}

  async findAll(projectId?: ProjectId): Promise<Task[]> {
    const query = this.db.select().from(tasksTable);
    const rows = projectId !== undefined
      ? await query.where(eq(tasksTable.projectId, projectId))
      : await query;
    return rows.map(toDomain);
  }

  async findByProjectIds(ids: ProjectId[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(tasksTable)
      .where(inArray(tasksTable.projectId, ids));
    return rows.map(toDomain);
  }

  async findById(id: TaskId): Promise<Task | null> {
    const [row] = await this.db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async countByProject(projectId: ProjectId): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  async save(task: Task): Promise<Task> {
    const plain = task.toPlain();
    const [inserted] = await this.db
      .insert(tasksTable)
      .values({
        projectId:         plain.projectId,
        key:               plain.key,
        title:             plain.title,
        description:       plain.description ?? undefined,
        status:            plain.status,
        priority:          plain.priority,
        assignedAgentType: plain.assignedAgentType ?? undefined,
        assignedClawId: plain.assignedClawId ?? undefined,
        githubPrUrl:       plain.githubPrUrl ?? undefined,
        githubPrNumber:    plain.githubPrNumber ?? undefined,
        startDate:         plain.startDate ?? undefined,
        dueDate:           plain.dueDate ?? undefined,
        persona:           plain.persona ?? undefined,
        archived:          plain.archived,
      })
      .returning();
    if (!inserted) throw new Error('Insert returned no rows');
    return toDomain(inserted);
  }

  async update(task: Task): Promise<Task> {
    const plain = task.toPlain();
    const [updated] = await this.db
      .update(tasksTable)
      .set({
        title:             plain.title,
        description:       plain.description ?? undefined,
        status:            plain.status,
        priority:          plain.priority,
        assignedAgentType: plain.assignedAgentType ?? undefined,
        assignedClawId: plain.assignedClawId ?? undefined,
        githubPrUrl:       plain.githubPrUrl ?? undefined,
        githubPrNumber:    plain.githubPrNumber ?? undefined,
        startDate:         plain.startDate ?? undefined,
        dueDate:           plain.dueDate ?? undefined,
        persona:           plain.persona ?? undefined,
        archived:          plain.archived,
        updatedAt:         plain.updatedAt,
      })
      .where(eq(tasksTable.id, plain.id))
      .returning();
    if (!updated) throw new Error('Update returned no rows');
    return toDomain(updated);
  }

  async delete(id: TaskId): Promise<void> {
    await this.db.delete(tasksTable).where(eq(tasksTable.id, id));
  }

  async dequeueNextReady(projectIds: ProjectId[]): Promise<Task | null> {
    if (projectIds.length === 0) return null;
    return await this.db.transaction(async (tx) => {
      // Select one ready task from the allowed projects, ordering by priority,
      // due date (earliest first), then creation time.
      const [row] = await tx
        .select()
        .from(tasksTable)
        .where(
          and(
            inArray(tasksTable.projectId, projectIds),
            eq(tasksTable.status, TaskStatus.READY),
          ),
        )
        .orderBy(
          // custom priority ordering: urgent>high>medium>low
          // using raw SQL expression for the CASE
          sql`CASE ${tasksTable.priority}
                      WHEN 'urgent' THEN 4
                      WHEN 'high' THEN 3
                      WHEN 'medium' THEN 2
                      ELSE 1
                    END DESC`,
          sql`${tasksTable.dueDate} ASC NULLS LAST`,
          asc(tasksTable.createdAt),
        )
        .limit(1);
      if (!row) return null;
      // update status to in_progress and return updated row
      const [updated] = await tx
        .update(tasksTable)
        .set({ status: TaskStatus.IN_PROGRESS })
        .where(eq(tasksTable.id, row.id))
        .returning();
      return updated ? toDomain(updated) : toDomain(row);
    });
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

type Row = typeof tasksTable.$inferSelect;

function toDomain(row: Row): Task {
  return Task.reconstitute({
    id:                asTaskId(row.id),
    projectId:         asProjectId(row.projectId),
    key:               row.key,
    title:             row.title,
    description:       row.description ?? null,
    status:            row.status as TaskStatus,
    priority:          row.priority as TaskPriority,
    assignedAgentType: (row.assignedAgentType as AgentType) ?? null,
    assignedClawId: row.assignedClawId != null ? asClawId(row.assignedClawId) : null,
    githubPrUrl:       row.githubPrUrl ?? null,
    githubPrNumber:    row.githubPrNumber ?? null,
    startDate:         row.startDate ?? null,
    dueDate:           row.dueDate ?? null,
    persona:           row.persona ?? null,
    archived:          row.archived,
    createdAt:         row.createdAt,
    updatedAt:         row.updatedAt,
  });
}
