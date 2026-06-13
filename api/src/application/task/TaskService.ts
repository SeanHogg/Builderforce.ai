import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import {
  ProjectId, TaskId, TaskStatus, TaskPriority, TaskType, AgentType, TenantId,
  asProjectId, asTaskId, asTenantId, asAgentHostId,
} from '../../domain/shared/types';
import { NotFoundError, ForbiddenError } from '../../domain/shared/errors';
import {
  EpicDecomposer, ChildTaskPlan, heuristicEpicDecomposer,
} from './EpicDecomposer';

export interface CreateTaskDto {
  projectId: number;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedAgentType?: AgentType | null;
  assignedAgentHostId?: number | null;
  /** Cloud agent (ide_agents.id) assigned to this task. Mutually exclusive with host. */
  assignedAgentRef?: string | null;
  /** Human assignee (users.id). Mutually exclusive with the agent assignees. */
  assignedUserId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  persona?: string | null;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string | null;
  /** Free-form lane key (board column). See Task.status. */
  status?: string;
  priority?: TaskPriority;
  /** 'task' | 'epic'. Reclassifying to epic is normally done via decomposeEpic. */
  taskType?: TaskType;
  assignedAgentType?: AgentType | null;
  assignedAgentHostId?: number | null;
  /** Cloud agent (ide_agents.id) assigned to this task. Mutually exclusive with host. */
  assignedAgentRef?: string | null;
  /** Human assignee (users.id). Mutually exclusive with the agent assignees. */
  assignedUserId?: string | null;
  githubPrUrl?: string | null;
  githubPrNumber?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  persona?: string | null;
  archived?: boolean;
}

/**
 * Application service: orchestrates Task use cases.
 *
 * Depends on ITaskRepository and IProjectRepository interfaces only.
 */
export class TaskService {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly projects: IProjectRepository,
    /**
     * Agent reasoning step for on-assign Epic decomposition. Defaults to the
     * deterministic {@link heuristicEpicDecomposer}; inject an LLM-backed
     * implementation to get real BA-style scope assessment (the fan-out machinery
     * below is unchanged either way).
     */
    private readonly decomposer: EpicDecomposer = heuristicEpicDecomposer,
  ) {}

  /** List tasks scoped to the caller's tenant. Optionally narrow by project. */
  async listTasks(callerTenantId: number, projectId?: number): Promise<Task[]> {
    if (projectId !== undefined) {
      const project = await this.projects.findById(asProjectId(projectId));
      if (!project) throw new NotFoundError('Project', projectId);
      if (project.tenantId !== callerTenantId) throw new ForbiddenError('Project belongs to a different workspace');
      return this.tasks.findAll(asProjectId(projectId));
    }
    // No project filter: return tasks for ALL projects in this tenant
    const tenantProjects = await this.projects.findByTenant(asTenantId(callerTenantId));
    const projectIds = tenantProjects.map(p => asProjectId(p.id));
    return this.tasks.findByProjectIds(projectIds);
  }

  async getTask(id: number): Promise<Task> {
    const task = await this.tasks.findById(asTaskId(id));
    if (!task) throw new NotFoundError('Task', id);
    return task;
  }

  async createTask(dto: CreateTaskDto, callerTenantId: number): Promise<Task> {
    const project = await this.projects.findById(asProjectId(dto.projectId));
    if (!project) throw new NotFoundError('Project', dto.projectId);
    if (project.tenantId !== callerTenantId) throw new ForbiddenError('Project belongs to a different workspace');

    const taskCount = await this.tasks.countByProject(asProjectId(dto.projectId));

    const task = Task.create({
      projectId: asProjectId(dto.projectId),
      title: dto.title,
      description: dto.description ?? null,
      status: TaskStatus.BACKLOG,
      priority: dto.priority ?? TaskPriority.MEDIUM,
      assignedAgentType: dto.assignedAgentType ?? null,
      assignedAgentHostId: dto.assignedAgentHostId != null ? asAgentHostId(dto.assignedAgentHostId) : null,
      assignedAgentRef: dto.assignedAgentRef ?? null,
      assignedUserId: dto.assignedUserId ?? null,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      persona: dto.persona ?? null,
      projectKey: project.key,
      projectTaskCount: taskCount,
    });

    const saved = await this.tasks.save(task);
    // A task created already assigned to an agent goes through the same on-assign
    // assessment as one reassigned later (assess scope → maybe Epic → decompose).
    if (saved.isAssignedToAgent && saved.taskType === TaskType.TASK) {
      return this.onAssignedToAgent(saved);
    }
    return saved;
  }

  async updateTask(id: number, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.getTask(id);
    const wasAssignedToAgent = task.isAssignedToAgent;
    const updated = task.update({
      ...dto,
      assignedAgentHostId: dto.assignedAgentHostId !== undefined
        ? (dto.assignedAgentHostId != null ? asAgentHostId(dto.assignedAgentHostId) : null)
        : undefined,
      startDate: dto.startDate !== undefined ? (dto.startDate ? new Date(dto.startDate) : null) : undefined,
      dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
    });
    const saved = await this.tasks.update(updated);
    // On-assign hook: only when this update is what newly handed the task to an
    // agent (a transition into agent-ownership), and only for a plain `task`
    // (an Epic is already decomposed; never re-decompose).
    if (!wasAssignedToAgent && saved.isAssignedToAgent && saved.taskType === TaskType.TASK) {
      return this.onAssignedToAgent(saved);
    }
    return saved;
  }

  /**
   * Fires when a task transitions into AGENT ownership. The agent (a BA-style
   * planner) assesses scope: if the item is really an Epic, it is reclassified
   * and decomposed into child tasks that are fanned out to humans/agents. A
   * task the agent can execute directly is returned unchanged.
   *
   * The reasoning step is delegated to the injected {@link EpicDecomposer}
   * (deterministic by default; swap in an LLM); the reclassify + fan-out is the
   * production data-model path below.
   */
  private async onAssignedToAgent(task: Task): Promise<Task> {
    const plan = await this.decomposer.assess(task);
    if (!plan.isEpic || plan.children.length === 0) return task;
    return this.decomposeEpic(task.id as number, plan.children);
  }

  /**
   * Server action: turn a task into an Epic and fan its planned children out as
   * real child tasks (each linked back via parentTaskId). Reclassifying the Epic
   * also sheds its agent assignee — an Epic is a planning container, the children
   * carry the executable assignments. Returns the reclassified Epic.
   *
   * Exposed publicly so the decomposition can also be triggered explicitly (e.g.
   * a "Break into subtasks" board action) independent of the on-assign hook.
   */
  async decomposeEpic(id: number, children: ChildTaskPlan[]): Promise<Task> {
    const task = await this.getTask(id);
    const project = await this.projects.findById(task.projectId);
    if (!project) throw new NotFoundError('Project', task.projectId as number);

    const epic = await this.tasks.update(task.reclassifyAsEpic());

    // Key numbering is sequential off the live project count; create children one
    // at a time so each gets a distinct key (Task.create derives key from count+1).
    for (const child of children) {
      if (!child.title.trim()) continue;
      const count = await this.tasks.countByProject(task.projectId);
      const childTask = Task.create({
        projectId: task.projectId,
        title: child.title,
        description: child.description ?? null,
        status: TaskStatus.BACKLOG,
        priority: child.priority ?? TaskPriority.MEDIUM,
        taskType: TaskType.TASK,
        parentTaskId: epic.id,
        assignedAgentType: null,
        assignedAgentHostId: child.assignedAgentHostId != null ? asAgentHostId(child.assignedAgentHostId) : null,
        assignedAgentRef: child.assignedAgentRef ?? null,
        assignedUserId: child.assignedUserId ?? null,
        startDate: null,
        dueDate: null,
        persona: null,
        projectKey: project.key,
        projectTaskCount: count,
      });
      await this.tasks.save(childTask);
    }

    return epic;
  }

  /** Read the parent/child tree for an Epic (the Epic + its direct children). */
  async getEpicTree(id: number): Promise<{ epic: Task; children: Task[] }> {
    const epic = await this.getTask(id);
    const children = await this.tasks.findChildren(asTaskId(id));
    return { epic, children };
  }

  /**
   * Move a task to a different project ("board"). Validates that both the source
   * and destination projects belong to the caller's tenant, then re-keys the task
   * from the destination project's prefix (e.g. CODERCLAW-041 → ACME-014).
   */
  async moveTask(id: number, targetProjectId: number, callerTenantId: number): Promise<Task> {
    const task = await this.getTask(id);

    const source = await this.projects.findById(task.projectId);
    if (!source || source.tenantId !== callerTenantId) {
      throw new ForbiddenError('Task belongs to a different workspace');
    }

    if (task.projectId === asProjectId(targetProjectId)) return task; // no-op: already on this board

    const target = await this.projects.findById(asProjectId(targetProjectId));
    if (!target) throw new NotFoundError('Project', targetProjectId);
    if (target.tenantId !== callerTenantId) {
      throw new ForbiddenError('Project belongs to a different workspace');
    }

    const taskCount = await this.tasks.countByProject(asProjectId(targetProjectId));
    const key = `${target.key}-${String(taskCount + 1).padStart(3, '0')}`;
    const moved = task.moveToProject(asProjectId(targetProjectId), key);
    return this.tasks.update(moved);
  }

  async deleteTask(id: number): Promise<void> {
    await this.getTask(id);
    await this.tasks.delete(asTaskId(id));
  }

  /**
   * Fetch the next ready task for a given tenant, marking it in progress.
   * Selection is prioritized by task priority, due date, and creation time.
   */
  async dequeueNextReady(callerTenantId: number): Promise<Task | null> {
    // determine which projects belong to this tenant
    const tenantProjects = await this.projects.findByTenant(asTenantId(callerTenantId));
    const projectIds = tenantProjects.map(p => asProjectId(p.id));
    if (projectIds.length === 0) return null;
    return this.tasks.dequeueNextReady(projectIds);
  }
}
