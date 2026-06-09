import { TaskId, ProjectId, TaskStatus, TaskPriority, AgentType, AgentHostId } from '../shared/types';
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
  assignedAgentType: AgentType | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubPrUrl: string | null;
  githubPrNumber: number | null;
  assignedAgentHostId: AgentHostId | null;
  /** ide_agents.id of the cloud agent working this ticket (agents are assignees). */
  assignedAgentRef: string | null;
  /** Git branch the agent executes this ticket under (links to the PR/code changes). */
  gitBranch: string | null;
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

  static create(
    props: Omit<
      TaskProps,
      'id' | 'key' | 'createdAt' | 'updatedAt' | 'githubIssueNumber' | 'githubIssueUrl' | 'githubPrUrl' | 'githubPrNumber' | 'archived' | 'assignedAgentRef' | 'gitBranch'
    > & {
      projectKey: string;
      projectTaskCount: number;
      /** Optional cloud agent (ide_agents.id) assigned at creation time. */
      assignedAgentRef?: string | null;
    },
  ): Task {
    if (!props.title.trim()) throw new ValidationError('Task title is required');

    const seq = String(props.projectTaskCount + 1).padStart(3, '0');
    const key = `${props.projectKey}-${seq}`;
    const now = new Date();

    return new Task({
      id: 0 as TaskId,
      projectId: props.projectId,
      key,
      title: props.title.trim(),
      description: props.description,
      status: props.status ?? TaskStatus.BACKLOG,
      priority: props.priority ?? TaskPriority.MEDIUM,
      assignedAgentType: props.assignedAgentType,
      githubIssueNumber: null,
      githubIssueUrl: null,
      githubPrUrl: null,
      githubPrNumber: null,
      assignedAgentHostId: props.assignedAgentHostId ?? null,
      assignedAgentRef: props.assignedAgentRef ?? null,
      gitBranch: null,
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
  get assignedAgentType(): AgentType | null { return this.props.assignedAgentType; }
  get githubIssueNumber(): number | null { return this.props.githubIssueNumber; }
  get githubIssueUrl(): string | null { return this.props.githubIssueUrl; }
  get githubPrUrl(): string | null { return this.props.githubPrUrl; }
  get githubPrNumber(): number | null { return this.props.githubPrNumber; }
  get assignedAgentHostId(): AgentHostId | null { return this.props.assignedAgentHostId; }
  get assignedAgentRef(): string | null { return this.props.assignedAgentRef; }
  get gitBranch(): string | null { return this.props.gitBranch; }
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
        'title' | 'description' | 'status' | 'priority' | 'assignedAgentType'
        | 'githubPrUrl' | 'githubPrNumber' | 'assignedAgentHostId' | 'assignedAgentRef' | 'gitBranch' | 'startDate' | 'dueDate'
        | 'persona' | 'archived'
      >
    >,
  ): Task {
    return new Task({ ...this.props, ...updates, updatedAt: new Date() });
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
