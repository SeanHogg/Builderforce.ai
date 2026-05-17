/**
 * Transactional email delivery via Resend.
 *
 * Uses direct fetch() for Cloudflare Worker compatibility — no npm wrapper.
 * getEmailProvider() returns null when RESEND_API_KEY is absent so callers
 * degrade gracefully instead of throwing.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

// ---------------------------------------------------------------------------
// Resend provider
// ---------------------------------------------------------------------------

class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: message.from ?? this.fromEmail,
        to: [message.to],
        subject: message.subject,
        html: message.html,
      }),
    });
    console.log(`[email:resend] status=${res.status} to=${message.to} subject="${message.subject}"`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email:resend] error: ${body}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type EmailEnv = {
  RESEND_API_KEY?: string;
  NOTIFICATION_EMAIL_FROM?: string;
};

function getEmailProvider(env: EmailEnv): EmailProvider | null {
  if (!env.RESEND_API_KEY) {
    console.warn('[email] Missing RESEND_API_KEY — email disabled');
    return null;
  }
  const from = env.NOTIFICATION_EMAIL_FROM ?? 'Builderforce <notifications@builderforce.ai>';
  return new ResendEmailProvider(env.RESEND_API_KEY, from);
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, val]) => acc.replaceAll(`{{${key}}}`, escapeHtml(val)),
    template,
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const HEADER = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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

const MAGIC_LINK_BODY = `
      <p>Hi {{RecipientName}},</p>
      <p>Click the button below to sign in to your Builderforce account.
         This link expires in <strong>15 minutes</strong> and can only be used once.</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="{{MagicUrl}}" class="button">Sign in to Builderforce</a>
      </p>
      <p style="font-size:13px; color:#64748b;">
        If you did not request this, you can safely ignore this email —
        the link will expire on its own.
      </p>`;

// ---------------------------------------------------------------------------
// Public send functions
// ---------------------------------------------------------------------------

export async function sendMagicLinkEmail(
  env: EmailEnv,
  to: string,
  name: string,
  magicUrl: string,
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const html = render(HEADER + MAGIC_LINK_BODY + FOOTER, {
    Subject: 'Your Builderforce sign-in link',
    RecipientName: name || to,
    MagicUrl: magicUrl,
    Year: String(new Date().getFullYear()),
  });

  await provider.send({ to, subject: 'Your Builderforce sign-in link', html });
}

const ADMIN_RESET_BODY = `
      <p>Hi,</p>
      <p>An administrator has reset access for your Builderforce account (<strong>{{Email}}</strong>).</p>
      <p>Click the button below to sign in. Once in, you can update your password from
         <strong>Settings → Account</strong>. This link expires in <strong>24 hours</strong>.</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="{{MagicUrl}}" class="button">Sign in to Builderforce</a>
      </p>
      <p style="font-size:13px; color:#64748b;">
        If you did not expect this, contact your administrator or reach out to support.
      </p>`;

export async function sendAdminPasswordResetEmail(
  env: EmailEnv,
  to: string,
  magicUrl: string,
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const html = render(HEADER + ADMIN_RESET_BODY + FOOTER, {
    Subject: 'Your Builderforce account access has been reset',
    Email: to,
    MagicUrl: magicUrl,
    Year: String(new Date().getFullYear()),
  });

  await provider.send({ to, subject: 'Your Builderforce account access has been reset', html });
}

// ---------------------------------------------------------------------------
// LLM vendor health alert — sent by the scheduled() cron when one or more
// vendors' status differs from the previous run. Plain string template (no
// HTML escaping issues since input is server-controlled vendor/model ids).
// ---------------------------------------------------------------------------

export interface LlmHealthChangeRow {
  vendor: string;
  previousStatus: string | null;
  currentStatus:  string;
  okCount:        number;
  failedCount:    number;
  probedCount:    number;
  failedModels:   string[]; // model ids that failed in this run
}

export async function sendLlmHealthAlertEmail(
  env: EmailEnv,
  to: string,
  changes: LlmHealthChangeRow[],
  timestampIso: string,
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const rows = changes.map((c) => {
    const transition = `${c.previousStatus ?? 'n/a'} → ${c.currentStatus}`;
    const failed = c.failedModels.length > 0
      ? `<br><span style="font-size:12px;color:#64748b">failed models: ${c.failedModels.map(escapeHtml).join(', ')}</span>`
      : '';
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(c.vendor)}</strong></td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(transition)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${c.okCount} / ${c.probedCount} ok${failed}</td>
      </tr>`;
  }).join('');

  const body = `
      <p>The daily LLM vendor health probe detected status changes for ${changes.length} vendor${changes.length === 1 ? '' : 's'}.</p>
      <p style="font-size:12px;color:#64748b">Run at ${escapeHtml(timestampIso)}</p>
      <table style="border-collapse:collapse;width:100%;margin-top:12px">
        <thead>
          <tr style="background:#f8fafc">
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0">Vendor</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0">Status</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0">Models</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:13px;color:#64748b;margin-top:20px">
        Review the per-model breakdown at <a href="https://builderforce.ai/admin?tab=usage">/admin?tab=usage</a>.
      </p>`;

  const subject = `[Builderforce] LLM vendor health changed — ${changes.map((c) => `${c.vendor}=${c.currentStatus}`).join(', ')}`;
  const html = render(HEADER + body + FOOTER, {
    Subject: subject,
    Year: String(new Date().getFullYear()),
  });

  await provider.send({ to, subject, html });
}
