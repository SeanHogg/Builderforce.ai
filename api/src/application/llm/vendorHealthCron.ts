/**
 * Scheduled vendor-health runner — called by the Cloudflare Worker
 * `scheduled()` handler. Probes every registered vendor, persists each result,
 * compares against the previous persisted status, and emails superadmins when
 * a vendor's status changed.
 *
 * Designed to be idempotent and email-quiet: a stable "ok" vendor produces a
 * new row each run but no email.
 */

import { sql } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import {
  sendLlmHealthAlertEmail,
  type EmailEnv,
  type LlmHealthChangeRow,
} from '../../infrastructure/email/EmailService';
import { users } from '../../infrastructure/database/schema';
import { eq } from 'drizzle-orm';
import { persistProbe } from '../../presentation/routes/adminRoutes';
import {
  probeVendor,
  type VendorProbeResult,
} from './vendorHealthProbe';
import { getAllVendorIds, type VendorEnv, type VendorId } from './vendors';

export interface CronEnv extends VendorEnv, EmailEnv {
  NEON_DATABASE_URL: string;
}

/** Fetch the most recent prior status per vendor. Returns `null` for vendors with no history yet. */
async function loadPreviousStatusByVendor(db: ReturnType<typeof buildDatabase>): Promise<Map<VendorId, string>> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (vendor) vendor, status
    FROM llm_health_probes
    ORDER BY vendor, created_at DESC
  `)).rows as Array<{ vendor: string; status: string }>;
  return new Map(rows.map((r) => [r.vendor as VendorId, r.status]));
}

/** Comma-separated explicit override; falls back to all DB superadmins. */
async function resolveAlertRecipients(
  db: ReturnType<typeof buildDatabase>,
  overrideCsv: string | undefined,
): Promise<string[]> {
  if (overrideCsv && overrideCsv.trim().length > 0) {
    return overrideCsv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.isSuperadmin, true));
  return rows.map((r) => r.email).filter((e): e is string => !!e);
}

/**
 * Run one full health-probe sweep. Probes every vendor, persists, and emails
 * superadmins for any vendor whose status differs from its previous persisted
 * value. `LLM_HEALTH_ALERT_RECIPIENTS` (CSV) overrides the DB-derived list.
 */
export async function runVendorHealthCron(env: CronEnv & { LLM_HEALTH_ALERT_RECIPIENTS?: string }): Promise<{
  results: VendorProbeResult[];
  changes: LlmHealthChangeRow[];
  emailed: number;
}> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);

  const [previousByVendor, results] = await Promise.all([
    loadPreviousStatusByVendor(db),
    Promise.all(getAllVendorIds().map((v) => probeVendor(env, v))),
  ]);

  for (const r of results) {
    await persistProbe(db, r, 'cron');
  }

  const changes: LlmHealthChangeRow[] = [];
  for (const r of results) {
    const prev = previousByVendor.get(r.vendor) ?? null;
    if (prev === r.status) continue;
    changes.push({
      vendor:         r.vendor,
      previousStatus: prev,
      currentStatus:  r.status,
      okCount:        r.okCount,
      failedCount:    r.failedCount,
      probedCount:    r.probedCount,
      failedModels:   r.models.filter((m) => !m.ok).map((m) => m.model),
    });
  }

  let emailed = 0;
  if (changes.length > 0) {
    const recipients = await resolveAlertRecipients(db, env.LLM_HEALTH_ALERT_RECIPIENTS);
    const ts = new Date().toISOString();
    await Promise.all(recipients.map((to) => sendLlmHealthAlertEmail(env, to, changes, ts)));
    emailed = recipients.length;
  }

  console.log(
    `[cron:llm-health] probed=${results.length} changes=${changes.length} emailed=${emailed}`,
  );

  return { results, changes, emailed };
}
