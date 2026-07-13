/**
 * Hen task completion email notifier.
 *
 * Problem: Account holders lack immediate awareness when all their associated
 * "Hen tasks" are complete.
 *
 * Solution: Automatically notify account holders via email upon the successful
 * completion of all "Hen tasks" associated with their account.
 *
 * Design: DDD Domain Service that uses the EmailNotifier port (defined in
 * src/transport/types.ts) to send emails. The port is implemented by the
 * ResendEmailNotifier adapter in the same file for simplicity.
 */

import type { EmailNotifier, AccountEmailResolver, NotificationLogEntry } from "../transport/types.js";

// Re-export types from domain port defined in agent-runtime/src/transport/types.ts
export type { EmailNotifier, AccountEmailResolver, NotificationLogEntry };

// Zod schema for configuring the notifier
import { z } from "zod";

export const HenTaskCompletionNotifierSchema = z.object({
  enabled: z.boolean().default(true),
  platformName: z.string().min(1).default("Builderforce"),
  platformLoginUrl: z.string().url().default("https://builderforce.ai"),
  resendApiKey: z.string().min(1).optional(),
});

// Template constants
const HEADER = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Hen Tasks are Complete!</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #0f172a; padding: 28px 30px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; letter-spacing: -0.5px; }
    .content { padding: 40px 30px; color: #1e293b; font-size: 15px; line-height: 1.6; }
    .button { display: inline-block; background: #6366f1; color: #ffffff !important;
              padding: 13px 28px; border-radius: 6px; text-decoration: none;
              font-weight: 600; font-size: 15px; margin: 8px 0; }
    .footer { background: #f8fafc; padding: 20px 30px; text-align: center;
              font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    p { margin: 0 0 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Builderforce</h1>
    </div>
    <div class="content">`;

const FOOTER = `
    </div>
    <div class="footer">
      <p>&copy; {{Year}} Builderforce. All rights reserved.</p>
    </div>
  </div>
</body></html>`;

const BODY_TEMPLATE = `      <p>Good news! All Hen tasks for your account are now complete.
         Log in to {{PlatformName}} to view details and next steps.
         Thank you for using our service!</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="{{PlatformLoginUrl}}" class="button">Log in to {{PlatformName}}</a>
      </p>`;

/**
 * Concrete implementation of EmailNotifier using Resend API.
 * Single Responsibility - only email dispatch.
 */
class ResendEmailNotifier implements EmailNotifier {
  private readonly fromEmail: string;

  constructor(private readonly apiKey: string, fromEmail?: string) {
    this.fromEmail = fromEmail ?? "Builderforce <notifications@builderforce.ai>";
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    try {
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
        console.error(`[HenTaskNotifier] Email failed: ${body}`);
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
 */
export class HenTaskCompletionNotifier {
  private readonly emailNotifier: EmailNotifier;
  private readonly platformName: string;
  private readonly platformLoginUrl: string;
  private readonly enabled: boolean;
  private readonly accountEmailResolver: AccountEmailResolver;

  // Factory helper to create a notifier with a Resend adapter and account resolver
  static createWithResend(
    config: z.infer<typeof HenTaskCompletionNotifierSchema>,
    accountEmailResolver: AccountEmailResolver
  ): HenTaskCompletionNotifier {
    const { resendApiKey, platformName, platformLoginUrl, enabled } = config;

    const emailNotifier =
      resendApiKey
        ? new ResendEmailNotifier(resendApiKey)
        : {
            // Graceful degradation when key is missing
            async send(to: string, subject: string, html: string): Promise<boolean> {
              console.warn("[HenTaskNotifier] Email API key missing — skipping send");
              return false;
            },
          };

    return new HenTaskCompletionNotifier(
      emailNotifier,
      platformName,
      platformLoginUrl,
      enabled,
      accountEmailResolver
    );
  }

  constructor(
    emailNotifier: EmailNotifier,
    platformName: string,
    platformLoginUrl: string,
    enabled: boolean,
    accountEmailResolver: AccountEmailResolver
  ) {
    this.accountEmailResolver = accountEmailResolver;
    this.emailNotifier = emailNotifier;
    this.platformName = platformName;
    this.platformLoginUrl = platformLoginUrl;
    this.enabled = enabled;

    if (!enabled) {
      console.debug("[HenTaskNotifier] Notification disabled by config.");
    }
  }

  /**
   * Process a task completion event and trigger notification if last Hen task complete.
   *
   * @param event - Task completion event
   * @returns Promise<NotificationLogEntry> - Log entry for the notification attempt
   */
  async handleTaskCompletion(event: { task: { accountId: string; id: string; status: string } }): Promise<NotificationLogEntry> {
    // FR.1: Detect when last Hen task completes
    const accountId = event.task.accountId;
    const taskId = event.task.id;
    const finalStatus = event.task.status;

    // Only process if this is a completed task
    if (finalStatus !== "completed") {
      return {
        accountId,
        email: "",
        subject: "Your Hen Tasks are Complete!",
        sentAt: new Date(),
        success: false,
        errorMessage: `Task ${taskId} completed but not appropriate to send notification (status: ${finalStatus})`,
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

    // FR.3: Compose email content
    const subject = "Your Hen Tasks are Complete!";

    if (!this.enabled) {
      console.debug("[HenTaskNotifier] Notification disabled by config.");
      return {
        accountId,
        email: accountEmail,
        subject,
        sentAt: new Date(),
        success: false,
        errorMessage: "Notification disabled by config",
      };
    }

    if (!this.emailNotifier) {
      return {
        accountId,
        email: accountEmail,
        subject,
        sentAt: new Date(),
        success: false,
        errorMessage: "Email notifier not configured",
      };
    }

    // Generate HTML email content
    const bodyHtml = BODY_TEMPLATE
      .replace("{{PlatformName}}", this.platformName)
      .replace("{{PlatformLoginUrl}}", this.platformLoginUrl);

    const html = this.renderEmail(subject, bodyHtml);

    // FR.4: Dispatch the email
    const sendSuccess = await this.emailNotifier.send(accountEmail, subject, html);

    const logEntry: NotificationLogEntry = {
      accountId,
      email: accountEmail,
      subject,
      sentAt: new Date(),
      success: sendSuccess,
      errorMessage: sendSuccess ? undefined : "Email sending failed",
    };

    // FR.5: Log notification attempt
    this.logNotification(logEntry);

    return logEntry;
  }

  /**
   * Main notification method for direct calls.
   * Kept for backward compatibility with existing tests.
   *
   * @param accountId - The account ID that the Hen task belongs to
   * @param accountEmail - The account holder's primary email address
   * @returns A NotificationLogEntry reflecting the send attempt and outcome
   */
  async notify(accountId: string, accountEmail: string): Promise<NotificationLogEntry> {
    const subject = "Your Hen Tasks are Complete!";

    if (!this.enabled) {
      console.debug("[HenTaskNotifier] Notification disabled by config.");
      return {
        accountId,
        email: accountEmail,
        subject,
        sentAt: new Date(),
        success: false,
        errorMessage: "Notification disabled by config",
      };
    }

    if (!this.emailNotifier) {
      return {
        accountId,
        email: accountEmail,
        subject,
        sentAt: new Date(),
        success: false,
        errorMessage: "Email notifier not configured",
      };
    }

    // Generate HTML email content
    const bodyHtml = BODY_TEMPLATE
      .replace("{{PlatformName}}", this.platformName)
      .replace("{{PlatformLoginUrl}}", this.platformLoginUrl);

    const html = this.renderEmail(subject, bodyHtml);

    // Attempt to send
    const success = await this.emailNotifier.send(accountEmail, subject, html);

    const logEntry: NotificationLogEntry = {
      accountId,
      email: accountEmail,
      subject,
      sentAt: new Date(),
      success,
      errorMessage: success ? undefined : "Email sending failed",
    };

    // Log the notification attempt (FR.5)
    this.logNotification(logEntry);

    return logEntry;
  }

  /**
   * Renders the complete HTML email with header, body, and footer.
   */
  private renderEmail(subject: string, body: string): string {
    return `${HEADER}${body}${FOOTER}`.replace("{{Subject}}", subject).replace("{{Year}}", String(new Date().getFullYear()));
  }

  /**
   * Logs notification attempt (FR.5).
   */
  private logNotification(entry: NotificationLogEntry): void {
    if (entry.success) {
      console.log(
        `[HenTaskNotifier] Email sent to ${entry.email} (Account: ${entry.accountId})`
      );
    } else {
      console.error(
        `[HenTaskNotifier] Failed to send email to ${entry.email} (Account: ${entry.accountId}): ${entry.errorMessage || "Unknown error"}`
      );
    }
  }
}