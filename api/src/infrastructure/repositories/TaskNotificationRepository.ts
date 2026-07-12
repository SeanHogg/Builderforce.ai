/**
 * Task notifications repository
 * 
 * Provides persistence layer for notification history, working with
 * the task_notifications table created in migration 0030_daily_notifications.sql.
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';
import type { EnvType } from '../database/connection';

import { ITaskNotificationRepository } from '../../domain/task_notifications/ITaskNotificationRepository';
import { TaskNotification } from '../../domain/task_notifications/TaskNotification';
import { UserId } from '../../domain/shared/types';
import type { TenantId } from '../../domain/shared/types';

type Sql = ReturnType<typeof neon<false, false>>;

/**
 * Repository implementation for task notification history (FR6)
 */
export class TaskNotificationRepository implements ITaskNotificationRepository {
  constructor(private readonly sql: Sql, private readonly env: EnvType) {}

  /**
   * Find by ID
   */
  async findById(id: string): Promise<TaskNotification | null> {
    try {
      const [row] = await this.sql`
        SELECT 
          id, tenant_id, user_id, notification_kind, scheduled_at,
          window_start, window_end, summary_title, summary_body, 
          task_count, channels, affected_projects, created_at
        FROM task_notifications
        WHERE id = ${id}
      ` as Array<{
        id: string;
        tenant_id: number;
        user_id: string;
        notification_kind: string;
        scheduled_at: Date;
        window_start: Date;
        window_end: Date;
        summary_title: string;
        summary_body: string | null;
        task_count: number;
        channels: string | null;
        affected_projects: string | null;
        created_at: Date;
      }>;

      return row
        ? TaskNotification.reconstitute({
            id: row.id,
            tenantId: row.tenant_id as TenantId,
            userId: row.user_id as UserId,
            notificationKind: row.notification_kind,
            scheduledAt: row.scheduled_at,
            windowStart: row.window_start,
            windowEnd: row.window_end,
            summaryTitle: row.summary_title,
            summaryBody: row.summary_body,
            taskCount: row.task_count,
            channels: row.channels ? JSON.parse(row.channels) : null,
            affectedProjects: row.affected_projects ? JSON.parse(row.affected_projects) : null,
            createdAt: row.created_at,
          })
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Insert a new notification record
   */
  async insert(notification: TaskNotification): Promise<TaskNotification> {
    try {
      const [row] = await this.sql`
        INSERT INTO task_notifications (
          id, tenant_id, user_id, notification_kind, scheduled_at,
          window_start, window_end, summary_title, summary_body, 
          task_count, channels, affected_projects, created_at
        ) VALUES (
          ${notification.id},
          ${notification.tenantId},
          ${notification.userId},
          ${notification.notificationKind},
          ${notification.scheduledAt},
          ${notification.windowStart},
          ${notification.windowEnd},
          ${notification.summaryTitle.substring(0, 255)},
          ${notification.summaryBody},
          ${notification.taskCount},
          ${JSON.stringify(notification.channels)},
          ${JSON.stringify(notification.affectedProjects)},
          ${notification.createdAt}
        )
        RETURNING 
          id, tenant_id, user_id, notification_kind, scheduled_at,
          window_start, window_end, summary_title, summary_body, 
          task_count, channels, affected_projects, created_at
      ` as Array<{
        id: string;
        tenant_id: number;
        user_id: string;
        notification_kind: string;
        scheduled_at: Date;
        window_start: Date;
        window_end: Date;
        summary_title: string;
        summary_body: string | null;
        task_count: number;
        channels: string | null;
        affected_projects: string | null;
        created_at: Date;
      }>;

      return TaskNotification.reconstitute({
        id: row.id,
        tenantId: row.tenant_id as TenantId,
        userId: row.user_id as UserId,
        notificationKind: row.notification_kind,
        scheduledAt: row.scheduled_at,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        summaryTitle: row.summary_title,
        summaryBody: row.summary_body,
        taskCount: row.task_count,
        channels: row.channels ? JSON.parse(row.channels) : null,
        affectedProjects: row.affected_projects ? JSON.parse(row.affected_projects) : null,
        createdAt: row.created_at,
      });
    } catch (err) {
      console.error('[TaskNotificationRepository] Insert failed:', (err as Error)?.message);
      throw err;
    }
  }

  /**
   * Find the most recent notification for a user
   */
  async findLatestByUser(userId: UserId, tenantId: TenantId): Promise<TaskNotification | null> {
    try {
      const [row] = await this.sql`
        SELECT 
          id, tenant_id, user_id, notification_kind, scheduled_at,
          window_start, window_end, summary_title, summary_body, 
          task_count, channels, affected_projects, created_at
        FROM task_notifications
        WHERE user_id = ${userId} AND tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT 1
      ` as Array<{
        id: string;
        tenant_id: number;
        user_id: string;
        notification_kind: string;
        scheduled_at: Date;
        window_start: Date;
        window_end: Date;
        summary_title: string;
        summary_body: string | null;
        task_count: number;
        channels: string | null;
        affected_projects: string | null;
        created_at: Date;
      }>;

      return row
        ? TaskNotification.reconstitute({
            id: row.id,
            tenantId: row.tenant_id as TenantId,
            userId: row.user_id as UserId,
            notificationKind: row.notification_kind,
            scheduledAt: row.scheduled_at,
            windowStart: row.window_start,
            windowEnd: row.window_end,
            summaryTitle: row.summary_title,
            summaryBody: row.summary_body,
            taskCount: row.task_count,
            channels: row.channels ? JSON.parse(row.channels) : null,
            affectedProjects: row.affected_projects ? JSON.parse(row.affected_projects) : null,
            createdAt: row.created_at,
          })
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Update a notification record
   */
  async update(id: string, updates: Partial<TaskNotification>): Promise<TaskNotification> {
    try {
      await this.sql`
        UPDATE task_notifications
        SET 
          summary_body = ${updates.summaryBody},
          task_count = ${updates.taskCount},
          channels = ${JSON.stringify(updates.channels)},
          affected_projects = ${JSON.stringify(updates.affectedProjects)},
          updated_at = ${Date.now()}
        WHERE id = ${id}
      `;
      return this.findById(id)!;
    } catch (err) {
      console.error('[TaskNotificationRepository] Update failed:', (err as Error)?.message);
      throw err;
    }
  }

  /**
   * Delete a notification record
   */
  async delete(id: string): Promise<void> {
    try {
      await this.sql`DELETE FROM task_notifications WHERE id = ${id}`;
    } catch (err) {
      console.error('[TaskNotificationRepository] Delete failed:', (err as Error)?.message);
      throw err;
    }
  }
}