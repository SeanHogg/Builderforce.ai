/**
 * INSTALL ANALYTICS — what a publisher gets to know about their own packages.
 *
 * PRD 24's incentives ledger lists "install analytics the vendor cannot get
 * elsewhere" as one of the seven things we pay a publisher in. It is a real
 * incentive: a vendor who ships an adapter into somebody else's platform normally
 * learns nothing about it — not how many workspaces run it, not which version
 * they are on, not whether it is erroring.
 *
 * ═══ THE PRIVACY BOUNDARY, DECIDED AND WRITTEN DOWN ═════════════════════════
 *
 * **A publisher never learns WHICH workspace installed their package. Every read
 * in this module is an aggregate over non-tenant dimensions, and there is no
 * parameter, no flag and no scope that turns that off.**
 *
 * The reasoning, in the order it actually matters:
 *
 *   1. NO GRANT SAYS OTHERWISE. `EXTENSION_SCOPES` is the complete vocabulary an
 *      install can consent to, and not one of its seven entries means "tell the
 *      publisher who I am". So there is no install on the platform whose admin
 *      has agreed to be identified, and disclosing identity would be disclosing
 *      something nobody was asked about. The task of deciding this boundary is
 *      therefore already answered by the consent screen: it does not offer it, so
 *      it has not been given.
 *
 *   2. THE ONLY CROSS-TENANT REASON THAT FITS FORBIDS IT. A publisher reading
 *      installs is reading other tenants' rows, and `CrossTenantReason` is a
 *      closed set. `platform_admin` is a superadmin surface; `public_catalogue`
 *      is about rows published FOR strangers, which an install is not;
 *      `subject_own_rows` is about the caller's own rows, which these are not.
 *      What is left is `platform_aggregate`, and its contract is explicit — "use
 *      this ONLY when the select list contains no tenant-owned column, and never
 *      to fetch rows". So the boundary is enforced by the guard's own vocabulary
 *      rather than by a reviewer remembering: a query here that selected a tenant
 *      id would have no honest reason to name.
 *
 *   3. THE SANDBOX IS EXCLUDED for the same honesty reason. A review install
 *      lasts a few seconds and is removed; counting it would report one workspace
 *      that never existed and immediately churned — churn manufactured by our own
 *      pipeline.
 *
 * If an operator later wants identified installs, the change is NOT a flag here.
 * It is a new scope in `EXTENSION_SCOPES`, which appears on the consent screen,
 * which an admin approves per install — and then this module can report identity
 * for exactly those installs and no others. That is a product decision with a
 * user-visible consent step, which is what makes it a decision rather than a
 * setting.
 *
 * ── ERRORS ATTRIBUTABLE TO THE PACKAGE ──────────────────────────────────────
 * `connector_call_logs` already records every connector call with its
 * `connector_key`, `ok`, `status_code` and `error`. A published connector's
 * manifest key is unique platform-wide (`packageReview`'s `reserved_key` check
 * plus the tenant-authored precedence rule in `connectorRegistry`), so grouping
 * that table by key and status IS the publisher's error rate — no new table, no
 * new write path, and the same rows the tenant's own diagnostics read. The
 * aggregation drops the tenant, per the boundary above.
 */

import { eq, gte, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  connectorCallLogs,
  extensionPackages,
  extensionVersions,
  tenantExtensionInstalls,
  tenants,
} from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { requirePublisher } from './publishers';
import { catalogVersion } from './extensionRepository';
import { REVIEW_SANDBOX_SLUG } from './reviewSandbox';

/** How far back the series run. Ninety days is one quarter, which is the unit a
 *  vendor reports their own adoption in. */
export const ANALYTICS_WINDOW_DAYS = 90;

export interface DailyPoint {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  value: number;
}

export interface VersionAdoption {
  versionId: string;
  semver: string;
  /** Active installs pinned to this version. */
  installs: number;
  publishedAt: string | null;
}

export interface PackageAnalytics {
  packageId: string;
  slug: string;
  name: string;
  kind: string;
  /** Installs that have not been disabled. */
  active: number;
  /** Installs that were made and later disabled — the churn number. */
  churned: number;
  /** Every install ever made, active or not. */
  lifetime: number;
  /** New installs per day over the window. */
  installsByDay: DailyPoint[];
  /** Uninstalls per day over the window. */
  churnByDay: DailyPoint[];
  /** Active installs per published version, newest first. */
  byVersion: VersionAdoption[];
  /** Calls attributable to this package's connector key, per day. Empty for a
   *  package whose kind has no call log (an `mcp_server` relays through a
   *  different path, which does not write here). */
  callsByDay: DailyPoint[];
  failedCallsByDay: DailyPoint[];
  /** The most common failures, worst first. `status` is null for a transport
   *  error that never got a response. */
  topErrors: Array<{ status: number | null; actionKey: string; count: number; sample: string | null }>;
}

export interface PublisherAnalytics {
  windowDays: number;
  /** Totals across every package this publisher owns. */
  totals: { packages: number; active: number; churned: number; lifetime: number };
  packages: PackageAnalytics[];
}

/** `YYYY-MM-DD` in UTC — the bucket key, and the label a chart renders. */
function dayKey(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

/**
 * Fill a day range so a chart draws a flat line through a quiet week rather than
 * joining two distant points across it.
 *
 * A sparse series is not the same data plotted differently — it is a different
 * shape, and the difference reads as growth that did not happen.
 */
export function densifyDaily(
  counts: ReadonlyMap<string, number>,
  from: Date,
  to: Date,
): DailyPoint[] {
  const out: DailyPoint[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= end) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ day: key, value: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Bucket timestamps into a day → count map. Pure, so the shaping is testable. */
export function countByDay(timestamps: ReadonlyArray<Date | string | null>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    if (!ts) continue;
    const key = dayKey(ts);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Everything a publisher may see about their own packages.
 *
 * Read-through cached against the catalogue's version token, which an install or
 * an uninstall bumps — so the numbers move when the thing they measure moves,
 * rather than on a timer that would show a publisher a stale zero for five
 * minutes after their first install.
 */
export async function publisherAnalytics(
  db: Db,
  env: Env,
  tenantId: number,
  actorUserId: string,
): Promise<PublisherAnalytics> {
  await requirePublisher(db, tenantId, actorUserId, 'developer');
  const version = await catalogVersion(env);

  return getOrSetCached(
    env,
    `developer:analytics:v${version}:tenant:${tenantId}`,
    () => loadPublisherAnalytics(db, tenantId),
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

async function loadPublisherAnalytics(db: Db, tenantId: number): Promise<PublisherAnalytics> {
  const now = new Date();
  const from = new Date(now.getTime() - ANALYTICS_WINDOW_DAYS * 86_400_000);

  // The publisher's OWN packages — a tenant-scoped read like any other, because
  // a listing belongs to the workspace that published it.
  const packages = await db
    .select()
    .from(extensionPackages)
    .where(scopedToTenant(extensionPackages, tenantId));

  if (packages.length === 0) {
    return { windowDays: ANALYTICS_WINDOW_DAYS, totals: { packages: 0, active: 0, churned: 0, lifetime: 0 }, packages: [] };
  }
  const packageIds = packages.map((p) => p.id);

  // ── Installs ────────────────────────────────────────────────────────────
  // CROSS-TENANT AND AGGREGATE. The select list carries no tenant-owned column:
  // package id, the two timestamps that make the series, and the version pin. The
  // access predicate is `package_id IN (this publisher's packages)`, which is the
  // publisher's own property. See the boundary at the top of this file.
  const sandboxTenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, REVIEW_SANDBOX_SLUG))
    .limit(1);
  const sandboxId = sandboxTenant[0]?.id ?? null;

  const installRows = await db
    .select({
      packageId: tenantExtensionInstalls.packageId,
      versionId: tenantExtensionInstalls.versionId,
      createdAt: tenantExtensionInstalls.createdAt,
      disabledAt: tenantExtensionInstalls.disabledAt,
    })
    .from(tenantExtensionInstalls)
    .where(acrossTenants(
      tenantExtensionInstalls,
      'platform_aggregate',
      inArray(tenantExtensionInstalls.packageId, packageIds),
      // The review sandbox is our own pipeline, not a customer.
      sandboxId === null ? undefined : ne(tenantExtensionInstalls.tenantId, sandboxId),
    ));

  // ── Version labels ──────────────────────────────────────────────────────
  const versionRows = await db
    .select({
      id: extensionVersions.id,
      packageId: extensionVersions.packageId,
      semver: extensionVersions.semver,
      publishedAt: extensionVersions.publishedAt,
    })
    .from(extensionVersions)
    .where(inArray(extensionVersions.packageId, packageIds));
  const versionById = new Map(versionRows.map((v) => [v.id, v]));

  // ── Call logs, for the connector packages ───────────────────────────────
  // Attributed by the manifest key, which is unique platform-wide for a published
  // connector. Cross-tenant AND aggregate: the select list is key, action, status
  // and a day — nothing that names a workspace.
  //
  // The manifest key lives on the head version's SPEC, which the version
  // projection above deliberately does not carry (it is a jsonb blob per version
  // and the labels read is over every version a publisher ever shipped). So the
  // heads are re-read once, with their specs.
  const connectorKeys = new Map<string, string>();
  const headIds = packages
    .filter((p) => p.kind === 'connector')
    .map((p) => p.currentVersionId)
    .filter((v): v is string => typeof v === 'string');
  if (headIds.length > 0) {
    const heads = await db
      .select({ id: extensionVersions.id, packageId: extensionVersions.packageId, spec: extensionVersions.spec })
      .from(extensionVersions)
      .where(inArray(extensionVersions.id, headIds));
    for (const head of heads) {
      const key = (head.spec as { key?: unknown } | null)?.key;
      if (typeof key === 'string' && key) connectorKeys.set(key, head.packageId);
    }
  }

  const callRows = connectorKeys.size > 0
    ? await db
        .select({
          connectorKey: connectorCallLogs.connectorKey,
          actionKey: connectorCallLogs.actionKey,
          ok: connectorCallLogs.ok,
          statusCode: connectorCallLogs.statusCode,
          error: connectorCallLogs.error,
          createdAt: connectorCallLogs.createdAt,
        })
        .from(connectorCallLogs)
        .where(acrossTenants(
          connectorCallLogs,
          'platform_aggregate',
          inArray(connectorCallLogs.connectorKey, [...connectorKeys.keys()]),
          gte(connectorCallLogs.createdAt, from),
        ))
    : [];

  // ── Shape ───────────────────────────────────────────────────────────────
  const out: PackageAnalytics[] = packages.map((pkg) => {
    const mine = installRows.filter((i) => i.packageId === pkg.id);
    const active = mine.filter((i) => i.disabledAt === null);
    const churned = mine.filter((i) => i.disabledAt !== null);

    const byVersionCount = new Map<string, number>();
    for (const i of active) byVersionCount.set(i.versionId, (byVersionCount.get(i.versionId) ?? 0) + 1);

    const keyForPackage = [...connectorKeys.entries()].find(([, id]) => id === pkg.id)?.[0] ?? null;
    const calls = keyForPackage ? callRows.filter((c) => c.connectorKey === keyForPackage) : [];
    const failed = calls.filter((c) => !c.ok);

    const errorBuckets = new Map<string, { status: number | null; actionKey: string; count: number; sample: string | null }>();
    for (const c of failed) {
      const k = `${c.statusCode ?? 'none'}|${c.actionKey}`;
      const bucket = errorBuckets.get(k) ?? { status: c.statusCode ?? null, actionKey: c.actionKey, count: 0, sample: null };
      bucket.count += 1;
      // One sample message, truncated. Enough for a publisher to recognise the
      // failure; not the customer's payload.
      if (!bucket.sample && c.error) bucket.sample = c.error.slice(0, 200);
      errorBuckets.set(k, bucket);
    }

    return {
      packageId: pkg.id,
      slug: pkg.slug,
      name: pkg.name,
      kind: pkg.kind,
      active: active.length,
      churned: churned.length,
      lifetime: mine.length,
      installsByDay: densifyDaily(countByDay(mine.map((i) => i.createdAt)), from, now),
      churnByDay: densifyDaily(countByDay(churned.map((i) => i.disabledAt)), from, now),
      byVersion: [...byVersionCount.entries()]
        .map(([versionId, installs]) => {
          const v = versionById.get(versionId);
          return {
            versionId,
            semver: v?.semver ?? '—',
            installs,
            publishedAt: v?.publishedAt ? new Date(v.publishedAt).toISOString() : null,
          };
        })
        .sort((a, b) => b.installs - a.installs || a.semver.localeCompare(b.semver)),
      callsByDay: densifyDaily(countByDay(calls.map((c) => c.createdAt)), from, now),
      failedCallsByDay: densifyDaily(countByDay(failed.map((c) => c.createdAt)), from, now),
      topErrors: [...errorBuckets.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    } satisfies PackageAnalytics;
  });

  return {
    windowDays: ANALYTICS_WINDOW_DAYS,
    totals: {
      packages: out.length,
      active: out.reduce((n, p) => n + p.active, 0),
      churned: out.reduce((n, p) => n + p.churned, 0),
      lifetime: out.reduce((n, p) => n + p.lifetime, 0),
    },
    packages: out.sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)),
  };
}
