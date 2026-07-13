/**
 * Hen task completion email notifier.
 *
 * Problem: Account holders lack immediate awareness when all their associated
 * "Hen tasks" are complete.
 *
 * Solution: Automatically notify account holders via email upon the successful
 * completion of all "Hen tasks" associated with their account.
 *
 * Design: DDD Domain Service that uses the EmailNotifier port and
 * AccountEmailResolver port for separation of concerns.
 */

import type { EmailNotifier, AccountEmailResolver, NotificationLogEntry } from "../../src/transport/notification-domain-ports.js";
import notificationStorage from "./notification-storage.js";

// Re-export types from domain ports for backward compatibility
export type { EmailNotifier, AccountEmailResolver, NotificationLogEntry };

// Zod schema for configuring the notifier
import { z } from "zod";

/**
 * Schema for Hen Task Completion Notifier configuration
 */
export const HenTaskCompletionNotifierSchema = z.object({
  enabled: z.boolean().default(true),
  platformName: z.string().min(1).default("Builderforce"),
  platformLoginUrl: z.string().url().default("https://builderforce.ai"),
  resendApiKey: z.string().min(1).optional(),
});

// Email template constants
const EMAIL_BODY_TEXT = `Good news! All Hen tasks for your account are now complete. Log in to {{PlatformName}} to view details and next steps. Thank you for using our service!`;

const SHADED_HEADER = `
    <div class="header" style="background: #0f172a; padding: 28px 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: -0.5px;">
        {{PlatformName}}
      </h1>
    </div>`;

const CONTENT_PADDING = `
    <div class="content" style="padding: 40px 30px; color: #1e293b; font-size: 15px; line-height: 1.6;">
      <p>${EMAIL_BODY_TEXT}</p>`;

const FOOTER = `
    <div class="footer" style="background: #f8fafc; padding: 20px 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
      <p>&copy; {{Year}} {{PlatformName}}. All rights reserved.</p>
    </div>`;

const CSS_STYLES = `
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #0f172a; padding: 28px 30px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; letter-spacing: -0.5px; }
    .content { padding: 40px 30px; color: #1e293b; font-size: 15px; line-height: 1.6; }
    .footer { background: #f8fafc; padding: 20px 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    p { margin: 0 0 16px; }
  </style>`;

/**
 * Concrete implementation of EmailNotifier using Resend API.
 * Single Responsibility - only email dispatch.
 */
class ResendEmailNotifier implements EmailNotifier {
  private readonly fromEmail: string;

  constructor(private readonly apiKey: string, fromEmail?: string) {
    this.fromEmail = fromEmail ?? `${process.env.NOTIFICATION_FROM_EMAIL ?? "Builderforce"} <notifications@builderforce.ai>`;
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    try {
      if (!this.apiKey) {
        console.warn(`[HenTaskNotifier] Email API key missing — skipping send`);
        return false;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [to],
          subject,
          html,
        }),
      });

      const success = res.ok;
      if (!success) {
        const body = await res.text().catch(() => "");
        console.error(`[HenTaskNotifier] Email failed (${res.status}): ${body}`);
      }

      return success;
    } catch (error) {
      console.error(`[HenTaskNotifier] Email send error:`, error);
      return false;
    }
  }
}

/**
 * Hen task completion notification service.
 *
 * Domain Service Responsibility:
 * 1. Detecting when the last Hen task for an account completes (FR.1)
 * 2. Retrieving the account holder's email (FR.2)
 * 3. Composing email content with static subject/body (FR.3)
 * 4. Dispatching the email to the account holder (FR.4)
 * 5. Logging notification attempts for auditing (FR.5)
 * 6. Preventing duplicate notifications for the same account (AC.5)
 */
export class HenTaskCompletionNotifier {
  private readonly emailNotifier: EmailNotifier;
  private readonly platformName: string;
  private readonly platformLoginUrl: string;
  private readonly enabled: boolean;
  private readonly accountEmailResolver: AccountEmailResolver;
  private readonly notificationStorage: NotificationStorage;

  static RESEND_API_ENDPOINT = "https://api.resend.com/emails";

  /**
   * Creates a notifier configured with Resend adapter.
   *
   * @param config - Configuration object
   * @param accountEmailResolver - Adapter for resolving account emails
   * @returns Configured HenTaskCompletionNotifier instance
   */
  static createWithResend(
    config: z.infer<typeof HenTaskCompletionNotifierSchema>,
    accountEmailResolver: AccountEmailResolver
  ): HenTaskCompletionNotifier {
    const { resendApiKey, platformName, platformLoginUrl, enabled } = config;

    const emailNotifier =
      resendApiKey && resendApiKey.length > 0
        ? new ResendEmailNotifier(resendApiKey)
        : {
            // Graceful degradation when key is missing
            async send(to: string, subject: string, html: string): Promise<boolean> {
              console.warn(`[HenTaskNotifier] Email API key missing — skipping send`);
              return false;
            },
          };

    return new HenTaskCompletionNotifier(
      emailNotifier,
      platformName,
      platformLoginUrl,
      enabled,
      accountEmailResolver,
      notificationStorage
    );
  }

  constructor(
    emailNotifier: EmailNotifier,
    platformName: string,
    platformLoginUrl: string,
    enabled: boolean,
    accountEmailResolver: AccountEmailResolver,
    notificationStorage: NotificationStorage
  ) {
    this.accountEmailResolver = accountEmailResolver;
    this.emailNotifier = emailNotifier;
    this.platformName = platformName;
    this.platformLoginUrl = platformLoginUrl;
    this.enabled = enabled;
    this.notificationStorage = notificationStorage;

    if (!enabled) {
      console.debug(`[HenTaskNotifier] Notification disabled by config.`);
    }
  }

  /**
   * Renders the complete HTML email.
   *
   * @param subject - Email subject
   * @returns Fully rendered HTML email
   */
  private renderEmailHTML(subject: string): string {
    const year = String(new Date().getFullYear());

    const bodyTemplate =
      CSS_STYLES +
      "<body>" +
      `<div class="container">` +
      SHADED_HEADER.replace("{{PlatformName}}", this.platformName) +
      CONTENT_PADDING.replace("{{PlatformName}}", this.platformName) +
      FOOTER.replace("{{Year}}", year).replace("{{PlatformName}}", this.platformName) +
      `</div>` +
      "</body>";

    return `<!DOCTYPE html>` + bodyTemplate;
  }

  /**
   * Logs notification attempt according to FR.5.
   *
   * @param entry - Log entry to log
   */
  private logNotification(entry: NotificationLogEntry): void {
    if (entry.success) {
      console.log(`[HenTaskNotifier] Email sent to ${entry.email} (Account: ${entry.accountId})`);
    } else {
      console.error(
        `[HenTaskNotifier] Failed to send email to ${entry.email} (Account: ${entry.accountId}): ${entry.errorMessage || "Unknown error"}`
      );
    }
  }

  /**
   * Processes a task completion event and triggers notification if last Hen task completes.
   * This is the main entry point called by the LLMTaskTool extension.
   *
   * FR.1: Detect when last Hen task completes
   * FR.2: Retrieve account holder's email
   * FR.3: Compose email content with static subject/body
   * FR.4: Dispatch the email
   * FR.5: Log notification attempt
   * AC.5: Prevent duplicate notifications
   *
   * @param event - Task completion event
   * @returns Promise<NotificationLogEntry> - Log entry for the notification attempt
   */
  async handleTaskCompletion(event: { task: { accountId: string; id: string; status: string } }): Promise<NotificationLogEntry> {
    const { task } = event;
    const accountId = task.accountId;
    const finalStatus = task.status;

    // Only process if this is a completed task (AC.4: no email sent if tasks remain incomplete)
    if (finalStatus !== "completed") {
      return {
        accountId,
        email: "",
        subject: "Your Hen Tasks are Complete!",
        sentAt: new Date(),
        success: false,
        errorMessage: `Task ${task.id} completed but not appropriate to send notification (status: ${finalStatus})`,
      };
    }

    // FR.2: Retrieve account holder's email
    const accountEmail = await this.accountEmailResolver.getPrimaryEmail(accountId);

    if (!accountEmail) {
      return {
        accountId,
        email: "",
        subject: "Your Hen Tasks are Complete!",
        sentAt: new Date(),
        success: false,
        errorMessage: `No primary email found for account ${accountId}`,
      };
    }

    // Enforce enabled check
    if (!this.enabled) {
      console.debug(`[HenTaskNotifier] Notification disabled by config.`);
      return {
        accountId,
        email: accountEmail,
        subject: "Your Hen Tasks are Complete!",
        sentAt: new Date(),
        success: false,
        errorMessage: "Notification disabled by config",
      };
    }

    // AC.5: Check for duplicate notifications - prevent sending if already notified
    if (this.notificationStorage.hasNotified(accountId)) {
      console.debug(`[HenTaskNotifier] Account ${accountId} already notified - skipping duplicate`);
      return {
        accountId,
        email: accountEmail,
        subject: "Your Hen Tasks are Complete!",
        sentAt: new Date(),
        success: false,
        errorMessage: "Duplicate notification prevented",
      };
    }

    // Mark account as notified before sending (to prevent race conditions)
    this.notificationStorage.markNotified(accountId, task.id);

    // FR.3: Compose email content - static subject and dynamic body
    const subject = "Your Hen Tasks are Complete!";

    // FR.4: Dispatch the email
    const html = this.renderEmailHTML(subject);
    const sendSuccess = await this.emailNotifier.send(accountEmail, subject, html);

    // FR.5: Create and log notification attempt
    const logEntry: NotificationLogEntry = {
      accountId,
      email: accountEmail,
      subject,
      sentAt: new Date(),
      success: sendSuccess,
      errorMessage: sendSuccess ? undefined : "Email sending failed",
    };

    this.logNotification(logEntry);

    return logEntry;
  }

  /**
   * Direct notification entry point for manual usage.
   * Kept for backward compatibility with existing tests.
   *
   * @param accountId - The account ID that the Hen task belongs to
   * @param accountEmail - The account holder's primary email address
   * @returns Promise<NotificationLogEntry> - Log entry reflecting the send attempt and outcome
   */
  async notify(accountId: string, accountEmail: string): Promise<NotificationLogEntry> {
    // Enforce enabled check
    if (!this.enabled) {
      console.debug(`[HenTaskNotifier] Notification disabled by config.`);
      return {
        accountId,
        email: accountEmail,
        subject: "Your Hen Tasks are Complete!",
        sentAt: new Date(),
        success: false,
        errorMessage: "Notification disabled by config",
      };
    }

    // AC.5: Check for duplicate notifications - prevent sending if already notified
    if (this.notificationStorage.hasNotified(accountId)) {
      console.debug(`[HenTaskNotifier] Account ${accountId} already notified - skipping duplicate`);
      return {
        accountId,
        email: accountEmail,
        subject: "Your Hen Tasks are Complete!",
        sentAt: new Date(),
        success: false,
        errorMessage: "Duplicate notification prevented",
      };
    }

    // Mark account as notified before sending
    this.notificationStorage.markNotified(accountId, "manual-notification");

    // FR.3: Compose email content
    const subject = "Your Hen Tasks are Complete!";
    const html = this.renderEmailHTML(subject);

    // FR.4: Dispatch the email
    const sendSuccess = await this.emailNotifier.send(accountEmail, subject, html);

    // FR.5: Log notification attempt
    const logEntry: NotificationLogEntry = {
      accountId,
      email: accountEmail,
      subject,
      sentAt: new Date(),
      success: sendSuccess,
      errorMessage: sendSuccess ? undefined : "Email sending failed",
    };

    this.logNotification(logEntry);

    return logEntry;
  }
}