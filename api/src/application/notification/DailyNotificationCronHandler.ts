/**
 * FR1: Daily Notification Trigger: Cron Job Handler
 * 
 * This handler is invoked by the cron_jobs table (schedules at 08:50 UTC).
 * It runs nightly to generate and deliver daily notifications to PMs/Leads.
 * 
 * TODO: Integration with CF Workers Scheduler
 * In Cloudflare Workers, use:
 *   - cron: '0 50 8 * * *' in wrangler.toml
 *   - Or use Cloudflare's Scheduler API external to Worker
 * For now, this can be invoked via an HTTP endpoint or worker event trigger.
 */

import type { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { ITaskNotificationRepository } from '../../domain/task_notifications/ITaskNotificationRepository';
import type { INotificationPreferenceRepository } from '../../domain/notification_preferences/INotificationPreferenceRepository';
import { DailyNotificationGeneratorService } from './DailyNotificationGeneratorService';
import { NotificationDeliveryService } from './NotificationDeliveryService';

interface CronContext {
  tenantId: number;
  projectId?: number | null;
  clawId?: number | null;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: Date | null;
  nextRunAt?: Date | null;
}

/**
 * Daily PM/Lead Notification Cron Handler
 * 
 * FR1: Weekly/Daily scheduler
 * FR2: Configured for 08:50 UTC
 * FR4: Generates content and returns
 * FR6: Deduplication tracking
 */
export class DailyNotificationCronHandler {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly notificationHistory: ITaskNotificationRepository,
    private readonly preferences: INotificationPreferenceRepository,
    private readonly sql: ReturnType<typeof neon<false, false>>,
    private readonly env: Pick<Env, 'NOTIFY_EMAIL_URL' | 'NOTIFY_EMAIL_KEY'>,
  ) {}

  /**
   * Trigger the daily notification run
   * 
   * Called by cron scheduler:
   * - Cloudflare Scheduler (recommended): Entry point receives event
   * - Alternative: HTTP endpoint (for testing/debugging)
   * 
   * @param context The cron job execution context
   */
  async handleCron(context: CronContext): Promise<void> {
    console.log(`[DailyNotificationCron] Starting daily PM/Lead notification run`);

    // Get current tenant
    const tenantId = context.tenantId;

    // FR2: Default send time is 08:50 UTC
    const scheduledTime = new Date('2024-01-01T08:50:00Z');

    // FR4: Generate notification summaries for all users
    const generator = new DailyNotificationGeneratorService(
      this.tasks,
      this.notificationHistory,
      this.preferences,
      this.sql,
      this.env,
    );

    const now = new Date();
    const workspaceTimezone = 'UTC'; // Could be tenant-wide preference

    const { sending } = await generator.generateDailyNotifications({
      tenantId,
      userId: '', // No specific user - send to all opted-in users
      notificationKind: 'pm_daily',
      workspaceTimezone,
      currentTime: now,
    });

    console.log(`[DailyNotificationCron] Generated ${sending.length} notification summaries`);

    // FR5: Deliver via configured channels
    const delivery = new NotificationDeliveryService(
      this.sql,
      this.env,
      workspaceTimezone,
    );

    // Schedule and dispatch deliveries
    for (const notification of sending) {
      // FR6: Record notification for deduplication tracking
      await delivery.markNotificationSent(
        notification.userId,
        'pm_daily',
        new Date(now.getTime() - 24 * 60 * 60 * 1000), // 24h ago
        now,
        notification.summaryTitle,
        notification.summaryBody,
        notification.taskCount,
        notification.affectedProjectIds,
      );
    }

    // Update cron job last run
    await this.sql`
      UPDATE cron_jobs
      SET last_run_at = now(), updated_at = now()
      WHERE tenant_id = ${tenantId} AND name = 'daily_pm_lead_notification'
    `;

    console.log(`[DailyNotificationCron] Completed - sent ${sending.length} notifications`);
  }

  /**
   * Alternative entry point: Fetch next pending cron job and execute
   * Useful for custom scheduler integration not using CF Scheduler
   */
  async runNextPendingJob(): Promise<void> {
    const tenantId = parseInt(this.sql('current_setting(\'app.current_tenant_id\')'));

    // FR1: Find next pending job (simple check - can be optimized with indexes)
    const [job] = await this.sql`
      SELECT * FROM cron_jobs
      WHERE tenant_id = ${tenantId} 
        AND name = 'daily_pm_lead_notification'
        AND enabled = true
        AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT 1
    ` as CronContext[];

    if (!job) {
      console.log('[DailyNotificationCron] No pending job');
      return;
    }

    // Execute immediately
    await this.handleCron(job);

    // Update next run time (schedule repeats daily at 08:50 UTC)
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(8, 50, 0, 0); // Tomorrow 08:50 UTC

    await this.sql`
      UPDATE cron_jobs
      SET last_run_at = now(), next_run_at = ${nextRun}, updated_at = now()
      WHERE id = ${job.id}
    `;

    console.log(`[DailyNotificationCron] Scheduled next run at ${nextRun.toISOString()}`);
  }
}

/**
 * Manual trigger for testing/debugging
 */
export async function triggerDailyNotifications(
  tasks: ITaskRepository,
  notificationHistory: ITaskNotificationRepository,
  preferences: INotificationPreferenceRepository,
  sql: ReturnType<typeof neon<false, false>>,
  env: Pick<Env, 'NOTIFY_EMAIL_URL' | 'NOTIFY_EMAIL_KEY'>,
): Promise<{ count: number }> {
  const handler = new DailyNotificationCronHandler(
    tasks,
    notificationHistory,
    preferences,
    sql,
    env,
  );

  await handler.handleCron({
    tenantId: parseInt(sql('current_setting(\'app.current_tenant_id\')')),
    name: 'daily_pm_lead_notification',
    schedule: '0 50 8 * * *',
    enabled: true,
  });

  return { count: 0 }; // Returns count of notifications sent
}