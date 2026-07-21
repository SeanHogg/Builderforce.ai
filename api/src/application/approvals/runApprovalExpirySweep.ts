/**
 * runApprovalExpirySweep — expire pending approvals past their deadline and alert.
 *
 * This used to be `GET /api/approvals/escalate`, an HTTP endpoint authenticated by a
 * `CRON_SECRET` query param and "intended to be called by a Cloudflare Cron Trigger".
 * Nothing ever called it: no `[triggers]` cron maps to a URL (Cloudflare crons invoke
 * the `scheduled()` handler, not a route), no GitHub Action hit it, and `CRON_SECRET`
 * had no value set anywhere. So the sweep was unreachable code guarded by a secret
 * whose absence made the endpoint an unauthenticated bulk-mutate hole.
 *
 * That mattered more once agent questions started carrying an `expiresAt`
 * (CLOUD_QUESTION_ESCALATE_AFTER_MS): the escalation half of the ask_human timeout
 * story was pointing at a sweep no scheduler ran. It now runs natively on the `*​/5`
 * tick alongside every other sweep — one cron pattern, no shared secret to leak or
 * forget, and no public endpoint that mutates every tenant's approvals.
 *
 * Tenant-agnostic by design: it selects across all tenants in ONE query rather than
 * looping per tenant, then groups in memory for the notification fan-out.
 */
import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { approvals } from '../../infrastructure/database/schema';
import { sendSlackNotification } from '../approval/approvalNotifier';

export interface ApprovalExpiryResult {
  /** Approvals moved pending → expired this pass. */
  escalated: number;
  /** Distinct tenants that had at least one expiry (i.e. were notified). */
  tenants: number;
}

export async function runApprovalExpirySweep(env: Env, db: Db): Promise<ApprovalExpiryResult> {
  const now = new Date();

  const expired = await db
    .select()
    .from(approvals)
    .where(and(
      eq(approvals.status, 'pending'),
      lt(approvals.expiresAt, now),
    ));

  if (expired.length === 0) return { escalated: 0, tenants: 0 };

  // Re-apply the same predicate on the UPDATE rather than keying off the ids just
  // read: a row answered between the select and the update must NOT be clobbered
  // back to `expired`, and the predicate makes that race impossible.
  await db
    .update(approvals)
    .set({ status: 'expired', updatedAt: now })
    .where(and(
      eq(approvals.status, 'pending'),
      lt(approvals.expiresAt, now),
    ));

  const byTenant = new Map<number, typeof expired>();
  for (const a of expired) {
    const list = byTenant.get(a.tenantId) ?? [];
    list.push(a);
    byTenant.set(a.tenantId, list);
  }

  if (env.SLACK_APPROVAL_WEBHOOK_URL) {
    for (const [, list] of byTenant) {
      const lines = list.map((a) => `• *${a.actionType}* — ${a.description}`).join('\n');
      // Best-effort: a webhook outage must not abort the sweep or leave the rows
      // half-expired — the status change is already committed above.
      await sendSlackNotification(
        env.SLACK_APPROVAL_WEBHOOK_URL,
        `:warning: *${list.length} approval request(s) expired without review:*\n${lines}`,
      ).catch(() => { /* notification is advisory; expiry already persisted */ });
    }
  }

  return { escalated: expired.length, tenants: byTenant.size };
}
