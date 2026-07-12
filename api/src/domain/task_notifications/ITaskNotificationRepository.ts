/**
 * Task notifications repository
 * 
 * Provides persistence layer for notification history, working with
 * the task_notifications table created in migration 0030_daily_notifications.sql.
 */

import type { TaskNotification } from './TaskNotification';
import type { UserId } from '../shared/types';
import type { TenantId } from '../shared/types';

export interface ITaskNotificationRepository {
  /**
   * Find a task notification by its unique ID
   *
   * IDs are UUIDs, used for deduplication tracking in FR6.
   */
  findById(id: string): Promise<TaskNotification | null>;

  /**
   * Insert a new task notification record
   *
   * Called after sending a notification to persist the send for
   * deduplication purposes.
   */
  insert(notification: TaskNotification): Promise<TaskNotification>;

  /**
   * Find the most recent notification sent to this user
   */
  findLatestByUser(userId: UserId, tenantId: TenantId): Promise<TaskNotification | null>;

  /**
   * Update a notification record
   */
  update(id: string, updates: Partial<TaskNotification>): Promise<TaskNotification>;

  /**
   * Delete a notification record
   */
  delete(id: string): Promise<void>;
}

/**
 * TaskNotification entity
 *
 * Represents a single daily notification history record.
 */
export interface TaskNotificationProps {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  notificationKind: string; // e.g., 'pm_daily', 'lead_daily'
  scheduledAt: Date;
  windowStart: Date;
  windowEnd: Date;
  summaryTitle: string;
  summaryBody: string | null;
  taskCount: number;
  channels: { email: boolean; in_app: boolean; slack: boolean } | null;
  affectedProjects: number[] | null;
  createdAt: Date;
}

export class TaskNotification {
  private constructor(private readonly props: TaskNotificationProps) {}

  static create(props: Omit<TaskNotificationProps, 'id' | 'createdAt'>): TaskNotification {
    return new TaskNotification({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      ...props,
    });
  }

  static reconstitute(props: TaskNotificationProps): TaskNotification {
    return new TaskNotification(props);
  }

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

  get channels(): TaskNotificationProps['channels'] {
    return this.props.channels;
  }

  get affectedProjects(): TaskNotificationProps['affectedProjects'] {
    return this.props.affectedProjects;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  markSent(): TaskNotification {
    return new TaskNotification({
      ...this.props,
      scheduledAt: new Date(),
    });
  }
}