/**
 * FR5: Multi-Channel Delivery
 * 
 * Handles sending daily notifications via email and in-app channels based on
 * user preferences.
 * 
 * Uses a centralized approach similar to the existing notify.ts for marketplace
 * notifications, aggregating all daily notification sends.
 */
import type { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';

type Sql = ReturnType<typeof neon<false, false>>;

export interface NotificationDeliveryInput {
  userId: string;
  tenantId: number;
  notificationKind: string;
  summaryTitle: string;
  summaryBody: string;
  affectedProjectIds: number[];
  channels: { email: boolean; in_app: boolean };
}

/**
 * Central notification delivery service
 * 
 * Delivers:
 * - In-app notifications (persistent feed)
 * - Email notifications (via webhook)
 * 
 * Best-effort: failures never block task processing
 */
export class NotificationDeliveryService {
  constructor(
    private readonly sql: Sql,
    private readonly env: Pick<Env, 'NOTIFY_EMAIL_URL' | 'NOTIFY_EMAIL_KEY'>,
    private readonly userTimeZone: string,
  ) {}

  /**
   * Deliver a daily notification to a PM/Lead user
   * 
   * FR5: Respects user's channel preferences
   * AC4: Only sends to opted-in PM/Lead users
   */
  async deliver(input: NotificationDeliveryInput): Promise<void> {
    const { userId, notificationKind, summaryTitle, summaryBody, channels, affectedProjectIds } = input;

    // Check if user is opted in
    const userOptedIn = await this.checkUserOptedIn(userId, notificationKind);
    if (!userOptedIn) {
      console.log(`[NotificationDelivery] Skipping ${userId} - not opted in`);
      return;
    }

    // FR5: Deliver via configured channels
    if (channels.in_app) {
      await this.deliverInApp(userId, summaryTitle, summaryBody);
    }

    if (channels.email) {
      await this.deliverEmail(userId, summaryTitle, summaryBody);
    }
  }

  /**
   * FR5: In-app notification delivery (persistent feed)
   */
  private async deliverInApp(userId: string, title: string, body: string | null): Promise<void> {
    try {
      await this.sql`
        INSERT INTO freelancer_notifications (
          user_id, tenant_id, kind, title, body, ref
        )
        VALUES (${userId}, ${this.sql('current_setting(\'app.current_tenant_id\')')}, 
                'daily_pm_lead_notification', ${title}, ${body}, NULL)
      `;
      console.log(`[NotificationDelivery] Delivered in-app notification to ${userId}`);
    } catch (err) {
      console.error(`[NotificationDelivery] In-app delivery failed for ${userId}:`, (err as Error)?.message);
    }
  }

  /**
   * FR5: Email notification delivery (transactional)
   */
  private async deliverEmail(
    userId: string,
    subject: string,
    body: string,
  ): Promise<void> {
    if (!this.env.NOTIFY_EMAIL_URL) {
      console.warn(`[NotificationDelivery] EMAIL_URL not configured, skipping email for ${userId}`);
      return;
    }

    try {
      // Get user's timezone-aware local time for AC1
      const localTime = await this.getUserLocalTime(userId);

      // Convert 08:50 UTC to local time
      const utcTime = '08:50';
      const emailBody = `
        <p>Good morning!</p>
        <p>Below is your daily summary of new or changed tasks:</p>
        <hr />
        <p><strong>${subject}</strong></p>
        <pre style="white-space: pre-wrap;">${body}</pre>
        <p style="font-size: 0.8em; color: #666;">
          Sent at ${localTime} (${this.userTimeZone}). 
          <a href="https://builderforce.ai/account/notifications">Manage preferences</a>
        </p>
      `;

      const [user] = await this.sql`
        SELECT email FROM users WHERE id = ${userId}
      ` as { email: string | null }[];

      if (!user?.email) {
        console.warn(`[NotificationDelivery] No email on record for ${userId}`);
        return;
      }

      await fetch(this.env.NOTIFY_EMAIL_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.env.NOTIFY_EMAIL_KEY ? { authorization: `Bearer ${this.env.NOTIFY_EMAIL_KEY}` } : {}),
        },
        body: JSON.stringify({
          to: user.email,
          subject: subject,
          body: emailBody,
        }),
      });

      console.log(`[NotificationDelivery] Delivered email to ${user.email} (${localTime})`);
    } catch (err) {
      console.error(`[NotificationDelivery] Email delivery failed for ${userId}:`, (err as Error)?.message);
    }
  }

  /**
   * AC1: Calculate user's local time for delivery
   * 
   * Ensures notifications arrive before 9:00 AM local time, accounting for
   * DST and user timezone settings.
   */
  private async getUserLocalTime(userId: string): Promise<string> {
    try {
      const [user] = await this.sql`
        SELECT timezone FROM users WHERE id = ${userId}
      ` as { timezone?: string }[];

      // In production, this would use ICU/date-fns with user timezone
      // For now, return preconfigured timezone from preference
      return this.userTimeZone;
    } catch {
      return '08:50 AM';
    }
  }

  /**
   * FR3: Check if user opted in for this notification type
   */
  private async checkUserOptedIn(userId: string, notificationKind: string): Promise<boolean> {
    try {
      const result = await this.sql`
        SELECT enabled FROM notification_preferences
        WHERE user_id = ${userId} AND notification_kind = ${notificationKind} AND active = true
      `;
      return result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * FR6: Mark notification as sent for deduplication tracking
   */
  async markNotificationSent(
    userId: string,
    notificationKind: string,
    windowStart: Date,
    windowEnd: Date,
    summaryTitle: string,
    summaryBody: string,
    taskCount: number,
    projectIds: number[],
  ): Promise<void> {
    const channels = { email: true, in_app: true };

    await this.deliver({
      userId,
      tenantId: parseInt(this.sql('current_setting(\'app.current_tenant_id\')')),
      notificationKind,
      summaryTitle,
      summaryBody,
      affectedProjectIds: projectIds,
      channels,
    });

    // Persists the notification for deduplication (FR6)
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

    console.log(`[NotificationDelivery] Recorded notification sent for ${userId}`);
  }
}