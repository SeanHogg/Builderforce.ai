import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import {
  ProjectId, TaskId, TaskStatus, TaskPriority, AgentType, TenantId,
  asProjectId, asTaskId, asTenantId, asClawId,
} from '../../domain/shared/types';
import { NotFoundError, ForbiddenError } from '../../domain/shared/errors';

export interface CreateTaskDto {
  projectId: number;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedAgentType?: AgentType | null;
  assignedClawId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  persona?: string | null;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedAgentType?: AgentType | null;
  assignedClawId?: number | null;
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
      assignedClawId: dto.assignedClawId != null ? asClawId(dto.assignedClawId) : null,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      persona: dto.persona ?? null,
      projectKey: project.key,
      projectTaskCount: taskCount,
    });

    return this.tasks.save(task);
  }

  async updateTask(id: number, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.getTask(id);
    const updated = task.update({
      ...dto,
      assignedClawId: dto.assignedClawId !== undefined
        ? (dto.assignedClawId != null ? asClawId(dto.assignedClawId) : null)
        : undefined,
      startDate: dto.startDate !== undefined ? (dto.startDate ? new Date(dto.startDate) : null) : undefined,
      dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
    });
    return this.tasks.update(updated);
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
