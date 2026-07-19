/**
 * pendingAgentsUpgradeEmail — the "you have agents waiting but you're out of
 * tokens" nudge sent by {@link runAutonomousExecutionSweep} when a tenant's
 * autonomous work is paused purely for lack of budget.
 *
 * This is the growth-loop counterpart to the token gate: instead of silently not
 * running a tenant's board, we tell their managers exactly how many agents are
 * queued and point them at the upgrade page. Deduped to at most once per UTC day
 * per tenant (KV-backed, same namespace the read-through cache uses) so a tenant
 * sitting at their cap all day gets one reminder, not one every cron tick.
 *
 * Best-effort throughout: no email config, no recipients, or a send failure never
 * throws — the sweep keeps going.
 */
import type { Db } from '../../infrastructure/database/connection';
import { getManagerEmails, sendEmailNotification } from '../approval/approvalNotifier';
import { utcDayStart } from '../llm/tokenUsage';
import type { TokenExhaustionReason } from '../llm/tenantTokenAvailability';
import type { Env } from '../../env';

export interface PendingAgentsUpgradeArgs {
  tenantId: number;
  /** How many agent-owned tickets are queued but blocked on tokens. */
  pendingAgents: number;
  reason: TokenExhaustionReason | null;
  effectivePlan: 'free' | 'pro' | 'teams';
}

/** KV dedupe key — one send per tenant per UTC day. */
export function upgradeEmailDedupeKey(tenantId: number, now: Date = new Date()): string {
  const day = utcDayStart(now).toISOString().slice(0, 10); // YYYY-MM-DD
  return `auto-exec:upgrade-emailed:${tenantId}:${day}`;
}

/** The upgrade line tuned to why they're blocked + what plan they're on. */
export function buildUpgradeCopy(args: Pick<PendingAgentsUpgradeArgs, 'pendingAgents' | 'reason' | 'effectivePlan'>): {
  subject: string;
  intro: string;
  upgradeHint: string;
} {
  const n = args.pendingAgents;
  const agents = n === 1 ? '1 agent is' : `${n} agents are`;
  const window = args.reason === 'monthly_exhausted' ? 'monthly' : 'daily';
  const subject = `${n} ${n === 1 ? 'agent is' : 'agents are'} waiting — you're out of ${window} tokens`;
  const intro = `${agents} queued and ready to run on your boards, but execution is paused because your ${window} token budget is used up.`;
  const upgradeHint = args.effectivePlan === 'free'
    ? 'Upgrade to Pro for a much higher token budget and keep your agents working around the clock.'
    : args.effectivePlan === 'pro'
      ? 'Upgrade to Teams for an even higher budget so your agents never wait.'
      : 'Your budget resets automatically — or contact us to raise your limit so your agents never wait.';
  return { subject, intro, upgradeHint };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Send the nudge once per UTC day. Returns true only when an email was actually
 * dispatched (config present, recipients found, not already sent today).
 */
export async function sendPendingAgentsUpgradeEmail(env: Env, db: Db, args: PendingAgentsUpgradeArgs): Promise<boolean> {
  if (args.pendingAgents <= 0) return false;
  if (!env.RESEND_API_KEY || !env.NOTIFICATION_EMAIL_FROM) return false;

  // Per-day dedupe. When KV is unbound (local/dev) we fall through and always send;
  // production always has AUTH_CACHE_KV bound.
  const kv = env.AUTH_CACHE_KV;
  const key = upgradeEmailDedupeKey(args.tenantId);
  if (kv) {
    const already = await kv.get(key).catch(() => null);
    if (already) return false;
  }

  const emails = await getManagerEmails(db, args.tenantId);
  if (emails.length === 0) return false;

  const { subject, intro, upgradeHint } = buildUpgradeCopy(args);
  const pricingUrl = `${env.APP_URL ?? 'https://builderforce.ai'}/pricing`;
  const boardUrl = `${env.APP_URL ?? 'https://builderforce.ai'}/tasks`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
      <h2 style="margin:0 0 12px">${escapeHtml(String(args.pendingAgents))} ${args.pendingAgents === 1 ? 'agent is' : 'agents are'} waiting to work</h2>
      <p style="color:#444;line-height:1.5">${escapeHtml(intro)}</p>
      <p style="color:#444;line-height:1.5">${escapeHtml(upgradeHint)}</p>
      <p style="margin:20px 0">
        <a href="${pricingUrl}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Upgrade &amp; resume agents</a>
      </p>
      <p style="color:#888;font-size:13px"><a href="${boardUrl}" style="color:#888">View your boards</a></p>
    </div>`;

  await sendEmailNotification(env.RESEND_API_KEY, env.NOTIFICATION_EMAIL_FROM, emails, subject, html);

  if (kv) {
    // Expire the flag shortly after UTC midnight so tomorrow's block re-nudges.
    await kv.put(key, '1', { expirationTtl: 60 * 60 * 26 }).catch(() => { /* best-effort */ });
  }
  return true;
}
