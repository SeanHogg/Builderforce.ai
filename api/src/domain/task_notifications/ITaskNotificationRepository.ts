import { TaskNotification } from './TaskNotification';
import { TenantId, UserId } from '../shared/types';

/**
 * Repository interface for task notification history CRUD
 */
export interface ITaskNotificationRepository {
  /** Find by user ID and notification kind */
  findByUser(userId: UserId, notificationKind: string, tenantId: TenantId): Promise<TaskNotification[]>;

  /** Find notification that overlaps the given window */
  findOverlapping(userId: UserId, notificationKind: string, windowStart: Date, windowEnd: Date): Promise<TaskNotification | null>;

  /** Save notification */
  save(notification: TaskNotification): Promise<TaskNotification>;

  /** Delete old notifications */
  deleteOlderThan(days: number): Promise<number>;

  /** Mark notification as sent (tracking delivery confirmations) */
  markAsSent(id: string, sentAt: Date): Promise<TaskNotification>;
}