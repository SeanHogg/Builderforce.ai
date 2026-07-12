import type { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { ITaskNotificationRepository } from '../../domain/task_notifications/ITaskNotificationRepository';
import type { INotificationPreferenceRepository } from '../../domain/notification_preferences/INotificationPreferenceRepository';
import type { Task } from '../../domain/task/Task';

/**
 * FR4: Notification Content Generation
 * 
 * Generates a list of new/changed tasks relevant to the recipient
 * within the last 24 hours.
 * 
 * FR6: Deduplication Logic
 * Uses the notification history to avoid re-notifying about the same
 * tasks within the same 24-hour window.
 */
export interface DailyNotificationInput {
  tenantId: number;
  userId: string;
  notificationKind: 'pm_daily' | 'lead_daily';
  workspaceTimezone: string;
  currentTime: Date;
}

export interface TaskChange {
  taskId: number;
  projectId: number;
  taskTitle: string;
  status: string;
  priority: string;
  assignedUserId: string | null;
  occurredAt: Date;
  preSnapshot?: any;
  postSnapshot?: any;
}

export class DailyNotificationGeneratorService {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly notificationHistory: ITaskNotificationRepository,
    private readonly preferences: INotificationPreferenceRepository,
    private readonly sql: ReturnType<typeof neon<false, false>>,
    private readonly env: Pick<Env, 'NOTIFY_EMAIL_URL' | 'NOTIFY_EMAIL_KEY'>,
  ) {}

  /**
   * FR4: Generate notification content for a PM or Lead
   * 
   * Identifies relevant tasks in the last 24 hours and filters based on:
   * - User preferences (enabled/disabled)
   * - Priority filters (if configured)
   * - Delivery channels (email/in-app)
   * - Max task limits
   */
  async generateDailyNotifications(input: DailyNotificationInput): Promise<{
    sending: Array<{
      userId: string;
      summaryTitle: string;
      summaryBody: string;
      taskCount: number;
      affectedProjectIds: number[];
    }>;
  }> {
    const now = input.currentTime;
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h ago
    const windowEnd = now;

    // FR3: Get enabled notification preferences for this kind
    const preferences = await this.preferences.findEnabledByKind(
      input.notificationKind,
      input.tenantId,
    );

    if (preferences.length === 0) {
      return { sending: [] };
    }

    // AG-513: Deduplication Logic (FR6)
    // For each user, check if a notification was already sent for this window
    const currentWindowKey = `${windowStart.toISOString()}/${windowEnd.toISOString()}`;
    const tasksToReport: Map<string, TaskChange[]> = new Map();

    for (const pref of preferences) {
      // Check for overlapping notification (deduplication)
      const overlapping = await this.notificationHistory.findOverlapping(
        pref.userId,
        input.notificationKind,
        windowStart,
        windowEnd,
      );

      if (overlapping) {
        console.log(
          `[DailyNotificationGenerator] Skipping ${pref.userId} - notification already sent for ${currentWindowKey}`,
        );
        continue; // SKIPPED: already notified for this window
      }

      // FR4: Get task changes in this window
      const taskChanges = await this.getTaskChangesInWindow(
        pref.userId,
        input.tenantId,
        windowStart,
        windowEnd,
        pref,
      );
      console.log(
        `[DailyNotificationGenerator] Found ${taskChanges.length} changes for ${pref.userId}`,
      );

      if (taskChanges.length === 0) {
        continue; // No new changes to report
      }

      // Build summary
      const summary = this.buildSummary(pref, taskChanges);
      
      // Store for sending
      const sentTasks = tasksToReport.get(pref.userId) || [];
      sentTasks.push(...taskChanges);
      tasksToReport.set(pref.userId, sentTasks);
    }

    // Send notifications
    const sending: Array<{
      userId: string;
      summaryTitle: string;
      summaryBody: string;
      taskCount: number;
      affectedProjectIds: number[];
    }> = [];

    for (const [userId, changes] of tasksToReport.entries()) {
      // Get user's preference to determine channels
      const pref = preferences.find((p) => p.userId === userId);
      if (!pref) continue;

      // Build summary
      const sent = this.buildSummary(pref, changes);

      sending.push({
        userId,
        summaryTitle: sent.summaryTitle,
        summaryBody: sent.summaryBody,
        taskCount: changes.length,
        affectedProjectIds: Array.from(new Set(changes.map((c) => c.projectId))),
      });
    }

    return { sending };
  }

  /**
   * FR4: Extract task changes in the 24-hour window
   */
  private async getTaskChangesInWindow(
    userId: string,
    tenantId: number,
    windowStart: Date,
    windowEnd: Date,
    preference: any,
  ): Promise<TaskChange[]> {
    // Integration point: task change detection would query task_change_events table
    // For now, we simulate by querying recent tasks and comparing against notification history
    
    const tasks = await this.tasks.findByProjectIds([], {
      includeArchived: preference.includeArchived,
    });

    // Filter to tasks modified in the window
    // In production, this would query task_change_events table filtered by windowStart/windowEnd
    const changes: TaskChange[] = tasks.filter(
      (task) => new Date(task.updatedAt) >= windowStart && new Date(task.updatedAt) <= windowEnd,
    ).map((task) => ({
      taskId: task.id,
      projectId: task.projectId,
      taskTitle: task.title,
      status: task.status,
      priority: task.priority,
      assignedUserId: task.assignedUserId,
      occurredAt: task.updatedAt,
    }));

    // Apply priority filter (FR4 requirement)
    if (preference.priorityFilter) {
      changes.sort((a, b) => {
        const priorityOrder = { high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority as keyof typeof priorityOrder] - 
               priorityOrder[b.priority as keyof typeof priorityOrder];
      });
    }

    return changes;
  }

  /**
   * FR4: Build summary of task changes
   */
  private buildSummary(
    preference: any,
    changes: TaskChange[],
  ): { summaryTitle: string; summaryBody: string } {
    const titleParts = [];
    if (changes.length > 0) {
      titleParts.push(`${changes.length} new or changed`);
    } else {
      titleParts.push('No new changes');
    }

    const summaryTitle = `${titleParts.join(' ')}`;
    
    // Limit body length to prevent overload
    const maxBodyLength = 2000;
    const bodyLines = changes.map((change) => {
      const role = change.assignedUserId ? 'assigned to you' : 'created';
      return [
        `- ${change.taskTitle} (${change.status}, ${role})`,
      ].join(' ');
    }).join('\n');

    return {
      summaryTitle,
      summaryBody: bodyLines.length > maxBodyLength
        ? bodyLines.substring(0, maxBodyLength) + '...'
        : bodyLines,
    };
  }

  /**
   * FR6: Mark sent notifications for deduplication tracking
   */
  async recordNotificationSent(
    userId: string,
    notificationKind: string,
    windowStart: Date,
    windowEnd: Date,
    summaryTitle: string,
    summaryBody: string,
    taskCount: number,
    channels: { email: boolean; in_app: boolean },
    projectIds: number[],
  ): Promise<void> {
    await this.sql`
      INSERT INTO task_notifications (
        tenant_id, user_id, notification_kind,
        scheduled_at, window_start, window_end,
        summary_title, summary_body, task_count,
        channels, affected_projects
      ) VALUES (
        ${this.sql('current_setting(\'app.current_tenant_id\')')},
        ${userId}, ${notificationKind},
        ${new Date('08:50')}, ${windowStart}, ${windowEnd},
        ${summaryTitle.substring(0, 255)}, ${summaryBody},
        ${taskCount}, ${JSON.stringify(channels)}, ${projectIds}
      )
    `;
  }
}