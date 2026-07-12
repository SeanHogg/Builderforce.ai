/**
 * Infrastructure implementation of notification preferences
 * 
 * FL3: CRUD for PM/Lead user preferences
 */
import { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';

import { NotificationPreference } from '../../domain/notification_preferences/NotificationPreference';
import { INotificationPreferenceRepository } from '../../domain/notification_preferences/INotificationPreferenceRepository';
import { TenantId, UserId } from '../../domain/shared/types';

type EnvType = Pick<
  Env,
  | 'DATABASE_URL'
  | 'APP_ENV'
  | 'APP_REGION'
  | 'PROVISIONING_TENANT_ID'
  | 'DEFAULT_TENANT_ID'
  | 'DEFAULT_ORG_ID'
  | 'APP_DEPLOYMENT_ID'
  | 'DATABASE_ICU_MAX_THREADS'
>;

type Sql = ReturnType<typeof neon<false, false>>;

/**
 * Repository implementation for notification preferences (FR3)
 */
export class NotificationPreferenceRepository implements INotificationPreferenceRepository {
  constructor(private readonly sql: Sql, private readonly env: EnvType) {}

  /**
   * Find by user ID - returns null if none exists
   */
  async findByUserId(userId: UserId, tenantId: TenantId): Promise<NotificationPreference | null> {
    try {
      const [row] = await this.sql`
        SELECT 
          id, tenant_id, user_id, enabled, delivery_channels, 
          notification_kind, send_time_utc, timezone, priority_filter, 
          max_tasks, active, created_at, updated_at
        FROM notification_preferences
        WHERE user_id = ${userId} AND tenant_id = ${tenantId}
      ` as Array<{
        id: string;
        tenant_id: number;
        user_id: string;
        enabled: boolean;
        delivery_channels: string;
        notification_kind: string;
        send_time_utc: string;
        timezone: string;
        priority_filter: string | null;
        max_tasks: number;
        active: boolean;
        created_at: Date;
        updated_at: Date;
      }>;

      return row ? NotificationPreference.reconstitute({
        id: row.id,
        tenantId: row.tenant_id as TenantId,
        userId: row.user_id as UserId,
        enabled: row.enabled,
        deliveryChannels: JSON.parse(row.delivery_channels),
        notificationKind: row.notification_kind as 'pm_daily' | 'lead_daily',
        sendTimeUtc: row.send_time_utc,
        timezone: row.timezone,
        priorityFilter: row.priority_filter ? JSON.parse(row.priority_filter) : null,
        maxTasks: row.max_tasks,
        active: row.active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }) : null;
    } catch {
      return null;
    }
  }

  /**
   * Find enabled preferences for a notification kind (PM or LEAD)
   */
  async findEnabledByKind(
    notificationKind: 'pm_daily' | 'lead_daily',
    tenantId: TenantId,
  ): Promise<NotificationPreference[]> {
    try {
      const rows = await this.sql`
        SELECT 
          id, tenant_id, user_id, enabled, delivery_channels, 
          notification_kind, send_time_utc, timezone, priority_filter, 
          max_tasks, active, created_at, updated_at
        FROM notification_preferences
        WHERE notification_kind = ${notificationKind}
          AND enabled = true
          AND active = true
      ` as Array<{
        id: string;
        tenant_id: number;
        user_id: string;
        enabled: boolean;
        delivery_channels: string;
        notification_kind: string;
        send_time_utc: string;
        timezone: string;
        priority_filter: string | null;
        max_tasks: number;
        active: boolean;
        created_at: Date;
        updated_at: Date;
      }>;

      return rows.map((row) =>
        NotificationPreference.reconstitute({
          id: row.id,
          tenantId: row.tenant_id as TenantId,
          userId: row.user_id as UserId,
          enabled: row.enabled,
          deliveryChannels: JSON.parse(row.delivery_channels),
          notificationKind: row.notification_kind as 'pm_daily' | 'lead_daily',
          sendTimeUtc: row.send_time_utc,
          timezone: row.timezone,
          priorityFilter: row.priority_filter ? JSON.parse(row.priority_filter) : null,
          maxTasks: row.max_tasks,
          active: row.active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      );
    } catch {
      return [];
    }
  }

  /**
   * Save (create or update) a preference
   */
  async save(preference: NotificationPreference): Promise<NotificationPreference> {
    try {
      const existing = await this.findByUserId(preference.userId, preference.tenantId);

      if (existing) {
        // Update existing
        await this.sql`
          UPDATE notification_preferences
          SET 
            enabled = ${preference.enabled},
            delivery_channels = ${JSON.stringify(preference.deliveryChannels)},
            notification_kind = ${preference.notificationKind},
            send_time_utc = ${preference.sendTimeUtc},
            timezone = ${preference.timezone},
            priority_filter = ${JSON.stringify(preference.priorityFilter)},
            max_tasks = ${preference.maxTasks},
            active = ${preference.active},
            updated_at = ${preference.updatedAt}
          WHERE id = ${preference.id}
        `;
        return preference;
      } else {
        // Create new
        await this.sql`
          INSERT INTO notification_preferences (
            id, tenant_id, user_id, enabled, delivery_channels, 
            notification_kind, send_time_utc, timezone, priority_filter, 
            max_tasks, active, created_at, updated_at
          ) VALUES (
            ${preference.id},
            ${preference.tenantId},
            ${preference.userId},
            ${preference.enabled},
            ${JSON.stringify(preference.deliveryChannels)},
            ${preference.notificationKind},
            ${preference.sendTimeUtc},
            ${preference.timezone},
            ${JSON.stringify(preference.priorityFilter)},
            ${preference.maxTasks},
            ${preference.active},
            ${preference.createdAt},
            ${preference.updatedAt}
          )
        `;
        return preference;
      }
    } catch (err) {
      console.error('[NotificationPreferenceRepository] Save failed:', (err as Error)?.message);
      throw err;
    }
  }

  /**
   * Update by ID
   */
  async update(id: string, updates: Partial<NotificationPreference>): Promise<NotificationPreference> {
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      const dynamicSql = this.sql`
        UPDATE notification_preferences
        SET ${this.sql`updated_at = ${Date.now()}`}, `;
      console.log('RAW dynamicSQL', dynamicSql); // debug

      // Helper to add a SET clause
      const addSet = (key: string, value: any) => {
        setClauses.push(`${key} = ?`);
        values.push(value);
      };

      if (updates.enabled !== undefined) addSet('enabled', updates.enabled);
      if (updates.deliveryChannels !== undefined) addSet('delivery_channels', JSON.stringify(updates.deliveryChannels));
      if (updates.notificationKind !== undefined) addSet('notification_kind', updates.notificationKind);
      if (updates.sendTimeUtc !== undefined) addSet('send_time_utc', updates.sendTimeUtc);
      if (updates.timezone !== undefined) addSet('timezone', updates.timezone);
      if (updates.priorityFilter !== undefined) addSet('priority_filter', JSON.stringify(updates.priorityFilter));
      if (updates.maxTasks !== undefined) addSet('max_tasks', updates.maxTasks);
      if (updates.active !== undefined) addSet('active', updates.active);

      // Always update updatedAt
      setClauses.push('updated_at = ${sql(Date.now())}');

      await this.sql`
        UPDATE notification_preferences
        SET ${this.sql.raw(setClauses.join(', '))}
        WHERE id = ${id}
      `;

      // Re-read to return fully hydrated object
      const updated = await this.findByUserId(updates.userId || '', updates.tenantId);
      if (!updated) throw new Error('Preference not found after update');
      return updated;
    } catch (err) {
      console.error('[NotificationPreferenceRepository] Update failed for', id, ':', (err as Error)?.message);
      throw err;
    }
  }

  /**
   * Delete by ID
   */
  async delete(id: string): Promise<void> {
    try {
      await this.sql`
        DELETE FROM notification_preferences
        WHERE id = ${id}
      `;
    } catch (err) {
      console.error('[NotificationPreferenceRepository] Delete failed:', (err as Error)?.message);
      throw err;
    }
  }

  /**
   * Check if user already has a notification for this window
   */
  async findOverlappingNotification(
    userId: UserId,
    notificationKind: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<any> {
    try {
      const [row] = await this.sql`
        SELECT id FROM task_notifications
        WHERE 
          user_id = ${userId}
          AND notification_kind = ${notificationKind}
          AND window_start >= ${windowStart}
          AND window_end <= ${windowEnd}
        LIMIT 1
      ` as Array<{ id: string }>;

      return row; // null if not found
    } catch {
      return null;
    }
  }

  /**
   * Clean up old notifications weekly (maintenance)
   */
  async deleteOlderThan(days: number): Promise<number> {
    try {
      const [result] = await this.sql`
        DELETE FROM task_notifications
        WHERE window_end < ${new Date(Date.now() - days * 24 * 60 * 60 * 1000)}
      ` as Array<{ count: number }>;

      return result?.count || 0;
    } catch {
      return 0;
    }
  }
}