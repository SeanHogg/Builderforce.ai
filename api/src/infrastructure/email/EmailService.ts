/**
 * Transactional email delivery via Resend.
 *
 * Uses direct fetch() for Cloudflare Worker compatibility — no npm wrapper.
 * getEmailProvider() returns null when RESEND_API_KEY is absent so callers
 * degrade gracefully instead of throwing.
 *
 * LOCALIZATION: every template here is rendered from the shared server-side
 * catalog in ./emailMessages — no template holds its own copy, in any language.
 * Each sender takes a trailing `locale` and defaults it to English, so a caller
 * that has not yet been threaded through the resolver keeps today's behaviour
 * exactly. The locale itself is never decided here: callers get it from
 * `application/email/sendEmail`, which is the single seam that also decides
 * whether a send is transactional or lifecycle.
 */

import { emailCopy, type EmailCopy, type NextStepsCopy } from './emailMessages';
import { DEFAULT_EMAIL_LOCALE, type EmailLocale } from './emailLocale';

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

/**
 * Substitute placeholders into a CATALOG string without escaping.
 *
 * Catalog copy intentionally contains markup (`<strong>`), so it cannot go through
 * `render()`'s escaping pass — that would print the tags. Values passed here are
 * therefore escaped INDIVIDUALLY by the caller, or are server-controlled counts.
 * Recipient-supplied values (names, workspace titles) must always be left as
 * `{{Placeholder}}` for the outer `render()` call to escape instead of being
 * interpolated here.
 */
function fill(copy: string, vars: Record<string, string | number> = {}): string {
  return Object.entries(vars).reduce(
    (acc, [key, val]) => acc.replaceAll(`{{${key}}}`, String(val)),
    copy,
  );
}

/** Wraps every paragraph of body copy identically so templates stay declarative. */
function p(copy: string, style?: string): string {
  return `\n      <p${style ? ` style="${style}"` : ''}>${copy}</p>`;
}

/** The muted small print used for "you can ignore this" notes across templates. */
const MUTED = 'font-size:13px; color:#64748b;';

/** A centred call-to-action button. */
function cta(href: string, label: string): string {
  return `
      <p style="text-align:center; margin: 28px 0;">
        <a href="${href}" class="button">${label}</a>
      </p>`;
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

const HEADER = `<!DOCTYPE html>
<html lang="{{Lang}}"><head>
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

/**
 * The footer. `unsubscribeUrl` is supplied ONLY for lifecycle mail (see
 * `application/email/sendEmail`) — a transactional mail must not show an opt-out,
 * so the argument being absent is what enforces that, not a per-template decision.
 */
function footer(copy: EmailCopy, unsubscribeUrl?: string): string {
  const optOut = unsubscribeUrl
    ? `
      <p>${copy.common.unsubscribeLine}
         <a href="${unsubscribeUrl}" style="color:#64748b">${copy.common.unsubscribeLabel}</a>.</p>`
    : '';
  return `
    </div>
    <div class="footer">
      <p>${copy.common.footerRights}</p>${optOut}
    </div>
  </div>
</body></html>`;
}

/** The greeting — named when we know who they are, anonymous when we do not. */
function greeting(copy: EmailCopy, named: boolean): string {
  return p(named ? copy.common.greeting : copy.common.greetingAnonymous);
}

/**
 * Assemble + send one message. Every sender funnels through here so the chrome,
 * the `{{Subject}}` / `{{Year}}` / `{{Lang}}` substitution and the provider no-op
 * are written exactly once.
 */
async function deliver(
  env: EmailEnv,
  args: {
    to: string;
    subject: string;
    body: string;
    locale: EmailLocale;
    copy: EmailCopy;
    vars?: Record<string, string>;
    unsubscribeUrl?: string;
  },
): Promise<void> {
  const provider = getEmailProvider(env);
  if (!provider) return;

  const html = render(HEADER + args.body + footer(args.copy, args.unsubscribeUrl), {
    Subject: args.subject,
    Lang: args.locale,
    Year: String(new Date().getFullYear()),
    ...args.vars,
  });

  await provider.send({ to: args.to, subject: args.subject, html });
}

// ---------------------------------------------------------------------------
// Public send functions
// ---------------------------------------------------------------------------

/** Append the landing anon-id (`aid`) to a signup/sign-in URL when present, so a
 *  cross-device email-link open (start on phone, click link on desktop) can adopt
 *  the originating device's anon id and reunite the pre-signup session. No-op when
 *  anonId is absent — fully backward compatible. */
export function appendAnonId(url: string, anonId?: string | null): string {
  if (!anonId) return url;
  return `${url}${url.includes('?') ? '&' : '?'}aid=${encodeURIComponent(anonId)}`;
}

/** TRANSACTIONAL — the user just asked to sign in. No opt-out. */
export async function sendMagicLinkEmail(
  env: EmailEnv,
  to: string,
  name: string,
  magicUrl: string,
  anonId?: string | null,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);
  const body = greeting(copy, true)
    + p(copy.magicLink.intro)
    + cta('{{MagicUrl}}', copy.magicLink.cta)
    + p(copy.magicLink.ignoreNote, MUTED);

  await deliver(env, {
    to,
    subject: copy.magicLink.subject,
    body,
    locale,
    copy,
    vars: { RecipientName: name || to, MagicUrl: appendAnonId(magicUrl, anonId) },
  });
}

/** TRANSACTIONAL — the user just requested the code. No opt-out. */
export async function sendVerificationCodeEmail(
  env: EmailEnv,
  to: string,
  name: string,
  code: string,
  // Accepted for signature parity with sendMagicLinkEmail (the auth start handlers
  // thread the landing anon-id through both paths). The code-entry email carries no
  // link, so there is no URL to attach `aid` to today — kept for a future link-based
  // verify flow and so callers can pass it uniformly.
  _anonId?: string | null,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);
  const subject = fill(copy.verificationCode.subject, { Code: code });

  const body = greeting(copy, true)
    + p(copy.verificationCode.intro)
    + `
      <p style="text-align:center; margin: 28px 0;">
        <span style="display:inline-block; font-family: 'Courier New', monospace;
                     font-size: 34px; font-weight: 700; letter-spacing: 10px;
                     color: #0f172a; background: #f1f5f9; border: 1px solid #e2e8f0;
                     border-radius: 10px; padding: 16px 28px;">{{Code}}</span>
      </p>`
    + p(copy.verificationCode.expiry)
    + p(copy.verificationCode.ignoreNote, MUTED);

  await deliver(env, {
    to,
    subject,
    body,
    locale,
    copy,
    vars: { RecipientName: name || to, Code: code },
  });
}

/** The two account shapes a user can hold — mirrors `users.account_type`. */
export type AccountType = 'standard' | 'freelancer';

/**
 * Renders the shared next-steps list + CTA for an account type. The COPY lives in
 * the catalog (`emailMessages.nextSteps`), authored once per account type and read
 * by both the welcome email (when the role is known at signup) and the
 * account-type-selected email (when it is picked later) — in every locale. Never
 * re-inline this copy in a second template: the two emails must not drift apart,
 * and now they cannot drift per-language either.
 *
 * Emits `{{AppUrl}}` rather than a concrete origin so the caller's `render()` pass
 * does the substitution (and the HTML escaping) uniformly.
 *
 * Every `path` here is a real, reachable route: the builder set matches the
 * standard app shell, the freelancer set matches FOR_HIRE_NAV_GROUPS (the
 * restricted shell a gig account is actually allowed to reach). Paths are NOT
 * localized — they are routes, not copy — which is why they live here and not in
 * the catalog.
 */
const NEXT_STEPS_PATH: Record<AccountType, string> = {
  standard: '/dashboard',
  freelancer: '/freelancer/profile',
};

function nextStepsBlock(plan: NextStepsCopy, accountType: AccountType): string {
  const items = plan.steps
    .map((s) => `        <li style="margin-bottom: 8px;"><strong>${s.label}</strong> — ${s.detail}</li>`)
    .join('\n');

  return p(plan.headline)
    + `
      <ul style="margin: 0 0 16px; padding-left: 20px;">
${items}
      </ul>`
    + cta(`{{AppUrl}}${NEXT_STEPS_PATH[accountType]}`, plan.ctaLabel);
}

/**
 * TRANSACTIONAL — sent exactly once, when a user account is first created, from
 * every signup path (OAuth/social, verified password signup, marketplace). Linking
 * a new provider to an existing account is NOT a signup and must not trigger it.
 * The recipient just created the account, so no opt-out applies.
 *
 * `accountType` is optional because the two signup shapes differ: a password /
 * marketplace signup picks its role on the register form, so the welcome can
 * carry the role-specific next steps immediately. An OAuth signup has no role
 * yet — it gets the role-agnostic variant here, and the next steps follow from
 * sendAccountTypeSelectedEmail() once the onboarding gate captures the choice.
 * That split is what keeps any one user from receiving two near-identical mails.
 */
export async function sendWelcomeEmail(
  env: EmailEnv,
  to: string,
  name: string,
  appBaseUrl: string,
  accountType?: AccountType,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);

  const roleBody = accountType
    ? nextStepsBlock(copy.nextSteps[accountType], accountType)
    : p(copy.welcome.roleUnknownBody)
      + p(copy.welcome.roleUnknownPrompt)
      + cta('{{AppUrl}}/dashboard', copy.welcome.roleUnknownCta);

  const body = greeting(copy, true)
    + p(copy.welcome.intro)
    + roleBody
    + p(copy.common.supportLine, MUTED);

  await deliver(env, {
    to,
    subject: copy.welcome.subject,
    body,
    locale,
    copy,
    vars: { RecipientName: name || to, AppUrl: appBaseUrl },
  });
}

/**
 * TRANSACTIONAL — sent when a user makes the one-time Build-vs-Hired choice (the
 * onboarding gate for OAuth / magic-link accounts, which had no role at signup).
 * Carries the next steps for the role they picked, and is a direct response to
 * their action. Not sent for a password signup — that role is known at register
 * time and its welcome already carried these steps.
 */
export async function sendAccountTypeSelectedEmail(
  env: EmailEnv,
  to: string,
  name: string,
  appBaseUrl: string,
  accountType: AccountType,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);
  const isFreelancer = accountType === 'freelancer';

  const subject = isFreelancer
    ? copy.accountTypeSelected.subjectFreelancer
    : copy.accountTypeSelected.subjectStandard;

  const body = greeting(copy, true)
    + p(isFreelancer ? copy.accountTypeSelected.introFreelancer : copy.accountTypeSelected.introStandard)
    + nextStepsBlock(copy.nextSteps[accountType], accountType)
    + p(copy.common.supportLine, MUTED);

  await deliver(env, {
    to,
    subject,
    body,
    locale,
    copy,
    vars: { RecipientName: name || to, AppUrl: appBaseUrl },
  });
}

/** TRANSACTIONAL — account access. Suppressing this would lock the user out. */
export async function sendAdminPasswordResetEmail(
  env: EmailEnv,
  to: string,
  magicUrl: string,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);
  const body = greeting(copy, false)
    + p(copy.adminReset.body)
    + p(copy.adminReset.instructions)
    + cta('{{MagicUrl}}', copy.adminReset.cta)
    + p(copy.adminReset.note, MUTED);

  await deliver(env, {
    to,
    subject: copy.adminReset.subject,
    body,
    locale,
    copy,
    vars: { Email: to, MagicUrl: magicUrl },
  });
}

/**
 * TRANSACTIONAL — cold-invite email: tells someone with no Builderforce account
 * that a HUMAN invited them to a workspace, and links them to sign up with the
 * invited address (so the pending invitation auto-converts on first login). A
 * person-to-person invitation is a relationship message, not marketing.
 * Best-effort — no-ops when RESEND_API_KEY is unset, like the other senders.
 */
export async function sendWorkspaceInviteEmail(
  env: EmailEnv,
  to: string,
  opts: {
    workspaceName: string;
    inviterName: string;
    signupUrl: string;
    role: string;
    locale?: EmailLocale;
  },
): Promise<void> {
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const copy = emailCopy(locale);

  const body = greeting(copy, false)
    + p(copy.workspaceInvite.body)
    + p(copy.workspaceInvite.pitch)
    + cta('{{SignupUrl}}', copy.workspaceInvite.cta)
    + p(copy.workspaceInvite.note, MUTED);

  await deliver(env, {
    to,
    subject: render(copy.workspaceInvite.subject, {
      InviterName: opts.inviterName,
      WorkspaceName: opts.workspaceName,
    }),
    body,
    locale,
    copy,
    vars: {
      InviterName: opts.inviterName,
      WorkspaceName: opts.workspaceName,
      Role: opts.role,
      SignupUrl: opts.signupUrl,
      Email: to,
    },
  });
}

/**
 * TRANSACTIONAL — chat-invite email: a human invited this person to collaborate on
 * a Brain chat. Best-effort — no-ops when RESEND_API_KEY is unset.
 */
export async function sendChatInviteEmail(
  env: EmailEnv,
  to: string,
  opts: { chatTitle: string; inviterName: string; chatUrl: string; locale?: EmailLocale },
): Promise<void> {
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const copy = emailCopy(locale);

  const body = greeting(copy, false)
    + p(copy.chatInvite.body)
    + p(copy.chatInvite.pitch)
    + cta('{{ChatUrl}}', copy.chatInvite.cta)
    + p(copy.chatInvite.note, MUTED);

  await deliver(env, {
    to,
    subject: render(copy.chatInvite.subject, { InviterName: opts.inviterName }),
    body,
    locale,
    copy,
    vars: {
      InviterName: opts.inviterName,
      ChatTitle: opts.chatTitle,
      ChatUrl: opts.chatUrl,
      Email: to,
    },
  });
}

// ---------------------------------------------------------------------------
// LLM vendor health alert — sent by the scheduled() cron when one or more
// vendors' status differs from the previous run. TRANSACTIONAL: an operational
// alert to a configured on-call address, not a message the recipient can opt out
// of without also opting out of being on call.
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
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);

  const rows = changes.map((c) => {
    const transition = `${c.previousStatus ?? 'n/a'} → ${c.currentStatus}`;
    const failed = c.failedModels.length > 0
      ? `<br><span style="font-size:12px;color:#64748b">${copy.llmHealth.failedModels} `
        + `${c.failedModels.map(escapeHtml).join(', ')}</span>`
      : '';
    const okOf = fill(copy.llmHealth.okOfProbed, { Ok: c.okCount, Probed: c.probedCount });
    return `
      <tr>
        <td style="${TD}"><strong>${escapeHtml(c.vendor)}</strong></td>
        <td style="${TD}">${escapeHtml(transition)}</td>
        <td style="${TD}">${escapeHtml(okOf)}${failed}</td>
      </tr>`;
  }).join('');

  const headers = [copy.llmHealth.columnVendor, copy.llmHealth.columnStatus, copy.llmHealth.columnModels]
    .map((h) => `<th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(h)}</th>`)
    .join('');

  const body = p(fill(copy.llmHealth.intro, { Count: changes.length }))
    + p(escapeHtml(fill(copy.llmHealth.runAt, { Timestamp: timestampIso })), 'font-size:12px;color:#64748b')
    + `
      <table style="border-collapse:collapse;width:100%;margin-top:12px">
        <thead>
          <tr style="background:#f8fafc">${headers}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
    + p(
      `${copy.llmHealth.reviewLine} <a href="https://builderforce.ai/admin?tab=usage">/admin?tab=usage</a>.`,
      'font-size:13px;color:#64748b;margin-top:20px',
    );

  // The subject stays machine-shaped (vendor=status) on purpose: it is an ops
  // alert that gets grepped, routed and deduped by tooling, so it must not vary
  // by the recipient's language.
  const subject = `[Builderforce] LLM vendor health changed — ${changes.map((c) => `${c.vendor}=${c.currentStatus}`).join(', ')}`;

  await deliver(env, { to, subject, body, locale, copy });
}

// ---------------------------------------------------------------------------
// Scheduled report digest — sent by the report-schedule dispatcher (runDueReports)
// for each due report_schedules row. TRANSACTIONAL: the recipient (or their admin)
// configured this schedule; it stops by deleting the schedule, not by unsubscribing.
// Renders the report's summary/kpis object as a key/value table; values are
// server-generated but escaped defensively.
// ---------------------------------------------------------------------------

/** camelCase / snake_case key → spaced Title-ish label for the digest table.
 *  Used ONLY for data-derived summary keys, which cannot be pre-translated —
 *  see the note in emailMessages.ts. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Present a cell value: round floats, blank-dash nullish, escape everything. */
function cell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return escapeHtml(Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
  return escapeHtml(String(v));
}

const TH = 'text-align:left;padding:6px 12px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b';
const TD = 'padding:6px 12px;border-bottom:1px solid #e2e8f0';

/** A key/value summary table (the legacy digest body; reused as one section). */
function renderKvTable(kv: Record<string, unknown>): string {
  const rows = Object.entries(kv)
    .filter(([, v]) => v == null || typeof v !== 'object')
    .map(([k, v]) =>
      `<tr>
        <td style="${TD}">${escapeHtml(humanizeKey(k))}</td>
        <td style="${TD};text-align:right"><strong>${cell(v)}</strong></td>
      </tr>`)
    .join('');
  return rows ? `<table style="border-collapse:collapse;width:100%;margin-top:8px">${rows}</table>` : '';
}

/** A titled table over an array of row objects, projecting the given columns. */
function renderObjectTable(title: string, items: Array<Record<string, unknown>>, columns: Array<[key: string, label: string]>): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const head = columns.map(([, label]) => `<th style="${TH}">${escapeHtml(label)}</th>`).join('');
  const body = items.slice(0, 25).map((row) =>
    `<tr>${columns.map(([key]) => `<td style="${TD}">${cell(row[key])}</td>`).join('')}</tr>`).join('');
  return `
      <p style="margin:22px 0 6px;font-weight:600">${escapeHtml(title)}</p>
      <table style="border-collapse:collapse;width:100%">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>`;
}

/** A simple bulleted list section (e.g. standup insights). */
function renderBullets(title: string, items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lis = items.filter((x) => typeof x === 'string').map((x) => `<li>${escapeHtml(String(x))}</li>`).join('');
  return lis ? `<p style="margin:22px 0 6px;font-weight:600">${escapeHtml(title)}</p><ul style="margin:0;padding-left:20px;color:#334155">${lis}</ul>` : '';
}

/**
 * Type-specific rich sections appended below the summary. Each known report_type
 * renders its arrays as tables/lists; unknown types add nothing (backward-compat —
 * they still get the summary kv table from the caller). Section titles and column
 * headers come from the catalog, so a German recipient gets German headers over
 * the same (untranslatable) data.
 */
function renderReportSections(report: Record<string, unknown>, copy: EmailCopy): string {
  const arr = (k: string) => (Array.isArray(report[k]) ? (report[k] as Array<Record<string, unknown>>) : []);
  const r = copy.report;
  const col = r.columns;
  switch (report.reportType) {
    case 'project_status':
      return renderObjectTable(r.sectionProjects, arr('projects'), [
        ['name', col.project], ['verdict', col.status], ['deployments', col.deploys],
        ['changeFailureRatePct', col.changeFailureRate], ['leadTimeHours', col.leadTime],
        ['reworkRatePct', col.rework], ['stuckCount', col.stuck],
      ]);
    case 'portfolio_rollup':
      return renderObjectTable(r.sectionPortfolios, arr('portfolios'), [
        ['name', col.portfolio], ['status', col.status], ['completedTasks', col.done], ['openTasks', col.open],
        ['agentLlmCostUsd', col.aiSpend], ['okrProgressPct', col.okrProgress], ['blockedInitiatives', col.blocked],
      ]);
    case 'completed_by_assignee':
      return renderObjectTable(r.sectionAssignees, arr('assignees'), [
        ['assigneeName', col.assignee], ['assigneeKind', col.kind], ['completed', col.completed],
      ]);
    case 'standup':
      return renderObjectTable(r.sectionRecentPrs, arr('recentPrs'), [['title', col.title], ['repo', col.repo]])
        + renderBullets(r.sectionInsights, report.insights);
    case 'code_review':
      return renderObjectTable(r.sectionStalePrs, arr('stalePrList'), [
        ['title', col.title], ['repo', col.repo], ['ageHours', col.age],
      ]);
    default:
      return '';
  }
}

export async function sendReportEmail(
  env: EmailEnv,
  to: string,
  subject: string,
  report: Record<string, unknown>,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);

  const kv = (report.summary ?? report.kpis ?? {}) as Record<string, unknown>;
  const summaryTable = renderKvTable(kv);
  const sections = renderReportSections(report, copy);

  const reportType = escapeHtml(humanizeKey(String(report.reportType ?? 'report')));
  const body = p(fill(copy.report.intro, { ReportType: reportType }))
    + (summaryTable || (sections ? '' : p(copy.report.noData, 'color:#64748b')))
    + sections
    + `
      <p style="text-align:center; margin: 24px 0 8px;">
        <a href="https://builderforce.ai/pmo" class="button">${copy.report.cta}</a>
      </p>`;

  await deliver(env, { to, subject, body, locale, copy });
}

// ---------------------------------------------------------------------------
// Weekly release digest — sent by the Friday cron (runWeeklyReleaseDigest) with
// every published-and-not-yet-emailed release note. LIFECYCLE (product_updates):
// the caller goes through sendLifecycleEmail, which checked consent and supplies
// the unsubscribeUrl this template is obliged to render.
// ---------------------------------------------------------------------------

/** One announcement in the digest — mirrors the `release_notes` wire shape. */
export interface ReleaseDigestItem {
  version: string;
  title: string;
  body: string | null;
  /** 'new' | 'improvement' | 'fix'; unknown values fall back to 'improvement'. */
  category: string;
}

/** Badge colors per category — inline (email clients ignore <style> classes). */
const DIGEST_BADGE: Record<'new' | 'improvement' | 'fix', string> = {
  new: 'background:#eef2ff;color:#4338ca;',
  improvement: 'background:#ecfdf5;color:#047857;',
  fix: 'background:#fffbeb;color:#b45309;',
};

export async function sendReleaseDigestEmail(
  env: EmailEnv,
  to: string,
  name: string | null,
  items: ReleaseDigestItem[],
  appBaseUrl: string,
  unsubscribeUrl: string,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = emailCopy(locale);

  // Titles/bodies are operator-authored marketing data (same untranslated-data
  // boundary as the report digest) — escaped here, never re-escaped by render().
  const sections = items.map((item) => {
    const category = (item.category in DIGEST_BADGE ? item.category : 'improvement') as keyof typeof DIGEST_BADGE;
    const badge = `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.4px;`
      + `text-transform:uppercase;border-radius:9999px;padding:2px 10px;${DIGEST_BADGE[category]}">`
      + `${copy.releaseDigest.categories[category]}</span>`;
    const paragraphs = (item.body ?? '')
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((para) => `<p style="margin:0 0 10px;color:#334155">${escapeHtml(para)}</p>`)
      .join('');
    return `
      <div style="margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid #e2e8f0">
        <p style="margin:0 0 6px">${badge}
          <span style="font-size:12px;color:#94a3b8;margin-left:6px">v${escapeHtml(item.version)}</span></p>
        <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#0f172a">${escapeHtml(item.title)}</p>
        ${paragraphs}
      </div>`;
  }).join('');

  const body = greeting(copy, Boolean(name))
    + p(fill(copy.releaseDigest.intro, { Count: items.length }))
    + sections
    + cta(`{{AppUrl}}/?whatsnew=1`, copy.releaseDigest.cta)
    + p(copy.releaseDigest.outro, MUTED);

  await deliver(env, {
    to,
    subject: copy.releaseDigest.subject,
    body,
    locale,
    copy,
    vars: { RecipientName: name || to, AppUrl: appBaseUrl },
    unsubscribeUrl,
  });
}
