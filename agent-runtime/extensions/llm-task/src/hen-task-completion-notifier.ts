import { EmailEnv } from "../../../api/src/infrastructure/email/EmailService.js";
import type { EmailNotifier, NotificationLogEntry } from "../transport/types.js";

// TODO: Replace with a proper logging mechanism (FR.5)
function logNotification(entry: NotificationLogEntry) {
  if (entry.success) {
    console.log(`[HenTaskNotifier] Email sent to ${entry.email} (Account: ${entry.accountId})`);
  } else {
    console.error(
      `[HenTaskNotifier] Failed to send email to ${entry.email} (Account: ${entry.accountId}): ${entry.errorMessage}`,
    );
  }
}

/**
 * Concrete implementation of EmailNotifier using the existing Resend EmailService.
 * This acts as an adapter for the domain's EmailNotifier port.
 */
export class ResendEmailNotifier implements EmailNotifier {
  private readonly fromEmail: string;

  constructor(
    private readonly apiKey: string,
    fromEmail?: string,
  ) {
    this.fromEmail = fromEmail ?? "Builderforce <notifications@builderforce.ai>";
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
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
      logNotification({
        accountId: "unknown", // Cannot resolve accountId here, will be logged in HenTaskCompletionNotifier
        email: to,
        subject,
        sentAt: new Date(),
        success: false,
        errorMessage: body,
      });
    }

    return success;
  }
}

// ---------------------------------------------------------------------------
// Template Helpers (Copied from api/src/infrastructure/email/EmailService.ts)
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, val]) => acc.replaceAll(`{{${key}}}`, escapeHtml(val)),
    template,
  );
}

const HEADER = `<!DOCTYPE html>
<html><head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
  <title>{{Subject}}</title>
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
  <div class=\"container\">
    <div class=\"header\">
      <h1>Builderforce</h1>
    </div>
    <div class=\"content\">`;

const FOOTER = `
    </div>
    <div class=\"footer\">
      <p>&copy; {{Year}} Builderforce. All rights reserved.</p>
    </div>
  </div>
</body></html>`;

const HEN_TASK_COMPLETION_BODY = `
      <p>Good news! All Hen tasks for your account are now complete.
         Log in to Builderforce to view details and next steps.
         Thank you for using our service!</p>
      <p style=\"text-align:center; margin: 28px 0;\">
        <a href=\"https://builderforce.ai\" class=\"button\">Log in to Builderforce</a>
      </p>
      <p style=\"font-size:13px; color:#64748b;\">
        This is an automated notification. Please do not reply.
      </p>`;

export type HenTaskCompletionNotifierConfig = {
  enabled: boolean;
  resendApiKey?: string;
  fromEmail?: string;
  platformName?: string;
  platformLoginUrl?: string;
  // TODO: Add logging mechanism here, for now it uses console.log/error
};

/**
 * Notifier service for Hen task completion.
 * Responsible for detecting when all Hen tasks for an account are complete
 * and orchestrating the email notification.
 * This is a domain service that uses the EmailNotifier port.
 */
export class HenTaskCompletionNotifier {
  private readonly emailNotifier: EmailNotifier;
  private readonly platformName: string;
  private readonly platformLoginUrl: string;
  private readonly enabled: boolean;

  constructor(
    emailNotifier: EmailNotifier,
    config: HenTaskCompletionNotifierConfig,
  ) {
    this.emailNotifier = emailNotifier;
    this.platformName = config.platformName ?? "Builderforce";
    this.platformLoginUrl = config.platformLoginUrl ?? "https://builderforce.ai";
    this.enabled = config.enabled;
  }

  async notify(accountId: string, accountEmail: string): Promise<boolean> {
    if (!this.enabled) {
      console.debug("[HenTaskNotifier] Notification disabled by config.");
      return false;
    }

    const subject = "Your Hen Tasks are Complete!";
    const body = HEN_TASK_COMPLETION_BODY.replaceAll("[Platform Name]", this.platformName);
    const html = render(HEADER + body + FOOTER, {
      Subject: subject,
      Year: String(new Date().getFullYear()),
      PlatformName: this.platformName,
      PlatformLoginUrl: this.platformLoginUrl,
    });

    const success = await this.emailNotifier.send(accountEmail, subject, html);

    logNotification({
      accountId,
      email: accountEmail,
      subject,
      sentAt: new Date(),
      success,
      errorMessage: success ? undefined : "Email sending failed",
    });

    return success;
  }
}
