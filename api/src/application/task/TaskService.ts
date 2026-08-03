import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import {
  ProjectId, TaskId, TaskStatus, TaskPriority, TaskType, AgentType, TenantId,
  asProjectId, asTaskId, asTenantId, asAgentHostId,
} from '../../domain/shared/types';
import { NotFoundError, ForbiddenError, ConflictError } from '../../domain/shared/errors';
import {
  EpicDecomposer, ChildTaskPlan, heuristicEpicDecomposer, DecompositionSource,
} from './EpicDecomposer';
import { scheduleItems } from '../planning/scheduleWork';

/** Title key for reconciling a re-decomposition against existing children. */
function normalizeChildTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Postgres unique-constraint violation (e.g. a task-key insert race). */
function isUniqueViolation(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique constraint|23505/i.test(s);
}

/** How many times to re-derive a key and retry a persist that lost a key race. */
const MAX_KEY_ATTEMPTS = 5;

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
  /** 'task' | 'epic' | 'gap' at creation (default 'task'). */
  taskType?: TaskType;
  /** Parent Epic's id — set when creating a child of an Epic. */
  parentTaskId?: number | null;
  /** For a GAP task: the Done item whose review produced it (Validator sets this). */
  gapOriginTaskId?: number | null;
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
  /** Re-parent under an Epic (planning "drag into Epic"), or null to detach. */
  parentTaskId?: number | null;
  /**
   * Opt-in flag: when true, passing parentTaskId: null explicitly detaches the task
   * from its parent. When false/undefined (default), parentTaskId: null is ignored
   * and the existing parent is preserved. This prevents accidental detachment.
   */
  explicitDetach?: boolean;
  /** Schedule into / out of a sprint (planning "drag onto sprint"). null = unscheduled. */
  sprintId?: string | null;
  /** Link to / unlink from a product release (the delivery deliverable). null = unlinked. */
  releaseId?: string | null;
  /** Story-point estimate (drives derived sprint velocity). null = unestimated. */
  storyPoints?: number | null;
  /** AI Manager business value 0-100 (a human edit pins businessValueSource='manual'). */
  businessValue?: number | null;
  businessValueRationale?: string | null;
  businessValueSource?: string | null;
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
    /**
     * Optional planner hook: picks an owner for a fan-out child that the
     * decomposition left unassigned, by ranking the project's workforce on
     * capability/availability/WIP (see assigneeRecommender). Injected from the
     * composition root (it needs env+db for caching); absent in unit tests, where
     * children simply stay unassigned. Returns null when no suitable member.
     */
    private readonly recommendChildAssignee?: (
      projectId: number,
      roleKey?: string,
    ) => Promise<{ memberKind: 'human' | 'cloud_agent' | 'host_agent'; memberRef: string } | null>,
    /**
     * Optional planner hook: records a finish-to-start precedence edge between two
     * fanned-out children, so a decomposition's SEQUENCE survives as data (the
     * `task_dependencies` DAG the spine and Gantt read) rather than living only in
     * the plan that produced it. Injected from the composition root (it needs db +
     * tenant scope for the cycle guard); absent in unit tests, where children are
     * still dated but unsequenced. Rejections are swallowed by the caller.
     */
    private readonly linkDependency?: (
      projectId: number,
      predecessorTaskId: number,
      successorTaskId: number,
    ) => Promise<void>,
  ) {}

  /**
   * List tasks scoped to the caller's tenant. Optionally narrow by project.
   * Archived tasks are excluded unless `includeArchived` is set — the board,
   * backlog and brain's list view should never show items the user archived.
   */
  async listTasks(callerTenantId: number, projectId?: number, includeArchived = false): Promise<Task[]> {
    if (projectId !== undefined) {
      const project = await this.projects.findById(asProjectId(projectId));
      if (!project) throw new NotFoundError('Project', projectId);
      if (project.tenantId !== callerTenantId) throw new ForbiddenError('Project belongs to a different workspace');
      return this.tasks.findAll(asProjectId(projectId), { includeArchived });
    }
    // No project filter: return tasks for ALL projects in this tenant
    const tenantProjects = await this.projects.findByTenant(asTenantId(callerTenantId));
    const projectIds = tenantProjects.map(p => asProjectId(p.id));
    return this.tasks.findByProjectIds(projectIds, { includeArchived });
  }

  async getTask(id: number): Promise<Task> {
    const task = await this.tasks.findById(asTaskId(id));
    if (!task) throw new NotFoundError('Task', id);
    return task;
  }

  /**
   * Allocate a collision-free task key and persist, in one place for every key-
   * minting path (create, move, Epic fan-out). The key sequence is derived from
   * the project's HIGHEST existing key number — not a row count, which skips the
   * gaps left by deletes/moves and would collide on the globally-unique key (the
   * bug that 500'd board moves). `run` receives that base sequence and does the
   * actual save/update. On the rare insert race (a concurrent writer grabbed the
   * same number), the base is re-read and bumped so each retry tries a higher,
   * strictly-increasing number until one is free.
   */
  private async withKeyAllocation(
    projectId: ProjectId,
    run: (lastKeySeq: number) => Promise<Task>,
  ): Promise<Task> {
    for (let attempt = 0; ; attempt++) {
      const lastKeySeq = (await this.tasks.maxKeySeqByProject(projectId)) + attempt;
      try {
        return await run(lastKeySeq);
      } catch (e) {
        if (attempt < MAX_KEY_ATTEMPTS - 1 && isUniqueViolation(e)) continue;
        throw e;
      }
    }
  }

  async createTask(dto: CreateTaskDto, callerTenantId: number): Promise<Task> {
    const project = await this.projects.findById(asProjectId(dto.projectId));
    if (!project) throw new NotFoundError('Project', dto.projectId);
    if (project.tenantId !== callerTenantId) throw new ForbiddenError('Project belongs to a different workspace');

    const saved = await this.withKeyAllocation(asProjectId(dto.projectId), (lastKeySeq) =>
      this.tasks.save(Task.create({
        projectId: asProjectId(dto.projectId),
        title: dto.title,
        description: dto.description ?? null,
        status: TaskStatus.BACKLOG,
        priority: dto.priority ?? TaskPriority.MEDIUM,
        assignedAgentType: dto.assignedAgentType ?? null,
        assignedAgentHostId: dto.assignedAgentHostId != null ? asAgentHostId(dto.assignedAgentHostId) : null,
        assignedAgentRef: dto.assignedAgentRef ?? null,
        assignedUserId: dto.assignedUserId ?? null,
        taskType: dto.taskType,
        parentTaskId: dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null,
        gapOriginTaskId: dto.gapOriginTaskId != null ? asTaskId(dto.gapOriginTaskId) : null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        persona: dto.persona ?? null,
        projectKey: project.key,
        lastKeySeq,
      })),
    );
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

    // Determine if parentTaskId should be applied:
    // - If explicitDetach is true, always apply parentTaskId (including null to detach)
    // - If explicitDetach is false/undefined, only apply parentTaskId when it's NOT null
    //   (i.e., re-parenting to a different task, but not detaching)
    const shouldApplyParent = dto.explicitDetach === true || dto.parentTaskId !== null;
    const parentTaskId = dto.parentTaskId !== undefined
      ? (dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : (shouldApplyParent ? null : undefined))
      : undefined;

    const updated = task.update({
      ...dto,
      explicitDetach: undefined, // Not a domain field, consumed above
      assignedAgentHostId: dto.assignedAgentHostId !== undefined
        ? (dto.assignedAgentHostId != null ? asAgentHostId(dto.assignedAgentHostId) : null)
        : undefined,
      parentTaskId,
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
    // `replace` so a task re-entering agent ownership reconciles its existing
    // children instead of failing the assignment on the idempotency guard.
    return this.decomposeEpic(task.id as number, plan.children, { replace: true, source: plan.source });
  }

  /**
   * Server action: turn a task into an Epic and fan its planned children out as
   * real child tasks (each linked back via parentTaskId). Reclassifying the Epic
   * also sheds its agent assignee — an Epic is a planning container, the children
   * carry the executable assignments. Returns the reclassified Epic.
   *
   * SCHEDULING is part of fan-out, not an afterthought. Every child is placed on the
   * timeline by the shared {@link scheduleItems} planner: windows roll down from the
   * Epic's own window (or from today when the Epic is undated), sibling precedence
   * from the plan becomes real `task_dependencies` edges, and an undated Epic is
   * back-filled with the span of its children. Before this, every decomposed child
   * was created with `startDate: null, dueDate: null` and no edges — which is why the
   * planning spine had a hierarchy but no time dimension.
   *
   * IDEMPOTENCY: an Epic that already has children is a conflict, not an invitation
   * to append a second set (re-running this is what produced duplicate rows on the
   * spine). Pass `replace` to reconcile instead: children matching an existing child
   * by normalized title are re-scheduled in place, and only genuinely new ones are
   * created. Existing children absent from the plan are left alone — they may carry
   * real work, and deleting them is a human's call.
   *
   * Exposed publicly so the decomposition can also be triggered explicitly (e.g.
   * a "Break into subtasks" board action) independent of the on-assign hook.
   */
  async decomposeEpic(
    id: number,
    children: ChildTaskPlan[],
    opts: { replace?: boolean; source?: DecompositionSource } = {},
  ): Promise<Task> {
    const task = await this.getTask(id);
    const project = await this.projects.findById(task.projectId);
    if (!project) throw new NotFoundError('Project', task.projectId as number);

    const existingChildren = await this.tasks.findChildren(asTaskId(id));
    if (existingChildren.length > 0 && !opts.replace) {
      throw new ConflictError(
        `Task ${id} is already decomposed into ${existingChildren.length} child ${existingChildren.length === 1 ? 'task' : 'tasks'}. ` +
        'Pass replace to reconcile the existing children instead of duplicating them.',
      );
    }
    const existingByTitle = new Map(existingChildren.map((c) => [normalizeChildTitle(c.title), c]));

    // Stamp WHO planned this — an LLM assessment and the markdown fallback produce
    // very different quality, and the difference was previously invisible in the data.
    const epic = await this.tasks.update(
      task.reclassifyAsEpic().update({ decompositionSource: opts.source ?? 'manual' }),
    );

    // ── plan the timeline BEFORE creating anything ──────────────────────────
    // Children are scheduled by their position in the plan, so a child's window is
    // known before its row exists (task ids aren't available yet — dependency edges
    // are written afterwards, once every child has an id).
    const planned = children.filter((c) => c.title.trim());
    const schedule = scheduleItems(
      planned.map((child, index) => ({
        key: String(index),
        estimateDays: child.estimateDays,
        afterKeys: child.dependsOnIndex != null && child.dependsOnIndex >= 0 && child.dependsOnIndex < index
          ? [String(child.dependsOnIndex)]
          : [],
      })),
      { anchor: epic.startDate ?? new Date(), deadline: epic.dueDate },
    );
    /** plan index → created/reconciled task id, for the dependency pass below. */
    const idByIndex = new Map<number, number>();

    // Keys are minted off the project's highest existing sequence; create children
    // one at a time (via withKeyAllocation) so each gets a distinct, gap-safe key.
    for (const [index, child] of planned.entries()) {
      const window = schedule.windows.get(String(index)) ?? null;

      // Reconcile: a child with this title already exists — schedule it rather than
      // creating a duplicate of the work.
      const existing = existingByTitle.get(normalizeChildTitle(child.title));
      if (existing) {
        const rescheduled = await this.tasks.update(existing.update({
          startDate: window?.startDate ?? undefined,
          dueDate: window?.endDate ?? undefined,
        }));
        idByIndex.set(index, rescheduled.id as number);
        continue;
      }

      // Planner consumption: a child the decomposition left unassigned gets an
      // owner picked from the project's workforce by capability/availability/WIP,
      // so fan-out lands on a real assignee instead of the backlog. Explicit
      // assignments in the plan always win.
      let hostId = child.assignedAgentHostId ?? null;
      let agentRef = child.assignedAgentRef ?? null;
      let userId = child.assignedUserId ?? null;
      if (this.recommendChildAssignee && hostId == null && !agentRef && !userId) {
        // Role-aware fan-out: pass the child's best-fit producer role (from the
        // decomposer) so a coding child lands on a developer-capable owner, not the
        // most-available teammate regardless of role.
        const pick = await this.recommendChildAssignee(task.projectId as number, child.roleKey ?? undefined).catch(() => null);
        if (pick?.memberKind === 'human') userId = pick.memberRef;
        else if (pick?.memberKind === 'host_agent') hostId = Number(pick.memberRef);
        else if (pick?.memberKind === 'cloud_agent') agentRef = pick.memberRef;
      }

      const saved = await this.withKeyAllocation(task.projectId, (lastKeySeq) =>
        this.tasks.save(Task.create({
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
          startDate: window?.startDate ?? null,
          dueDate: window?.endDate ?? null,
          persona: null,
          projectKey: project.key,
          lastKeySeq,
        })),
      );
      idByIndex.set(index, saved.id as number);
    }

    // ── materialise sequence as real precedence edges ────────────────────────
    // The plan's sibling ordering is only visible to a PM once it exists as
    // `task_dependencies` rows — that is what the spine and the Gantt read. Best
    // effort per edge: a rejected edge (cycle guard, cross-project) must never
    // undo a fan-out that otherwise succeeded.
    if (this.linkDependency) {
      for (const [index, child] of planned.entries()) {
        const predIndex = child.dependsOnIndex;
        if (predIndex == null || predIndex < 0 || predIndex >= index) continue;
        const successorId = idByIndex.get(index);
        const predecessorId = idByIndex.get(predIndex);
        if (successorId == null || predecessorId == null) continue;
        await this.linkDependency(task.projectId as number, predecessorId, successorId).catch((error) => {
          reportCaughtError(error, { source: "application/task/TaskService.ts", operation: "decomposeEpic" });
        });
      }
    }

    // ── back-fill the Epic's own window from what it now contains ────────────
    // An undated Epic with dated children is the state that leaves a parent row
    // reading "no dates" above a fully scheduled subtree.
    if (schedule.span && (epic.startDate == null || epic.dueDate == null)) {
      return this.tasks.update(epic.update({
        startDate: epic.startDate ?? schedule.span.startDate,
        dueDate: epic.dueDate ?? schedule.span.endDate,
      }));
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

    // Re-key into the target board off its highest existing sequence (gap-safe;
    // a row count would collide on the globally-unique key — the move-500 bug).
    return this.withKeyAllocation(asProjectId(targetProjectId), (lastKeySeq) => {
      const key = Task.buildKey(target.key, lastKeySeq + 1);
      return this.tasks.update(task.moveToProject(asProjectId(targetProjectId), key));
    });
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
