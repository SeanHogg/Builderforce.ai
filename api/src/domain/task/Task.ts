import { TaskId, ProjectId, TaskStatus, TaskPriority, TaskType, AgentType, AgentHostId } from '../shared/types';
import { ValidationError } from '../shared/errors';

export interface TaskProps {
  id: TaskId;
  projectId: ProjectId;
  key: string;
  title: string;
  description: string | null;
  /**
   * Free-form status = the key of the swimlane (board column) the task sits in.
   * The {@link TaskStatus} enum holds the canonical defaults automation drives;
   * a configurable board may use any lane key here.
   */
  status: string;
  priority: TaskPriority;
  /** Fixed type dimension: a plain `task` or an `epic` that decomposes into children. */
  taskType: TaskType;
  /** Parent Epic's id (null for top-level tasks). Set on children of a decomposed Epic. */
  parentTaskId: TaskId | null;
  assignedAgentType: AgentType | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubPrUrl: string | null;
  githubPrNumber: number | null;
  assignedAgentHostId: AgentHostId | null;
  /** ide_agents.id of the cloud agent working this ticket (agents are assignees). */
  assignedAgentRef: string | null;
  /** Human assignee/owner (users.id). Mutually exclusive with the agent assignees. */
  assignedUserId: string | null;
  /** Git branch the agent executes this ticket under (links to the PR/code changes). */
  gitBranch: string | null;
  /** project_repositories.id the run is pinned to, or null to auto-resolve (default/inferred). */
  explicitRepoId: string | null;
  /** sprints.id this task is scheduled into, or null when unscheduled (backlog). */
  sprintId: string | null;
  /** product_releases.id this task ships in, or null (0227). Makes a release a
   *  first-class deliverable for the delivery lens. */
  releaseId: string | null;
  /** Story-point estimate (0246), or null when unestimated — the leaf source for
   *  derived sprint velocity. */
  storyPoints: number | null;
  /** AI Manager (0265): business value 0-100, null when unscored. */
  businessValue: number | null;
  /** One-line justification for {@link businessValue}. */
  businessValueRationale: string | null;
  /** How the score was set: 'ai' | 'rice' | 'manual' (a manual edit pins it). */
  businessValueSource: string | null;
  /** The manager's computed backlog rank (1 = do first), null when unranked. */
  managerRank: number | null;
  /** Validator review bookkeeping (0270): how many review passes this task has had,
   *  when the last pass ran, and its verdict ('complete' | 'gaps' | null). */
  reviewCount: number;
  lastReviewedAt: Date | null;
  lastReviewVerdict: string | null;
  /** For a GAP-typed task: the Done item whose review produced it (null otherwise). */
  gapOriginTaskId: TaskId | null;
  startDate: Date | null;
  dueDate: Date | null;
  persona: string | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Task entity (belongs to a Project aggregate).
 *
 * A Task represents a unit of work that can be assigned to an AI agent
 * or a human developer.
 */
export class Task {
  private constructor(private readonly props: TaskProps) {}

  // ------------------------------------------------------------------
  // Factory methods
  // ------------------------------------------------------------------

  /**
   * Canonical task-key format: `${projectKey}-${NNN}` (3-digit, zero-padded).
   * The single source of truth for key shape — both {@link Task.create} and the
   * move/re-key path go through here so the format never drifts.
   */
  static buildKey(projectKey: string, seq: number): string {
    return `${projectKey}-${String(seq).padStart(3, '0')}`;
  }

  static create(
    props: Omit<
      TaskProps,
      'id' | 'key' | 'createdAt' | 'updatedAt' | 'githubIssueNumber' | 'githubIssueUrl' | 'githubPrUrl' | 'githubPrNumber' | 'archived' | 'assignedAgentRef' | 'assignedUserId' | 'gitBranch' | 'explicitRepoId' | 'taskType' | 'parentTaskId' | 'sprintId' | 'releaseId' | 'storyPoints' | 'businessValue' | 'businessValueRationale' | 'businessValueSource' | 'managerRank' | 'reviewCount' | 'lastReviewedAt' | 'lastReviewVerdict' | 'gapOriginTaskId'
    > & {
      projectKey: string;
      /** Highest existing key sequence in the project; this task gets the next one. */
      lastKeySeq: number;
      /** Optional cloud agent (ide_agents.id) assigned at creation time. */
      assignedAgentRef?: string | null;
      /** Optional human assignee (users.id) at creation time. */
      assignedUserId?: string | null;
      /** Type at creation (default `task`). A decomposed child passes the Epic's id as parent. */
      taskType?: TaskType;
      parentTaskId?: TaskId | null;
      /** For a GAP task: the Done item whose review produced it (Validator sets this). */
      gapOriginTaskId?: TaskId | null;
    },
  ): Task {
    if (!props.title.trim()) throw new ValidationError('Task title is required');

    const key = Task.buildKey(props.projectKey, props.lastKeySeq + 1);
    const now = new Date();

    return new Task({
      id: 0 as TaskId,
      projectId: props.projectId,
      key,
      title: props.title.trim(),
      description: props.description,
      status: props.status ?? TaskStatus.BACKLOG,
      priority: props.priority ?? TaskPriority.MEDIUM,
      taskType: props.taskType ?? TaskType.TASK,
      parentTaskId: props.parentTaskId ?? null,
      assignedAgentType: props.assignedAgentType,
      githubIssueNumber: null,
      githubIssueUrl: null,
      githubPrUrl: null,
      githubPrNumber: null,
      assignedAgentHostId: props.assignedAgentHostId ?? null,
      assignedAgentRef: props.assignedAgentRef ?? null,
      assignedUserId: props.assignedUserId ?? null,
      gitBranch: null,
      explicitRepoId: null,
      sprintId: null,
      releaseId: null,
      storyPoints: null,
      businessValue: null,
      businessValueRationale: null,
      businessValueSource: null,
      managerRank: null,
      reviewCount: 0,
      lastReviewedAt: null,
      lastReviewVerdict: null,
      gapOriginTaskId: props.gapOriginTaskId ?? null,
      startDate: props.startDate ?? null,
      dueDate: props.dueDate ?? null,
      persona: props.persona ?? null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: TaskProps): Task {
    return new Task(props);
  }

  // ------------------------------------------------------------------
  // Accessors
  // ------------------------------------------------------------------

  get id(): TaskId { return this.props.id; }
  get projectId(): ProjectId { return this.props.projectId; }
  get key(): string { return this.props.key; }
  get title(): string { return this.props.title; }
  get description(): string | null { return this.props.description; }
  get status(): string { return this.props.status; }
  get priority(): TaskPriority { return this.props.priority; }
  get taskType(): TaskType { return this.props.taskType; }
  get parentTaskId(): TaskId | null { return this.props.parentTaskId; }
  get isEpic(): boolean { return this.props.taskType === TaskType.EPIC; }
  /** True when an AGENT (self-hosted host or cloud ref) owns this task — the
   *  on-assign decomposition hook only fires for agent assignees, not humans. */
  get isAssignedToAgent(): boolean {
    return this.props.assignedAgentHostId != null || this.props.assignedAgentRef != null;
  }
  get assignedAgentType(): AgentType | null { return this.props.assignedAgentType; }
  get githubIssueNumber(): number | null { return this.props.githubIssueNumber; }
  get githubIssueUrl(): string | null { return this.props.githubIssueUrl; }
  get githubPrUrl(): string | null { return this.props.githubPrUrl; }
  get githubPrNumber(): number | null { return this.props.githubPrNumber; }
  get assignedAgentHostId(): AgentHostId | null { return this.props.assignedAgentHostId; }
  get assignedAgentRef(): string | null { return this.props.assignedAgentRef; }
  get assignedUserId(): string | null { return this.props.assignedUserId; }
  get gitBranch(): string | null { return this.props.gitBranch; }
  get explicitRepoId(): string | null { return this.props.explicitRepoId; }
  get sprintId(): string | null { return this.props.sprintId; }
  get releaseId(): string | null { return this.props.releaseId; }
  get storyPoints(): number | null { return this.props.storyPoints; }
  get businessValue(): number | null { return this.props.businessValue; }
  get businessValueRationale(): string | null { return this.props.businessValueRationale; }
  get businessValueSource(): string | null { return this.props.businessValueSource; }
  get managerRank(): number | null { return this.props.managerRank; }
  get reviewCount(): number { return this.props.reviewCount; }
  get lastReviewedAt(): Date | null { return this.props.lastReviewedAt; }
  get lastReviewVerdict(): string | null { return this.props.lastReviewVerdict; }
  get gapOriginTaskId(): TaskId | null { return this.props.gapOriginTaskId; }
  get isGap(): boolean { return this.props.taskType === TaskType.GAP; }
  get startDate(): Date | null { return this.props.startDate; }
  get dueDate(): Date | null { return this.props.dueDate; }
  get persona(): string | null { return this.props.persona; }
  get archived(): boolean { return this.props.archived; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  // ------------------------------------------------------------------
  // Behaviour
  // ------------------------------------------------------------------

  update(
    updates: Partial<
      Pick<
        TaskProps,
        'title' | 'description' | 'status' | 'priority' | 'taskType' | 'parentTaskId' | 'assignedAgentType'
        | 'githubPrUrl' | 'githubPrNumber' | 'assignedAgentHostId' | 'assignedAgentRef' | 'assignedUserId' | 'gitBranch' | 'explicitRepoId' | 'sprintId' | 'releaseId' | 'storyPoints' | 'startDate' | 'dueDate'
        | 'businessValue' | 'businessValueRationale' | 'businessValueSource' | 'managerRank'
        | 'persona' | 'archived'
      >
    >,
  ): Task {
    // ROOT-CAUSE FIX (parentTaskId drop): a partial update must only touch the
    // fields the caller actually sent. TaskService masks an OMITTED field as
    // `undefined` (vs. an explicit `null`, which means "clear this column").
    // Spreading `updates` straight onto props would write those `undefined`s over
    // the stored values — so an update carrying `assignedAgentRef` (or any other
    // field) but NOT `parentTaskId` used to blow away the existing parentTaskId,
    // which the repository then persisted as NULL (`plain.parentTaskId ?? null`).
    // Stripping `undefined` keys here preserves omitted fields while still honoring
    // an explicit `null` (detach) — for parentTaskId, assignees, and every field.
    const stripped = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );
    return new Task({ ...this.props, ...stripped, updatedAt: new Date() });
  }

  /**
   * Reclassify this task as an Epic — the first step of agent-driven decomposition.
   * A BA-style agent assigned a vague "new item" may determine it is really an Epic
   * (too large to execute directly) and flip the type before fanning it out into
   * child tasks. An Epic is a planning container, not an executable unit, so it also
   * sheds any agent assignee (the children carry the real execution assignments).
   */
  reclassifyAsEpic(): Task {
    if (this.props.taskType === TaskType.EPIC) return this;
    return new Task({
      ...this.props,
      taskType: TaskType.EPIC,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      updatedAt: new Date(),
    });
  }

  /**
   * Move this task to a different project (board). The key is regenerated from the
   * destination project so it matches that board's prefix (e.g. ACME-014), mirroring
   * how issue trackers re-key an issue moved between projects. projectId/key live
   * outside {@link update}'s allowed fields because reassignment is a distinct
   * lifecycle event, not a field edit.
   */
  moveToProject(projectId: ProjectId, key: string): Task {
    return new Task({ ...this.props, projectId, key, updatedAt: new Date() });
  }

  start(): Task {
    return this.update({ status: TaskStatus.IN_PROGRESS });
  }

  complete(): Task {
    return this.update({ status: TaskStatus.DONE });
  }

  linkPullRequest(url: string, number: number): Task {
    return this.update({ githubPrUrl: url, githubPrNumber: number, status: TaskStatus.IN_REVIEW });
  }

  toPlain(): TaskProps {
    return { ...this.props };
  }
}
