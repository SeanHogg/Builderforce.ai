import { NotificationPreference } from './NotificationPreference';
import { TenantId, UserId } from '../shared/types';

/**
 * Repository interface for notification preference CRUD operations
 */
export interface INotificationPreferenceRepository {
  /** Find by user ID */
  findByUserId(userId: UserId, tenantId: TenantId): Promise<NotificationPreference | null>;

  /** Find enabled preferences for given kind (PM or LEAD) */
  findEnabledByKind(notificationKind: 'pm_daily' | 'lead_daily', tenantId: TenantId): Promise<NotificationPreference[]>;

  /** Save (create or update) */
  save(preference: NotificationPreference): Promise<NotificationPreference>;

  /** Update by ID */
  update(id: string, updates: Partial<NotificationPreference>): Promise<NotificationPreference>;

  /** Delete by ID */
  delete(id: string): Promise<void>;

  /** Check if notification is already scheduled for user within window */
  findOverlappingNotification(
    userId: UserId,
    notificationKind: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<TaskNotification | null>;

  /** Clear old notifications older than N days (clean up) */
  deleteOlderThan(days: number): Promise<number>;
}