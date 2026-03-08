import { TaskId, ProjectId, TaskStatus, TaskPriority, AgentType, ClawId } from '../shared/types';
import { ValidationError } from '../shared/errors';

export interface TaskProps {
  id: TaskId;
  projectId: ProjectId;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentType: AgentType | null;
  githubPrUrl: string | null;
  githubPrNumber: number | null;
  assignedClawId: ClawId | null;
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
      'id' | 'key' | 'createdAt' | 'updatedAt' | 'githubPrUrl' | 'githubPrNumber' | 'archived'
    > & {
      projectKey: string;
      projectTaskCount: number;
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
      githubPrUrl: null,
      githubPrNumber: null,
      assignedClawId: null,
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
  get status(): TaskStatus { return this.props.status; }
  get priority(): TaskPriority { return this.props.priority; }
  get assignedAgentType(): AgentType | null { return this.props.assignedAgentType; }
  get githubPrUrl(): string | null { return this.props.githubPrUrl; }
  get githubPrNumber(): number | null { return this.props.githubPrNumber; }
  get assignedClawId(): ClawId | null { return this.props.assignedClawId; }
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
        | 'githubPrUrl' | 'githubPrNumber' | 'assignedClawId' | 'startDate' | 'dueDate'
        | 'persona' | 'archived'
      >
    >,
  ): Task {
    return new Task({ ...this.props, ...updates, updatedAt: new Date() });
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
