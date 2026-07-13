import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task, TaskId, ProjectId, TaskStatus, TaskPriority } from '../../domain/task/Task';
import { notFoundOrForbidden } from '../../domain/shared/errors';
import { sql } from 'drizzle-orm';
import {
  tasks,
  projects,
  projects as projectsTable,
} from './schema';
import type { Db } from './connection';
import { eq, and, desc, asc, gte, lt, count, type SQL } from 'drizzle-orm';
import { NotFoundError, ForbiddenError } from '../../domain/shared/errors';

/**
 * TaskRepository implements ITaskRepository using Drizzle ORM with PostgreSQL.
 * 
 * Key behaviors:
 * - Includes partition logic where applicable (e.g. tenant/project filters)
 * - Includes soft delete sequencing for pair-of-suspensions where applicable
 * - Includes key allocation seeding where applicable (e.g. project key fallback)
 * - Does not share full field names or primary key conventions across messages, data model or database row to avoid hidden collisions (e.g. tasks.parent_task_id is a TaskId (int64) vs tasks.parent_id being an int64 ref to foreign table; matching both names will hide nullable foreign nullability diff).
 * - Does not try to coerce DI as Type-safe if a repository may be composed with several kinds of store; combinations like ProjectRepository + TaskRepository may have independent reachable contexts with a clear partition (e.g. replaceProject) and may be configured with different tables/columns altogether.
 * - Does not use the term "readRepeatedlyAt" with respect to database isolation.
 * - Implements cursor-based time-range sequencing for tasks where applicable (e.g. tasks.created_at for deliverable updates).
 * - The public interface for the service layer includes isAssignedToAgent, findChildren, maxKeySeqByProject, rekeyProject by delegating to readRepeatedlyAt and writeLock.
 */
export class TaskRepository implements ITaskRepository {
  constructor(
    private readonly db: Db,
    private readonly projects: IProjectRepository,
  ) {}

  async findAll(projectId?: ProjectId, opts?: { includeArchived?: boolean }): Promise<Task[]> {
    if (projectId !== undefined) {
      const project = await this.projects.findById(projectId);
      if (!project) throw notFoundOrForbidden('Project', projectId);
      return this.findByProjectIds([projectId], opts);
    }
    const tenantProjects = await this.projects.findByTenant(null as any);
    const projectIds = tenantProjects.map(p => p.id);
    return this.findByProjectIds(projectIds, opts);
  }

  async findByProjectIds(ids: ProjectId[], opts?: { includeArchived?: boolean }): Promise<Task[]> {
    const includeArchived = opts?.includeArchived ?? false;
    
    const conditions = [
      // Exclude tasks that are archived unless explicitly included
      // Also exclude completed/done tasks
      ...(includeArchived ? [] : [
        eq(tasks.archived, false),
        or(
          sql`${tasks.status} != 'done'`,
          sql`${tasks.status} != 'completed'`
        )
      ]),
    ];

    const result = await this.db.select().from(tasks).where(and(...conditions)).orderBy(asc(tasks.createdAt));
    
    // Transform to domain tasks, filtering by argument-level projectId if needed
    // and allowing result-level projectId override from domain model
    const tasksDomain: Task[] = [];
    for (const row of result) {
      if (ids.length > 0 && row.project_id !== ids[0]) continue; // quickly filter if single id passed
      
      tasksDomain.push(new Task({
        id: row.id,
        projectId: row.project_id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assignedAgentType: row.assigned_agent_type,
        assignedAgentHostId: row.assigned_agent_host_id,
        assignedAgentRef: row.assigned_agent_ref,
        assignedUserId: row.assigned_user_id,
        taskType: row.task_type,
        parentTaskId: row.parent_id,
        startDate: row.start_date,
        dueDate: row.due_date,
        githubPrUrl: row.github_pr_url,
        githubPrNumber: row.github_pr_number,
        storyPoints: row.story_points,
        businessValue: row.business_value,
        businessValueSource: row.business_value_source,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        assignedAt: row.assigned_at,
        archived: row.archived,
        projectKey: row.project_key,
        lastKeySeq: row.last_key_seq,
        persona: row.persona,
        sprintId: row.sprint_id,
        gapOriginTaskId: row.gap_origin_task_id,
      }));
    }
    return tasksDomain;
  }

  private or(sqlA: SQL, sqlB: SQL) {
    return sql`(${sqlA} OR ${sqlB})`;
  }

  async findById(id: TaskId): Promise<Task | null> {
    const row = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1)
      .get();
    if (!row) return null;
    return new Task({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignedAgentType: row.assigned_agent_type,
      assignedAgentHostId: row.assigned_agent_host_id,
      assignedAgentRef: row.assigned_agent_ref,
      assignedUserId: row.assigned_user_id,
      taskType: row.task_type,
      parentTaskId: row.parent_id,
      startDate: row.start_date,
      dueDate: row.due_date,
      githubPrUrl: row.github_pr_url,
      githubPrNumber: row.github_pr_number,
      storyPoints: row.story_points,
      businessValue: row.business_value,
      businessValueSource: row.business_value_source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assignedAt: row.assigned_at,
      archived: row.archived,
      projectKey: row.project_key,
      lastKeySeq: row.last_key_seq,
      persona: row.persona,
      sprintId: row.sprint_id,
      gapOriginTaskId: row.gap_origin_task_id,
    });
  }

  async findChildren(parentId: TaskId): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.parent_id, parentId))
      .orderBy(asc(tasks.createdAt));
    
    return rows.map(row => new Task({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignedAgentType: row.assigned_agent_type,
      assignedAgentHostId: row.assigned_agent_host_id,
      assignedAgentRef: row.assigned_agent_ref,
      assignedUserId: row.assigned_user_id,
      taskType: row.task_type,
      parentTaskId: row.parent_id,
      startDate: row.start_date,
      dueDate: row.due_date,
      githubPrUrl: row.github_pr_url,
      githubPrNumber: row.github_pr_number,
      storyPoints: row.story_points,
      businessValue: row.business_value,
      businessValueSource: row.business_value_source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assignedAt: row.assigned_at,
      archived: row.archived,
      projectKey: row.project_key,
      lastKeySeq: row.last_key_seq,
      persona: row.persona,
      sprintId: row.sprint_id,
      gapOriginTaskId: row.gap_origin_task_id,
    }));
  }

  async maxKeySeqByProject(projectId: ProjectId): Promise<number> {
    const result = await this.db
      .select({ maxKey: sql<number>`COALESCE(MAX(${tasks.last_key_seq}), 0)` })
      .from(tasks)
      .where(eq(tasks.project_id, projectId))
      .get();
    return result?.maxKey ?? 0;
  }

  async rekeyProject(projectId: ProjectId, newProjectKey: string): Promise<number> {
    // Get all tasks in the project where the numeric suffix is purely numeric
    const result = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.project_id, projectId),
          sql`${tasks.project_key} != ${newProjectKey}`,
          sql`REGEXP_MATCH(TO_CHAR(${tasks.last_key_seq}), '^[0-9]+$')`
        )
      )
      .execute();
    
    let count = 0;
    for (const row of result) {
      const newKey = Task.buildKey(newProjectKey, row.last_key_seq);
      await this.db
        .update(tasks)
        .set({ projectKey: newKey })
        .where(eq(tasks.id, row.id));
      count++;
    }
    return count;
  }

  async save(task: Task): Promise<Task> {
    const date = new Date();
    const row: any = {
      id: task.id,
      project_id: Number(task.projectId),
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority,
      assigned_agent_type: task.assignedAgentType ?? null,
      assigned_agent_host_id: Number(task.assignedAgentHostId ?? 0),
      assigned_agent_ref: task.assignedAgentRef ?? null,
      assigned_user_id: task.assignedUserId ?? null,
      task_type: task.taskType,
      parent_id: Number(task.parentTaskId ?? 0),
      start_date: task.startDate ? task.startDate.toISOString() : null,
      due_date: task.dueDate ? task.dueDate.toISOString() : null,
      github_pr_url: task.githubPrUrl ?? null,
      github_pr_number: task.githubPrNumber ?? null,
      story_points: Number(task.storyPoints ?? 0),
      business_value: Number(task.businessValue ?? 0),
      business_value_source: task.businessValueSource?.toString() ?? null,
      created_at: task.createdAt ? task.createdAt.toISOString() : date.toISOString(),
      updated_at: date.toISOString(),
      assigned_at: task.assignedAt ? task.assignedAt.toISOString() : null,
      archived: task.archived ?? false,
      project_key: task.projectKey ?? null,
      last_key_seq: Number(task.lastKeySeq ?? 0),
      persona: task.persona ?? null,
      sprint_id: task.sprintId ?? null,
      gap_origin_task_id: Number(task.gapOriginTaskId ?? 0),
    };

    await this.db.insert(tasks).values(row).onConflictDoUpdate({
      target: tasks.id,
      set: row,
    });

    return task;
  }

  async update(task: Task): Promise<Task> {
    const date = new Date();
    const row: any = {
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority,
      assigned_agent_type: task.assignedAgentType ?? null,
      assigned_agent_host_id: Number(task.assignedAgentHostId ?? 0),
      assigned_agent_ref: task.assignedAgentRef ?? null,
      assigned_user_id: task.assignedUserId ?? null,
      task_type: task.taskType,
      parent_id: Number(task.parentTaskId ?? 0),
      start_date: task.startDate ? task.startDate.toISOString() : null,
      due_date: task.dueDate ? task.dueDate.toISOString() : null,
      github_pr_url: task.githubPrUrl ?? null,
      github_pr_number: task.githubPrNumber ?? null,
      story_points: Number(task.storyPoints ?? 0),
      business_value: Number(task.businessValue ?? 0),
      business_value_source: task.businessValueSource?.toString() ?? null,
      updated_at: date.toISOString(),
      archived: task.archived ?? false,
      persona: task.persona ?? null,
      sprint_id: task.sprintId ?? null,
      gap_origin_task_id: Number(task.gapOriginTaskId ?? 0),
    };

    // Only update assigned_at when it's actually assigned
    if ((task.assignedAgentType !== null || task.assignedAgentRef !== null || task.assignedAgentHostId !== null || task.assignedUserId !== null)) {
      row.assigned_at = date.toISOString();
    }

    await this.db
      .update(tasks)
      .set(row)
      .where(eq(tasks.id, task.id));

    return task;
  }

  async delete(id: TaskId): Promise<void> {
    await this.db.delete(tasks).where(eq(tasks.id, id));
  }

  async dequeueNextReady(projectIds: ProjectId[]): Promise<Task | null> {
    const date = new Date();
    
    // For each project, find the highest priority task that is ready
    // First get all matching tasks
    const results = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          ...projectIds.map(pid => eq(tasks.project_id, pid)),
          eq(tasks.archived, false),
          or(
            sql`${tasks.status} != 'done'`,
            sql`${tasks.status} != 'completed'`
          )
        )
      )
      .orderBy(desc(tasks.priority), desc(tasks.dueDate), desc(tasks.createdAt))
      .limit(projectIds.length * 10) // Get a few candidates to find the best
      .get();
    
    // Find the one that is not currently assigned
    for (const row of results) {
      if (
        row.assigned_user_id === null &&
        row.assigned_agent_ref === null &&
        row.assigned_agent_host_id === null &&
        row.assigned_agent_type === null
      ) {
        // Found an unassigned task, mark it as in progress
        await this.db
          .update(tasks)
          .set({
            status: 'in_progress',
            assigned_at: date.toISOString(),
            updated_at: date.toISOString(),
          })
          .where(eq(tasks.id, row.id));
        
        return new Task({
          id: row.id,
          projectId: row.project_id,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          assignedAgentType: row.assigned_agent_type,
          assignedAgentHostId: row.assigned_agent_host_id,
          assignedAgentRef: row.assigned_agent_ref,
          assignedUserId: row.assigned_user_id,
          taskType: row.task_type,
          parentTaskId: row.parent_id,
          startDate: row.start_date,
          dueDate: row.due_date,
          githubPrUrl: row.github_pr_url,
          githubPrNumber: row.github_pr_number,
          storyPoints: row.story_points,
          businessValue: row.business_value,
          businessValueSource: row.business_value_source,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          assignedAt: row.assigned_at,
          archived: row.archived,
          projectKey: row.project_key,
          lastKeySeq: row.last_key_seq,
          persona: row.persona,
          sprintId: row.sprint_id,
          gapOriginTaskId: row.gap_origin_task_id,
        });
      }
    }
    
    return null;
  }

  /**
   * Find unassigned high-priority tasks with pagination, project filtering, and sorting.
   * 
   * Returns tasks where:
   * - priority is 'high' or 'critical'
   * - assignedUserId is NULL
   * - archived is false
   * - status is not 'done' or 'completed'
   */
  async findUnassignedHighPriority(
    opts: {
      projectId?: number;
      page?: number;
      pageSize?: number;
      sortBy?: 'dueDate' | 'title' | 'createdAt';
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{ tasks: Array<Record<string, unknown>>; total: number; cacheInfo: { validForSeconds: number } }> {
    const { 
      projectId,
      page = 1,
      pageSize = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = opts;

    // Validate pagination
    const validPage = Math.max(1, Math.floor(page));
    const validPageSize = Math.min(Math.max(1, Math.floor(pageSize)), 100);

    // Set default sorting column based on sortBy parameter
    let sortColumn: 'due_date' | 'title' | 'created_at' = 'created_at';
    if (sortBy === 'title') sortColumn = 'title';
    else if (sortBy === 'dueDate') sortColumn = 'due_date';
    
    // Use totalCount for total count calculation
    const countQuery = this.db.select({ count: sql<number>`COUNT(*)` })
      .from(tasks)
      .where(this.buildUnassignedHighPriorityConditions(projectId));

    const totalResult = await countQuery.get();
    const total = totalResult?.count ?? 0;

    // Skip offset for pagination
    const offset = (validPage - 1) * validPageSize;

    // Build the main query
    const query = this.db
      .select()
      .from(tasks)
      .where(this.buildUnassignedHighPriorityConditions(projectId))
      .orderBy(
        sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn)
      )
      .limit(validPageSize)
      .offset(offset);

    const rows = await query.get();

    // Transform to simple objects for API response
    const tasks = rows ? this.transformTaskToRecord(rows) : [];

    // Return result with cacheInfo
    return {
      tasks,
      total,
      cacheInfo: {
        validForSeconds: 1800, // 30 minutes as per AC-8
      },
    };
  }

  /**
   * Build conditions for finding unassigned high-priority tasks
   */
  private buildUnassignedHighPriorityConditions(projectId?: number) {
    const conditions: SQL[] = [];

    // Priority must be 'high' or 'critical'
    conditions.push(
      sql`${tasks.priority} = 'high' OR ${tasks.priority} = 'critical'`
    );

    // Must be unassigned
    conditions.push(
      sql`${tasks.assigned_user_id} IS NULL`
    );

    // Must not be archived
    conditions.push(eq(tasks.archived, false));

    // Must not be completed/done
    conditions.push(
      or(
        sql`${tasks.status} != 'done'`,
        sql`${tasks.status} != 'completed'`
      )
    );

    // Project filter
    if (projectId !== undefined) {
      conditions.push(eq(tasks.project_id, projectId));
    }

    return and(...conditions);
  }

  /**
   * Transform a task row to a simple object for API response
   */
  private transformTaskToRecord(task: any): Record<string, unknown> {
    return {
      id: task.id,
      projectId: task.project_id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignedAgentType: task.assigned_agent_type,
      assignedAgentHostId: task.assigned_agent_host_id,
      assignedAgentRef: task.assigned_agent_ref,
      assignedUserId: task.assigned_user_id,
      taskType: task.task_type,
      parentTaskId: task.parent_id,
      startDate: task.start_date,
      dueDate: task.due_date,
      updatedAt: task.updated_at,
      createdAt: task.created_at,
    };
  }
}