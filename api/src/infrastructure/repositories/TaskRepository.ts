import { eq, inArray, and, sql, asc } from 'drizzle-orm';
import { ITaskRepository, TaskListOptions } from '../../domain/task/ITaskRepository';
import { Task } from '../../domain/task/Task';
import {
  TaskId, ProjectId, TaskStatus, TaskPriority, TaskType, AgentType,
  asTaskId, asProjectId, asAgentHostId,
} from '../../domain/shared/types';
import { tasks as tasksTable } from '../database/schema';
import type { Db } from '../database/connection';

export class TaskRepository implements ITaskRepository {
  constructor(private readonly db: Db) {}

  async findAll(projectId?: ProjectId, opts?: TaskListOptions): Promise<Task[]> {
    const notArchived = opts?.includeArchived ? undefined : eq(tasksTable.archived, false);
    const where = projectId !== undefined
      ? and(eq(tasksTable.projectId, projectId), notArchived)
      : notArchived;
    const query = this.db.select().from(tasksTable);
    const rows = where ? await query.where(where) : await query;
    return rows.map(toDomain);
  }

  async findByProjectIds(ids: ProjectId[], opts?: TaskListOptions): Promise<Task[]> {
    if (ids.length === 0) return [];
    const notArchived = opts?.includeArchived ? undefined : eq(tasksTable.archived, false);
    const rows = await this.db
      .select()
      .from(tasksTable)
      .where(and(inArray(tasksTable.projectId, ids), notArchived));
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

  async findChildren(parentId: TaskId): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, parentId))
      .orderBy(asc(tasksTable.createdAt));
    return rows.map(toDomain);
  }

  async maxKeySeqByProject(projectId: ProjectId): Promise<number> {
    // Highest numeric suffix among this project's keys (`${projectKey}-${NNN}`).
    // Strip everything up to the last '-' (so project keys may contain dashes),
    // and only count purely-numeric suffixes so any legacy/odd key is ignored.
    const [row] = await this.db
      .select({
        value: sql<number>`COALESCE(MAX(CASE WHEN regexp_replace(${tasksTable.key}, '^.*-', '') ~ '^[0-9]+$'
          THEN CAST(regexp_replace(${tasksTable.key}, '^.*-', '') AS INTEGER) END), 0)`,
      })
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
        taskType:          plain.taskType,
        parentTaskId:      plain.parentTaskId ?? undefined,
        assignedAgentType: plain.assignedAgentType ?? undefined,
        assignedAgentHostId: plain.assignedAgentHostId ?? undefined,
        assignedAgentRef:  plain.assignedAgentRef ?? undefined,
        assignedUserId:    plain.assignedUserId ?? undefined,
        gitBranch:         plain.gitBranch ?? undefined,
        explicitRepoId:    plain.explicitRepoId ?? undefined,
        sprintId:          plain.sprintId ?? undefined,
        releaseId:         plain.releaseId ?? undefined,
        storyPoints:       plain.storyPoints ?? undefined,
        businessValue:         plain.businessValue ?? undefined,
        businessValueRationale: plain.businessValueRationale ?? undefined,
        businessValueSource:   plain.businessValueSource ?? undefined,
        managerRank:           plain.managerRank ?? undefined,
        gapOriginTaskId:       plain.gapOriginTaskId ?? undefined,
        githubIssueNumber: plain.githubIssueNumber ?? undefined,
        githubIssueUrl:    plain.githubIssueUrl ?? undefined,
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
        projectId:         plain.projectId,
        key:               plain.key,
        title:             plain.title,
        description:       plain.description ?? undefined,
        status:            plain.status,
        priority:          plain.priority,
        taskType:          plain.taskType,
        // Authoritative (real null) so de-nesting a child (clearing its parent)
        // actually NULLs the column — Drizzle would omit `undefined` from SET.
        parentTaskId:      plain.parentTaskId ?? null,
        assignedAgentType: plain.assignedAgentType ?? undefined,
        // Assignee columns write real null (not undefined) so reassignment actually
        // CLEARS the other two — a task is owned by exactly one of host/cloud/human.
        // (Drizzle omits `undefined` from the SET clause, which would leave a stale
        //  assignee behind; only `null` nulls the column.)
        assignedAgentHostId: plain.assignedAgentHostId ?? null,
        assignedAgentRef:  plain.assignedAgentRef ?? null,
        assignedUserId:    plain.assignedUserId ?? null,
        gitBranch:         plain.gitBranch ?? undefined,
        // Authoritative (real null) so un-pinning the repo via the domain clears it.
        explicitRepoId:    plain.explicitRepoId ?? null,
        // Authoritative (real null) so un-scheduling (drag out of a sprint) clears it.
        sprintId:          plain.sprintId ?? null,
        // Authoritative (real null) so un-linking from a release clears it.
        releaseId:         plain.releaseId ?? null,
        // Authoritative (real null) so clearing the estimate persists.
        storyPoints:       plain.storyPoints ?? null,
        // AI Manager fields — authoritative so a manual clear/round-trip persists.
        businessValue:         plain.businessValue ?? null,
        businessValueRationale: plain.businessValueRationale ?? null,
        businessValueSource:   plain.businessValueSource ?? null,
        managerRank:           plain.managerRank ?? null,
        githubIssueNumber: plain.githubIssueNumber ?? undefined,
        githubIssueUrl:    plain.githubIssueUrl ?? undefined,
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
    // Atomically claim the next ready task in a SINGLE statement. The Neon HTTP
    // driver has no transaction support, so the old select-then-update inside a
    // tx threw "No transactions support in neon-http driver". An UPDATE whose
    // WHERE targets a `FOR UPDATE SKIP LOCKED` subquery does the select+claim in
    // one autocommit statement — and is strictly safer than the old tx: concurrent
    // dequeues skip each other's locked row instead of racing for the same one.
    const next = this.db
      .select({ id: tasksTable.id })
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
      .limit(1)
      .for('update', { skipLocked: true });

    const [updated] = await this.db
      .update(tasksTable)
      .set({ status: TaskStatus.IN_PROGRESS, updatedAt: new Date() })
      .where(inArray(tasksTable.id, next))
      .returning();
    return updated ? toDomain(updated) : null;
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
    status:            row.status,
    priority:          row.priority as TaskPriority,
    taskType:          (row.taskType as TaskType) ?? TaskType.TASK,
    parentTaskId:      row.parentTaskId != null ? asTaskId(row.parentTaskId) : null,
    assignedAgentType: (row.assignedAgentType as AgentType) ?? null,
    assignedAgentHostId: row.assignedAgentHostId != null ? asAgentHostId(row.assignedAgentHostId) : null,
    assignedAgentRef:  row.assignedAgentRef ?? null,
    assignedUserId:    row.assignedUserId ?? null,
    gitBranch:         row.gitBranch ?? null,
    explicitRepoId:    row.explicitRepoId ?? null,
    sprintId:          row.sprintId ?? null,
    releaseId:         row.releaseId ?? null,
    storyPoints:       row.storyPoints ?? null,
    businessValue:         row.businessValue ?? null,
    businessValueRationale: row.businessValueRationale ?? null,
    businessValueSource:   row.businessValueSource ?? null,
    managerRank:           row.managerRank ?? null,
    reviewCount:           row.reviewCount ?? 0,
    lastReviewedAt:        row.lastReviewedAt ?? null,
    lastReviewVerdict:     row.lastReviewVerdict ?? null,
    gapOriginTaskId:       row.gapOriginTaskId != null ? asTaskId(row.gapOriginTaskId) : null,
    githubIssueNumber: row.githubIssueNumber ?? null,
    githubIssueUrl:    row.githubIssueUrl ?? null,
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
