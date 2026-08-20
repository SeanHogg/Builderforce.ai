import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Daily BYO credential sweep — proactively verifies every tenant's connected model
 * provider and tells its admins the first time one stops working.
 *
 * The gap this closes: credential health used to be observed ONLY as a side effect of
 * traffic. A workspace whose ChatGPT plan lapsed, whose API key was rotated, or whose
 * account ran out of credit kept showing "● connected" on Settings ▸ Integrations
 * indefinitely — the stored credential still decrypts, so nothing structural looked
 * wrong — while every run quietly failed over onto something else. Nobody was told, and
 * the owner's next discovery of the problem was a manual Test connection, if ever.
 *
 * So: probe on a schedule, not on hope.
 *
 *   for each tenant with ≥1 connected provider
 *     for each connected provider
 *       probeByoProvider()  ──►  persists / clears the ProviderAuthAlert
 *                                (the same verdict the Test button writes)
 *   newly-broken providers ──►  ONE email to the tenant's owners + managers
 *
 * Two properties keep this quiet enough to run every day:
 *
 *   • EMAIL ON TRANSITION, not on state. A provider that was already alerting yesterday
 *     produces no mail today — otherwise a workspace that stopped caring about a
 *     disconnected account gets a daily nag, and the mail stops being read exactly when
 *     it matters. Recovery is likewise silent: the card simply goes green again.
 *   • TRANSIENT FAILURES ARE NOT BREAKAGE. `probeByoProvider` records an alert only for
 *     owner-actionable causes (rejected credential, unentitled plan, exhausted budget,
 *     unresolvable stored secret). A 429 or a 502 leaves the previous verdict alone, so a
 *     provider having a bad ten minutes never mails anyone.
 *
 * Cost: one small upstream call per connected provider per tenant per day, billed to the
 * tenant's own account (that is the point — it proves THEIR credential works). Tenants
 * are processed with bounded concurrency and providers sequentially within a tenant.
 */

import { sql } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { notifyBrokenProviders } from './byoCredentialAlerting';
import type { ByoCredentialAlertRow } from '../../infrastructure/email/EmailService';
import { mapWithConcurrency } from '../runtime/boundedPool';
import { probeTenantByoProviders, probeTenantOpenRouterConnections } from './byoCredentialHealth';

/** How many tenants are probed concurrently. Each tenant's probes are sequential, so this
 *  bounds total in-flight upstream calls at the same number. Deliberately small: the
 *  sweep has a full day to finish and every call spends someone else's quota. */
const TENANT_CONCURRENCY = 4;

/** Safety valve on one sweep. Far above any plausible connected-tenant count today; it
 *  exists so an unbounded table can never turn one cron tick into an unbounded fan-out.
 *  A truncated sweep is LOGGED (never silently capped) so the ceiling is visible. */
const MAX_TENANTS_PER_SWEEP = 2000;

export interface ByoHealthSweepSummary {
  tenantsProbed: number;
  providersProbed: number;
  /** Providers that transitioned healthy → broken this run (what got emailed). */
  newlyBroken: number;
  /** Providers whose alert cleared because the probe succeeded. */
  recovered: number;
  emailed: number;
  truncated: boolean;
}

/**
 * Tenants with at least one rankable account of their own — the only ones with anything to
 * probe. The UNION is load-bearing: a tenant whose entire BYO setup is OpenRouter
 * connections has no `tenant_llm_provider_keys` row at all, so a provider-only scan swept
 * exactly the tenants that needed it least and skipped the ones with nothing but
 * connections. One indexed scan of each small table; no per-tenant round-trip.
 */
async function tenantsWithConnectedAccounts(db: ReturnType<typeof buildDatabase>): Promise<number[]> {
  const rows = (await db.execute(sql`
    SELECT tenant_id FROM tenant_llm_provider_keys
    UNION
    SELECT tenant_id FROM tenant_openrouter_connections
    ORDER BY tenant_id
    LIMIT ${MAX_TENANTS_PER_SWEEP + 1}
  `)).rows as Array<{ tenant_id: number }>;
  return rows.map((r) => Number(r.tenant_id));
}

/**
 * Probe one tenant's connected providers and report what changed. Returns the per-tenant
 * tallies the sweep summary rolls up.
 *
 * Note what this does NOT do: send mail per provider. `probeByoProvider` raises each alert
 * through {@link raiseProviderAuthAlert}, which already owns the transition rule and the
 * notification — the same rule a live run's cascade obeys. All this function adds is the
 * sweep's own framing: a workspace whose whole account set lapsed overnight gets ONE mail
 * listing every provider, rather than one mail per provider, so the batch is summarised
 * here and the per-alert notification is suppressed for that batch.
 *
 * Exported so a single tenant can be swept on demand (an operator tool, a test) without
 * standing up the whole cron.
 */
export async function runByoCredentialHealthForTenant(
  env: Env,
  tenantId: number,
): Promise<{ providersProbed: number; newlyBroken: number; recovered: number; emailed: number }> {
  const [providerProbes, connectionProbes] = await Promise.all([
    probeTenantByoProviders(env, tenantId, { notify: false }),
    // OpenRouter connections are rankable BYO with no provider row, so a provider-only sweep
    // left them permanently unverified — a revoked connection key stayed "connected" until
    // someone noticed their agents had quietly moved onto the operator pool.
    probeTenantOpenRouterConnections(env, tenantId, { notify: false }),
  ]);

  // TRANSITION, not state: only an account that has an alert NOW and had none before is
  // news. `previousAlert` was read before the probe wrote, so this comparison is honest.
  const newlyBroken: ByoCredentialAlertRow[] = [
    ...providerProbes
      .filter((p) => p.result.alert && !p.previousAlert)
      .map((p) => ({
        provider: p.result.provider,
        reason: p.result.alert!.reason,
        status: p.result.alert!.status,
        vendor: p.result.alert!.vendor,
        detail: p.result.error ?? '',
      })),
    // Named by LABEL: an operator holding several registrations must be told WHICH one
    // stopped working, and a bare "openrouter" would be true and useless.
    ...connectionProbes
      .filter((p) => p.result.alert && !p.previousAlert)
      .map((p) => ({
        provider: `OpenRouter · ${p.label}`,
        reason: p.result.alert!.reason,
        status: p.result.alert!.status,
        vendor: p.result.alert!.vendor,
        detail: p.result.error ?? '',
      })),
  ];
  const recovered = [...providerProbes, ...connectionProbes].filter((p) => p.result.ok && p.previousAlert).length;

  const notified = await notifyBrokenProviders(env, tenantId, newlyBroken);

  return {
    providersProbed: providerProbes.length + connectionProbes.length,
    newlyBroken: newlyBroken.length,
    recovered,
    emailed: notified.length,
  };
}

/**
 * Run one full sweep across every tenant with connected providers. Never throws: a single
 * tenant's failure is logged and skipped so the rest of the platform still gets checked.
 */
export async function runByoCredentialHealthCron(env: Env): Promise<ByoHealthSweepSummary> {
  const db = buildDatabase(env);
  const all = await tenantsWithConnectedAccounts(db);
  const truncated = all.length > MAX_TENANTS_PER_SWEEP;
  const tenantIds = truncated ? all.slice(0, MAX_TENANTS_PER_SWEEP) : all;
  if (truncated) {
    console.warn(`[cron:byo-health] tenant list truncated at ${MAX_TENANTS_PER_SWEEP} — ${all.length - MAX_TENANTS_PER_SWEEP}+ tenants NOT probed this run`);
  }

  const results = await mapWithConcurrency(tenantIds, TENANT_CONCURRENCY, (tenantId) =>
    runByoCredentialHealthForTenant(env, tenantId).catch((err) => {
      reportCaughtError(err, { source: "application/llm/byoCredentialHealthCron.ts", operation: "results", context: { logMessage: `[cron:byo-health] tenant=${tenantId} failed`, details: err } });
      return { providersProbed: 0, newlyBroken: 0, recovered: 0, emailed: 0 };
    }));

  const summary: ByoHealthSweepSummary = {
    tenantsProbed: tenantIds.length,
    providersProbed: results.reduce((n, r) => n + r.providersProbed, 0),
    newlyBroken: results.reduce((n, r) => n + r.newlyBroken, 0),
    recovered: results.reduce((n, r) => n + r.recovered, 0),
    emailed: results.reduce((n, r) => n + r.emailed, 0),
    truncated,
  };
  console.log(
    `[cron:byo-health] tenants=${summary.tenantsProbed} providers=${summary.providersProbed} ` +
    `newlyBroken=${summary.newlyBroken} recovered=${summary.recovered} emailed=${summary.emailed}`,
  );
  return summary;
}
