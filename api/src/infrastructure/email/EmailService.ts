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

const VERIFICATION_CODE_BODY = `
      <p>Hi {{RecipientName}},</p>
      <p>Welcome to Builderforce! Enter this code to confirm your email address
         and activate your account:</p>
      <p style="text-align:center; margin: 28px 0;">
        <span style="display:inline-block; font-family: 'Courier New', monospace;
                     font-size: 34px; font-weight: 700; letter-spacing: 10px;
                     color: #0f172a; background: #f1f5f9; border: 1px solid #e2e8f0;
                     border-radius: 10px; padding: 16px 28px;">{{Code}}</span>
      </p>
      <p>This code expires in <strong>15 minutes</strong>.</p>
      <p style="font-size:13px; color:#64748b;">
        If you did not create a Builderforce account, you can safely ignore this
        email — no account will be activated without this code.
      </p>`;

export async function sendVerificationCodeEmail(
  env: EmailEnv,
  to: string,
  name: string,
  code: string,
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const subject = `Your Builderforce verification code: ${code}`;
  const html = render(HEADER + VERIFICATION_CODE_BODY + FOOTER, {
    Subject: subject,
    RecipientName: name || to,
    Code: code,
    Year: String(new Date().getFullYear()),
  });

  await provider.send({ to, subject, html });
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

const WORKSPACE_INVITE_BODY = `
      <p>Hi,</p>
      <p><strong>{{InviterName}}</strong> invited you to join the
         <strong>{{WorkspaceName}}</strong> workspace on Builderforce as a
         <strong>{{Role}}</strong>.</p>
      <p>Builderforce.ai is your AI agent workforce — build, train and govern AI
         agents that ship code, run workflows and connect your systems.</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="{{SignupUrl}}" class="button">Accept your invitation</a>
      </p>
      <p style="font-size:13px; color:#64748b;">
        Sign up with this email address ({{Email}}) and you will join
        {{WorkspaceName}} automatically. If you were not expecting this, you can
        ignore this email.
      </p>`;

/**
 * Cold-invite email: tells someone with no Builderforce account that they were
 * invited to a workspace and links them to sign up with the invited address (so
 * the pending invitation auto-converts on first login). Best-effort — no-ops
 * when RESEND_API_KEY is unset, like the other senders.
 */
export async function sendWorkspaceInviteEmail(
  env: EmailEnv,
  to: string,
  opts: { workspaceName: string; inviterName: string; signupUrl: string; role: string },
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const subject = `${opts.inviterName} invited you to ${opts.workspaceName} on Builderforce`;
  const html = render(HEADER + WORKSPACE_INVITE_BODY + FOOTER, {
    Subject: subject,
    InviterName: opts.inviterName,
    WorkspaceName: opts.workspaceName,
    Role: opts.role,
    SignupUrl: opts.signupUrl,
    Email: to,
    Year: String(new Date().getFullYear()),
  });

  await provider.send({ to, subject, html });
}

const CHAT_INVITE_BODY = `
      <p>Hi,</p>
      <p><strong>{{InviterName}}</strong> invited you to collaborate on the chat
         <strong>{{ChatTitle}}</strong> in Builderforce.</p>
      <p>Open Builderforce to join the conversation, share ideas and work together
         with the team and its AI agents.</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="{{ChatUrl}}" class="button">Open the chat</a>
      </p>
      <p style="font-size:13px; color:#64748b;">
        Sign in with this email address ({{Email}}) to join. If you were not
        expecting this, you can ignore this email.
      </p>`;

/**
 * Chat-invite email: tells someone they were invited to collaborate on a Brain
 * chat. Best-effort — no-ops when RESEND_API_KEY is unset, like the other senders.
 */
export async function sendChatInviteEmail(
  env: EmailEnv,
  to: string,
  opts: { chatTitle: string; inviterName: string; chatUrl: string },
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const subject = `${opts.inviterName} invited you to a chat on Builderforce`;
  const html = render(HEADER + CHAT_INVITE_BODY + FOOTER, {
    Subject: subject,
    InviterName: opts.inviterName,
    ChatTitle: opts.chatTitle,
    ChatUrl: opts.chatUrl,
    Email: to,
    Year: String(new Date().getFullYear()),
  });

  await provider.send({ to, subject, html });
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

// ---------------------------------------------------------------------------
// Scheduled report digest — sent by the report-schedule dispatcher (runDueReports)
// for each due report_schedules row. Renders the report's summary/kpis object as
// a key/value table; values are server-generated but escaped defensively.
// ---------------------------------------------------------------------------

/** camelCase / snake_case key → spaced Title-ish label for the digest table. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export async function sendReportEmail(
  env: EmailEnv,
  to: string,
  subject: string,
  report: Record<string, unknown>,
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const kv = (report.summary ?? report.kpis ?? {}) as Record<string, unknown>;
  const rows = Object.entries(kv)
    .filter(([, v]) => v == null || typeof v !== 'object')
    .map(([k, v]) =>
      `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(humanizeKey(k))}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:right"><strong>${escapeHtml(String(v ?? '—'))}</strong></td>
      </tr>`)
    .join('');

  const body = `
      <p>Your scheduled <strong>${escapeHtml(String(report.reportType ?? 'report'))}</strong> report is ready.</p>
      ${rows
        ? `<table style="border-collapse:collapse;width:100%;margin-top:8px">${rows}</table>`
        : '<p style="color:#64748b">No data for this period.</p>'}
      <p style="text-align:center; margin: 24px 0 8px;">
        <a href="https://builderforce.ai/pmo" class="button">Open in Builderforce</a>
      </p>`;

  const html = render(HEADER + body + FOOTER, {
    Subject: subject,
    Year: String(new Date().getFullYear()),
  });

  await provider.send({ to, subject, html });
}
