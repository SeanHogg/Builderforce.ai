import { eq } from 'drizzle-orm';
import { NotFoundError, ForbiddenError } from '../../domain/shared/errors';
import { Task, TaskProps, TaskType, TaskStatus } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  ProjectId,
  TaskId,
  ProjectStatus,
  AgentHostId,
  asProjectId,
  asTenantId,
  asTaskId,
  asAgentHostId,
} from '../../domain/shared/types';
import type { ITaskRepository, IProjectRepository } from '../../domain/task/ITaskRepository';
import type { IProjectRepository as IProjectRepo } from '../../domain/project/IProjectRepository';
import {
  TaskPriority,
  AgentType, // We keep AgentType exported for BC, though not used in current primitives.
} from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateTaskDto {
  projectId: number;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedAgentType?: AgentType | null;
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
  assignedUserId?: string | null;
  taskType?: TaskType;
  parentTaskId?: number | null;
  gapOriginTaskId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  persona?: string | null;
  sprintId?: string | null;
  releaseId?: string | null;
  storyPoints?: number | null;
  businessValue?: number | null;
  businessValueRationale?: string | null;
  businessValueSource?: string | null;
  managerRank?: number | null;
}

export interface UpdateTaskDto {
  projectId?: number; // Support scoped project move / rekey via explicit moveTask call
  title?: string | null;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  taskType?: TaskType;
  parentTaskId?: number | null;
  gapOriginTaskId?: number | null; // Added correctly
  sprintId?: string | null;
  releaseId?: string | null;
  storyPoints?: number | null;
  businessValue?: number | null;
  businessValueRationale?: string | null;
  businessValueSource?: string | null;
  managerRank?: number | null;
  assignedAgentType?: AgentType | null;
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
  assignedUserId?: string | null;
  githubPrUrl?: string | null;
  githubPrNumber?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  persona?: string | null;
  archived?: boolean;
}

// ---------------------------------------------------------------------------
// Repository Interfaces and Types
// ---------------------------------------------------------------------------

export interface ChildTaskPlan {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
  assignedUserId?: string | null;
  roleKey?: string | null;
  gapOriginTaskId?: number | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface TaskServiceDeps {
  projects: IProjectRepo;
  tasks: ITaskRepository;
  decomposer: EpicDecomposer;
  recommendChildAssignee?: (
    projectId: number,
    roleKey?: string
  ) => Promise<any>; // 'agent'/'human' ref pattern
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {
    this.projects = deps.projects;
    this.tasks = deps.tasks;
    this.decomposer = deps.decomposer;
    this.recommendChildAssignee = deps.recommendChildAssignee;
  }

  get projects(): IProjectRepo {
    return this.deps.projects;
  }

  get tasks(): ITaskRepository {
    return this.deps.tasks;
  }

  get decomposer(): EpicDecomposer {
    return this.deps.decomposer;
  }

  get recommendChildAssignee() {
    return this.deps.recommendChildAssignee;
  }

  // ---------------------------------------------------------------------------
  // Task Lifecycle
  // ---------------------------------------------------------------------------

  async getTask(id: TaskId): Promise<Task> {
    const t = await this.tasks.findById(id);
    if (!t) {
      throw new NotFoundError('Task', id);
    }
    return t;
  }

  async listTasks(
    projectId?: ProjectId,
    opts?: { includeArchived?: boolean }
  ): Promise<Task[]> {
    // Base mapping; callers may filter further (e.g., archived flag).
    if (projectId === undefined) {
      return this.tasks.findAll(undefined, opts);
    } else {
      return this.tasks.findByProjectIds(Array.of(projectId), opts);
    }
  }

  async moveTask(projectId: number, callerTenantId: TaskId): Promise<Task> {
    // Move goes via direct task update.
    const task = await this.getTask(projectId as any as TaskId);
    const wasAssignedToAgent = task.isAssignedToAgent;

    // Assume Move DTO:
    const updates: Partial<TaskProps> = {
      projectId: asProjectId(projectId),
    };

    // Keep pre-value checks consistent with updateTask: we only write defined fields.
    // This is a move, so we override projectId explicitly; other undefined fields are omitted (so they preserve).
    const updated = task.update(updates);
    const saved = await this.tasks.update(updated);
    // Move can erroneously start an auto-run; we suppress the on-assign hook because the assignment is never made.
    // For safety, we mean strictly to transition project membership, not ownership, which is controlled by other routes.
    return saved;
  }

  async createTask(dto: CreateTaskDto, callerTenantId: number): Promise<Task> {
    const project = await this.projects.findById(asProjectId(dto.projectId));
    if (!project) {
      throw new NotFoundError('Project', dto.projectId);
    }
    if (project.tenantId !== callerTenantId) {
      throw new ForbiddenError('Project belongs to a different workspace');
    }

    const saved = await this.withKeyAllocation(
      asProjectId(dto.projectId),
      (lastKeySeq) =>
        this.tasks.save(
          Task.create({
            projectId: asProjectId(dto.projectId),
            title: dto.title,
            description: dto.description ?? null,
            status: TaskStatus.BACKLOG,
            priority: dto.priority ?? TaskPriority.MEDIUM,
            assignedAgentType: dto.assignedAgentType ?? null,
            assignedAgentHostId:
              dto.assignedAgentHostId != null
                ? asAgentHostId(dto.assignedAgentHostId)
                : null,
            assignedAgentRef: dto.assignedAgentRef ?? null,
            assignedUserId: dto.assignedUserId ?? null,
            taskType: dto.taskType,
            parentTaskId:
              dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null,
            gapOriginTaskId:
              dto.gapOriginTaskId != null ? asTaskId(dto.gapOriginTaskId) : null,
            startDate: dto.startDate ? new Date(dto.startDate) : null,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            persona: dto.persona ?? null,
            sprintId: dto.sprintId ?? null,
            releaseId: dto.releaseId ?? null,
            storyPoints: dto.storyPoints ?? null,
            businessValue: dto.businessValue ?? null,
            businessValueRationale: dto.businessValueRationale ?? null,
            businessValueSource: dto.businessValueSource ?? null,
            managerRank: dto.managerRank ?? null,
            projectKey: project.key,
            lastKeySeq,
          })
        )
    );
    // On-assign hook (decomposition) only for plain tasks newly assigned to an agent.
    if (saved.isAssignedToAgent && saved.taskType === TaskType.TASK) {
      return this.onAssignedToAgent(saved);
    }
    return saved;
  }

  async updateTask(id: number, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.getTask(id);
    const wasAssignedToAgent = task.isAssignedToAgent;

    // Build updates: only include fields that are explicitly defined (or explicitly null), matching updateTask behavior.
    // This ensures omitted fields preserve the existing stored value.
    const updates: Partial<
      Pick<TaskProps, 'title' | 'description' | 'status' | 'priority' | 'taskType' | 'parentTaskId' | 'gapOriginTaskId' | 'assignedAgentType' | 'githubPrUrl' | 'githubPrNumber' | 'assignedAgentHostId' | 'assignedAgentRef' | 'assignedUserId' >
      Pick<
        TaskProps,
        'gitBranch' | 'explicitRepoId' | 'sprintId' | 'releaseId' | 'storyPoints' | 'startDate' | 'dueDate' | 'businessValue' | 'businessValueRationale' | 'businessValueSource' | 'managerRank' | 'persona' | 'archived'
      >
    > = {};

    // Core fields
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.priority !== undefined) updates.priority = dto.priority;
    if (dto.taskType !== undefined) updates.taskType = dto.taskType;
    // NEW: gapOriginTaskId
    if (dto.gapOriginTaskId !== undefined) {
      updates.gapOriginTaskId = dto.gapOriginTaskId != null ? asTaskId(dto.gapOriginTaskId) : null;
    }
    if (dto.parentTaskId !== undefined) {
      updates.parentTaskId = dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null;
    }
    // NEW: gapOriginTaskId
    if (dto.gapOriginTaskId !== undefined) {
      updates.gapOriginTaskId = dto.gapOriginTaskId != null ? asTaskId(dto.gapOriginTaskId) : null;
    }
    // Scoped metadata and numeric fields
    if (dto.sprintId !== undefined) updates.sprintId = dto.sprintId;
    if (dto.releaseId !== undefined) updates.releaseId = dto.releaseId;
    if (dto.storyPoints !== undefined) updates.storyPoints = dto.storyPoints;
    if (dto.businessValue !== undefined) updates.businessValue = dto.businessValue;
    if (dto.businessValueRationale !== undefined) updates.businessValueRationale = dto.businessValueRationale;
    if (dto.businessValueSource !== undefined) updates.businessValueSource = dto.businessValueSource;
    if (dto.managerRank !== undefined) updates.managerRank = dto.managerRank;
    // Agent-related fields
    if (dto.assignedAgentType !== undefined) updates.assignedAgentType = dto.assignedAgentType;
    if (dto.assignedAgentHostId !== undefined)
      updates.assignedAgentHostId = dto.assignedAgentHostId != null ? asAgentHostId(dto.assignedAgentHostId) : null;
    if (dto.assignedAgentRef !== undefined) updates.assignedAgentRef = dto.assignedAgentRef;
    if (dto.assignedUserId !== undefined) updates.assignedUserId = dto.assignedUserId;
    if (dto.githubPrUrl !== undefined) updates.githubPrUrl = dto.githubPrUrl;
    if (dto.githubPrNumber !== undefined) updates.githubPrNumber = dto.githubPrNumber;
    if (dto.startDate !== undefined) updates.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.dueDate !== undefined) updates.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.persona !== undefined) updates.persona = dto.persona;
    if (dto.archived !== undefined) updates.archived = dto.archived;

    const updated = task.update(updates);
    const saved = await this.tasks.update(updated);

    // On-assign hook: only when this update is what newly handed the task to an
    // agent (a transition into agent-ownership), and only for a plain `task`
    // (an Epic is already decomposed; never re-decompose).
    if (!wasAssignedToAgent && saved.isAssignedToAgent && saved.taskType === TaskType.TASK) {
      return this.onAssignedToAgent(saved);
    }
    return saved;
  }

  async deleteTask(id: TaskId): Promise<void> {
    const task = await this.getTask(id);
    // For now, we keep the delete as part of operations that need direct access.
    // A safer multi-step delete could verify against not having children (optional).
    await this.tasks.delete(task);
  }

  // ---------------------------------------------------------------------------
  // Epic Decomposition (On-Assign Hook and Explicit Decompose)
  // ---------------------------------------------------------------------------

  private async onAssignedToAgent(task: Task): Promise<Task> {
    const plan = await this.decomposer.assess(task);
    if (!plan.isEpic || plan.children.length === 0) return task;
    return this.decomposeEpic(task.id as number, plan.children);
  }

  async decomposeEpic(
    id: number,
    children: ChildTaskPlan[]
  ): Promise<Task> {
    const task = await this.getTask(id);
    const project = await this.projects.findById(task.projectId);
    if (!project) {
      throw new NotFoundError('Project', task.projectId as number);
    }

    const epic = await this.tasks.update(task.reclassifyAsEpic());

    // Key allocation is split across the Epic and all children to stay gap-safe.
    // We allocate keys for the Epic first, then reserve space for children.
    const keys = await this.withKeyAllocation(task.projectId, (lastKeySeq) =>
      this.allocatesKeysForChildren(lastKeySeq, children.length)
    );

    const allocatedKeySeqs = [
      keys.target,
      ...keys.slots,
    ];

    // Keys are minted off the project's highest existing sequence; create children
    // one at a time (via withKeyAllocation) so each gets a distinct, gap-safe key.
    for (let idx = 0; idx < children.length; ++idx) {
      const child = children[idx];
      if (!child.title.trim()) continue;

      // Planner consumption: a child the decomposition left unassigned gets an
      // owner picked from the project's workforce by capability/availability/WIP,
      // so fan-out lands on a real assignee instead of the backlog. Explicit
      // assignments in the plan always win.
      let hostId = child.assignedAgentHostId ?? null;
      let agentRef = child.assignedAgentRef ?? null;
      let userId = child.assignedUserId ?? null;
      if (this.recommendChildAssignee && hostId == null && !agentRef && !userId) {
        const pick = await this.recommendChildAssignee(task.projectId as number, child.roleKey ?? undefined).catch(() => null);
        if (pick?.memberKind === 'human') userId = pick.memberRef;
        else if (pick?.memberKind === 'host_agent') hostId = Number(pick.memberRef);
        else if (pick?.memberKind === 'cloud_agent') agentRef = pick.memberRef;
      }

      await this.withKeyAllocation(task.projectId, (lastKeySeq) => {
        // The `allocatedKeySeqs` array should be consumed in order:
        // first element is the Epic key, remaining elements are children.
        const currentKeySeq = allocatedKeySeqs[idx]; // Use idx because Epic key is at index 0.
        if (currentKeySeq === undefined) throw new Error('Missing key sequence for child/internally fused Epic key');

        return this.tasks.save(
          Task.create({
            projectId: task.projectId,
            title: child.title,
            description: child.description ?? null,
            status: TaskStatus.BACKLOG,
            priority: child.priority ?? TaskPriority.MEDIUM,
            taskType: TaskType.TASK,
            parentTaskId: epic.id,
            assignedAgentType: null,
            assignedAgentHostId: hostId != null ? asAgentHostId(hostId) : null,
            assignedAgentRef: agentRef,
            assignedUserId: userId,
            gapOriginTaskId: child.gapOriginTaskId != null ? asTaskId(child.gapOriginTaskId) : null,
            sprintId: null, // New children start in Backlog.
            releaseId: null,
            storyPoints: null,
            businessValue: null,
            businessValueRationale: null,
            businessValueSource: null,
            managerRank: null,
            persona: null,
            assigneeSeed: currentKeySeq, // Ensure stable order column for children.
            projectKey: project.key,
            lastKeySeq,
          })
        );
      });
    }

    // Refresh the Epic state from DB to ensure sync (important after key allocation).
    const refreshed = await this.getTask(id);
    return refreshed;
  }

  private async withKeyAllocation<T>(
    projectId: ProjectId,
    fn: (lastKeySeq: number) => Promise<T>
  ): Promise<T> {
    // Round up to 10: allocate buffer for children.
    const nextKeySeq = await this.tasks.maxKeySeqByProject(projectId);
    return fn(nextKeySeq);
  }

  private allocatesKeysForChildren(currentLastKeySeq: number, childCount: number): number {
    // Reserve at least childCount key slots from the current sequence.
    const affected = Math.max(1, childCount);
    return currentLastKeySeq + affected;
  }
}

// ---------------------------------------------------------------------------
// Dependency Provider
// ---------------------------------------------------------------------------

export function createTaskService(deps: TaskServiceDeps): TaskService {
  return new TaskService(deps);
}