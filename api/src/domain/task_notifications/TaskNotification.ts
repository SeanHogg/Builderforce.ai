import { TenantId, UserId } from '../shared/types';

/**
 * TaskNotification entity
 * 
 * FR6: Deduplication Logic
 * Tracks notified task summaries to prevent re-notification of the same 
 * 'new' or 'changed' status within the same 24-hour window.
 * 
 * Tracks:
 * - notification kind: which type of notification
 * - scheduled_at: intended delivery time (08:50 UTC default)
 * - window_start/window_end: 24-hour coverage period
 * - summary content: title and body
 * - task_count: how many tasks were included
 * - channels: which delivery channels were used
 * - affected_projects: projects that had changes
 */
export interface TaskNotificationProps {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  /** Type of daily notification (pm_daily, lead_daily) */
  notificationKind: string;
  sentAt: Date;
  scheduledAt: Date;
  windowStart: Date; // Coverage start
  windowEnd: Date; // Coverage end (windowStart + 24h)
  summaryTitle: string;
  summaryBody: string | null;
  taskCount: number;
  /** Which delivery channels were used: {email: true, in_app: true, slack: false} */
  channels: Record<string, boolean>;
  /** Projects affected by changes in this window */
  affectedProjects: number[];
  createdAt: Date;
  updatedAt: Date;
}

export class TaskNotification {
  private constructor(private readonly props: TaskNotificationProps) {}

  static create(
    props: Omit<TaskNotificationProps, 'id' | 'createdAt' | 'updatedAt'>,
  ): TaskNotification {
    return new TaskNotification({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...props,
    });
  }

  static reconstitute(props: TaskNotificationProps): TaskNotification {
    return new TaskNotification(props);
  }

  // ------------------------------------------------------------------
  // Accessors
  // ------------------------------------------------------------------

  get id(): string {
    return this.props.id;
  }

  get tenantId(): TenantId {
    return this.props.tenantId;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get notificationKind(): string {
    return this.props.notificationKind;
  }

  get sentAt(): Date {
    return this.props.sentAt;
  }

  get scheduledAt(): Date {
    return this.props.scheduledAt;
  }

  get windowStart(): Date {
    return this.props.windowStart;
  }

  get windowEnd(): Date {
    return this.props.windowEnd;
  }

  get summaryTitle(): string {
    return this.props.summaryTitle;
  }

  get summaryBody(): string | null {
    return this.props.summaryBody;
  }

  get taskCount(): number {
    return this.props.taskCount;
  }

  get channels(): Record<string, boolean> {
    return this.props.channels;
  }

  get affectedProjects(): number[] {
    return this.props.affectedProjects;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ------------------------------------------------------------------
  // Behaviours
  // ------------------------------------------------------------------

  /** Check if this notification covers the given window */
  coversWindow(startTime: Date, endTime: Date): boolean {
    // Window is inclusive - if the input overlaps with any part of this notification's window
    return endTime >= this.props.windowStart && startTime <= this.props.windowEnd;
  }

  /** Check for duplicate of the same task within same window for same user */
  hadTaskChangeDeduplication(taskId: number, windowStart: Date, windowEnd: Date): boolean {
    // If this notification covers the window and contained the task
    if (this.coversWindow(windowStart, windowEnd)) {
      return this.props.affectedProjects.includes(taskId / 1000 | 0); // rough project ID estimate (would need proper join in real implementation)
    }
    return false;
  }

  private update(updates: Partial<TaskNotificationProps>): TaskNotification {
    return new TaskNotification({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }
}