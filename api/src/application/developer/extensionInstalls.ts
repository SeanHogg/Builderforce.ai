/**
 * Installs — the tenant's half, and the only tenant-scoped table in this context.
 *
 * An install is a GRANT, and the grant is the security boundary (PRD 24 §5.3).
 * `grantedScopes` is a snapshot of what an admin actually approved rather than a
 * pointer at the version's request, so a publisher shipping a wider version
 * cannot silently widen an existing install — the upgrade re-prompts instead.
 *
 * ── THE SEAM THAT MAKES A PUBLISHED CONNECTOR LIVE ──────────────────────────
 * {@link installedConnectorManifests} is read by `connectorRegistry`, which is
 * already the ONE answer to "what connectors does this tenant have?". Everything
 * downstream — the agent tool catalog, the workflow builder's action picker, the
 * connector runtime with its SSRF guard and credential decryption — reads through
 * that registry. So an installed marketplace connector becomes callable
 * everywhere by adding a third source to one merge, not by teaching six consumers
 * about a marketplace.
 */

import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  extensionPackages,
  extensionVersions,
  tenantExtensionInstalls,
  tenants,
} from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseConnectorManifest, type ConnectorManifest } from '../connectors/connectorManifest';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { PublisherError } from './publishers';
import { isExtensionScope, scopeUpgrade, SENSITIVE_SCOPES } from './extensionContract';
import { installsCacheKey, invalidateInstalls, loadPackage, loadVersion } from './extensionRepository';

export interface InstallView {
  id: string;
  packageId: string;
  packageSlug: string;
  packageName: string;
  kind: string;
  publisherName: string | null;
  versionId: string;
  semver: string;
  grantedScopes: string[];
  connectionId: string | null;
  disabled: boolean;
  /** Set when the publisher has shipped a newer head than this install runs. */
  update: { versionId: string; semver: string; addedScopes: string[]; auto: boolean } | null;
  createdAt: string | null;
}

/**
 * `invalidateInstalls` and the install cache key moved to `extensionRepository.ts`
 * — re-exported here because this is where every caller already looks for them.
 * They moved because `reviewSandbox` needs the same invalidation after it installs
 * a candidate version, and importing this module from there would have closed a
 * cycle through the connector registry. The keys did not change.
 */
export { invalidateInstalls } from './extensionRepository';

/**
 * What an install of this package WOULD grant — the consent screen's data.
 *
 * A read, deliberately: showing a person what they are about to approve must not
 * itself approve anything.
 */
export async function previewInstall(
  db: Db,
  input: { tenantId: number; packageId: string },
): Promise<{
  packageName: string;
  publisherName: string | null;
  verificationState: string | null;
  semver: string;
  scopes: string[];
  sensitiveScopes: string[];
  alreadyInstalled: boolean;
}> {
  const pkg = await loadPackage(db, input.packageId);
  if (pkg.listingState !== 'listed') throw new PublisherError('this package is not available', 404);
  if (!pkg.currentVersionId) throw new PublisherError('this package has no published version', 409);

  const version = await loadVersion(db, pkg.currentVersionId);
  // The PUBLISHER's workspace, not the installing one — read by primary key, and
  // the reason a suspension hides a listing from everybody at once. `tenants` is
  // the tenant, so the id IS the scope; there is no wider set to narrow.
  const [publisher] = await db.select().from(tenants).where(eq(tenants.id, pkg.tenantId)).limit(1);
  if (publisher?.publisherSuspendedAt) throw new PublisherError('this package is not available', 404);

  const [existing] = await db
    .select({ id: tenantExtensionInstalls.id })
    .from(tenantExtensionInstalls)
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.packageId, pkg.id)))
    .limit(1);

  const scopes = version.requestedScopes ?? [];
  return {
    packageName: pkg.name,
    publisherName: publisher?.name ?? null,
    verificationState: publisher?.publisherState ?? null,
    semver: version.semver,
    scopes,
    sensitiveScopes: scopes.filter((s) => isExtensionScope(s) && SENSITIVE_SCOPES.includes(s)),
    alreadyInstalled: Boolean(existing),
  };
}

/**
 * Install (or re-enable) a package for a tenant.
 *
 * `grantedScopes` is what the ADMIN approved. It is intersected with what the
 * version requested rather than taken on trust: a client that posted a scope the
 * package never asked for would otherwise mint itself a permission through the
 * consent screen, which is the one thing the consent screen must not allow.
 */
export async function installPackage(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    packageId: string;
    userId: string;
    approvedScopes: string[];
    connectionId?: string | null;
  },
): Promise<InstallView> {
  const pkg = await loadPackage(db, input.packageId);
  if (pkg.listingState !== 'listed' || !pkg.currentVersionId) {
    throw new PublisherError('this package is not available', 404);
  }
  const version = await loadVersion(db, pkg.currentVersionId);

  const requested = version.requestedScopes ?? [];
  const granted = requested.filter((s) => input.approvedScopes.includes(s));
  if (granted.length !== requested.length) {
    // Partial consent is not a supported state: an extension whose manifest says
    // it needs `write:tickets` and is granted only `read:projects` fails at call
    // time in a way the installer cannot debug. Refusing here is the honest answer.
    throw new PublisherError('approve every scope the extension requests, or do not install it', 400);
  }

  // Whether a row already exists decides whether `install_count` moves. The
  // upsert below cannot tell us — a re-install and a first install both return a
  // row — and counting the re-install would make the number a measure of how
  // often people reconfigure rather than how many workspaces run the extension.
  const [prior] = await db
    .select({ id: tenantExtensionInstalls.id })
    .from(tenantExtensionInstalls)
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.packageId, pkg.id)))
    .limit(1);

  const [row] = await db
    .insert(tenantExtensionInstalls)
    .values({
      tenantId: input.tenantId,
      packageId: pkg.id,
      versionId: version.id,
      grantedScopes: granted,
      connectionId: input.connectionId ?? null,
      installedByUserId: input.userId,
    })
    .onConflictDoUpdate({
      target: [tenantExtensionInstalls.tenantId, tenantExtensionInstalls.packageId],
      set: {
        versionId: version.id,
        grantedScopes: granted,
        connectionId: input.connectionId ?? null,
        disabledAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: tenantExtensionInstalls.id });
  if (!row) throw new PublisherError('failed to install', 409);

  if (!prior) {
    // A counter on somebody ELSE'S row, which is what installing a published
    // package is: the install count is a public fact about a listing, not a fact
    // about the installing workspace, so it cannot live tenant-scoped.
    await db
      .update(extensionPackages)
      .set({ installCount: sql`${extensionPackages.installCount} + 1` })
      .where(acrossTenants(extensionPackages, 'public_catalogue', eq(extensionPackages.id, pkg.id)));
  }

  await invalidateInstalls(env, input.tenantId);
  const view = (await listInstalls(db, env, input.tenantId)).find((i) => i.id === row.id);
  if (!view) throw new PublisherError('install not found', 404);
  return view;
}

/**
 * Move an install to the package's current head.
 *
 * Refuses when the head widens scopes — that path is a fresh consent, not an
 * update, and `scopeUpgrade` is the one place that decides which it is.
 */
export async function updateInstall(
  db: Db,
  env: Env,
  input: { tenantId: number; installId: string },
): Promise<InstallView> {
  const [install] = await db
    .select()
    .from(tenantExtensionInstalls)
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.id, input.installId)))
    .limit(1);
  if (!install) throw new PublisherError('install not found', 404);

  const pkg = await loadPackage(db, install.packageId);
  if (!pkg.currentVersionId || pkg.currentVersionId === install.versionId) {
    throw new PublisherError('already on the current version', 409);
  }
  const head = await loadVersion(db, pkg.currentVersionId);
  const { auto, added } = scopeUpgrade(install.grantedScopes, head.requestedScopes);
  if (!auto) {
    throw new PublisherError(`this update requests new permissions (${added.join(', ')}) — re-install to approve them`, 409);
  }

  // Scoped even though `install.id` was already resolved under this tenant: the
  // guard's rule is per-statement for a reason — the row was fetched several
  // awaits ago, and a predicate that is only correct because of what happened
  // earlier in the function is the one that breaks when the function is edited.
  await db
    .update(tenantExtensionInstalls)
    .set({ versionId: head.id, updatedAt: new Date() })
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.id, install.id)));

  await invalidateInstalls(env, input.tenantId);
  const refreshed = (await listInstalls(db, env, input.tenantId)).find((i) => i.id === install.id);
  if (!refreshed) throw new PublisherError('install not found', 404);
  return refreshed;
}

/** Disable an install. Kept as a row so call logs referencing it are not orphaned. */
export async function uninstallPackage(
  db: Db,
  env: Env,
  input: { tenantId: number; installId: string },
): Promise<void> {
  const result = await db
    .update(tenantExtensionInstalls)
    .set({ disabledAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.id, input.installId)))
    .returning({ id: tenantExtensionInstalls.id });
  if (result.length === 0) throw new PublisherError('install not found', 404);
  await invalidateInstalls(env, input.tenantId);
}

interface LoadedInstall {
  install: typeof tenantExtensionInstalls.$inferSelect;
  version: typeof extensionVersions.$inferSelect;
  pkg: typeof extensionPackages.$inferSelect;
  publisher: typeof tenants.$inferSelect;
}

/**
 * One query for everything a tenant has installed, joined to its version,
 * package and publisher.
 *
 * Deliberately a three-way join rather than a loop of loaders: an agent run
 * builds its tool list on every turn, and N installs must not cost 3N round-trips.
 */
async function loadInstalls(db: Db, tenantId: number): Promise<LoadedInstall[]> {
  return db
    .select({
      install: tenantExtensionInstalls,
      version: extensionVersions,
      pkg: extensionPackages,
      publisher: tenants,
    })
    .from(tenantExtensionInstalls)
    .innerJoin(extensionVersions, eq(extensionVersions.id, tenantExtensionInstalls.versionId))
    .innerJoin(extensionPackages, eq(extensionPackages.id, tenantExtensionInstalls.packageId))
    // The publisher's workspace, joined for its name and its suspension. The
    // SCOPE below is still the installing tenant's — the join reaches ACROSS
    // tenants by design, which is what installing somebody else's package is.
    .innerJoin(tenants, eq(tenants.id, extensionPackages.tenantId))
    .where(
      scopedToTenant(
        tenantExtensionInstalls,
        tenantId,
        sql`${tenantExtensionInstalls.disabledAt} is null`,
        sql`${tenants.publisherSuspendedAt} is null`,
      ),
    )
    .orderBy(desc(tenantExtensionInstalls.createdAt));
}

/** A tenant's active installs, cached. */
export async function listInstalls(db: Db, env: Env, tenantId: number): Promise<InstallView[]> {
  return getOrSetCached(
    env,
    installsCacheKey(tenantId),
    async () => {
      const rows = await loadInstalls(db, tenantId);

      // The available-update banner needs the HEAD version's scopes, not the
      // installed one's — and it needs them for every install at once. One `IN`
      // over the distinct heads keeps the list a constant number of round-trips
      // however many extensions a workspace has installed.
      const staleHeads = [
        ...new Set(
          rows
            .filter((r) => r.pkg.currentVersionId !== null && r.pkg.currentVersionId !== r.version.id)
            .map((r) => r.pkg.currentVersionId as string),
        ),
      ];
      const heads = staleHeads.length
        ? new Map(
            (await db.select().from(extensionVersions).where(inArray(extensionVersions.id, staleHeads)))
              .map((v) => [v.id, v]),
          )
        : new Map<string, typeof extensionVersions.$inferSelect>();

      return rows.map(({ install, version, pkg, publisher }) => {
        const head = pkg.currentVersionId ? heads.get(pkg.currentVersionId) : undefined;
        // The scope diff is computed against what this tenant was GRANTED, so the
        // banner can say "this update needs write:canvas" rather than just "update
        // available". `auto` is exactly what `updateInstall` enforces, computed by
        // the same helper, so the button and the endpoint cannot disagree.
        const upgrade = head ? scopeUpgrade(install.grantedScopes, head.requestedScopes) : null;
        return {
          id: install.id,
          packageId: pkg.id,
          packageSlug: pkg.slug,
          packageName: pkg.name,
          kind: pkg.kind,
          publisherName: publisher.name,
          versionId: version.id,
          semver: version.semver,
          grantedScopes: install.grantedScopes ?? [],
          connectionId: install.connectionId,
          disabled: install.disabledAt !== null,
          update: head && upgrade
            ? { versionId: head.id, semver: head.semver, addedScopes: upgrade.added, auto: upgrade.auto }
            : null,
          createdAt: install.createdAt ? new Date(install.createdAt).toISOString() : null,
        } satisfies InstallView;
      });
    },
    { kvTtlSeconds: 120, l1TtlMs: 30_000 },
  );
}

/**
 * Installed `connector` packages, as manifests the connector runtime can execute.
 *
 * Re-parsed on read for the same reason `loadTenantConnectors` re-parses: a spec
 * validated at submit time can outlive a contract change, and a SKIPPED connector
 * is visible where a half-understood one fails mid-call with an upstream error
 * nobody can trace back to here.
 *
 * `tools:call` is required. An extension whose admin did not grant it is
 * installed but silent — which is the correct reading of a grant that withheld
 * the only scope that advertises tools.
 */
export async function installedConnectorManifests(
  db: Db,
  tenantId: number,
): Promise<Array<{ manifest: ConnectorManifest; installId: string; packageSlug: string; version: string }>> {
  const rows = await loadInstalls(db, tenantId);
  const out: Array<{ manifest: ConnectorManifest; installId: string; packageSlug: string; version: string }> = [];
  for (const { install, version, pkg } of rows) {
    if (pkg.kind !== 'connector') continue;
    if (!(install.grantedScopes ?? []).includes('tools:call')) continue;
    try {
      out.push({
        manifest: parseConnectorManifest(version.spec),
        installId: install.id,
        packageSlug: pkg.slug,
        version: version.semver,
      });
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/developer/extensionInstalls.ts',
        operation: `installedConnectorManifests:${pkg.slug}@${version.semver}`,
      });
    }
  }
  return out;
}

/** Does this tenant's install of `packageId` carry `scope`? Strict — see `installGrants`. */
export async function installHasScope(
  db: Db,
  tenantId: number,
  packageId: string,
  scope: string,
): Promise<boolean> {
  const [row] = await db
    .select({ grantedScopes: tenantExtensionInstalls.grantedScopes })
    .from(tenantExtensionInstalls)
    .where(
      scopedToTenant(
        tenantExtensionInstalls,
        tenantId,
        eq(tenantExtensionInstalls.packageId, packageId),
        sql`${tenantExtensionInstalls.disabledAt} is null`,
      ),
    )
    .limit(1);
  return Array.isArray(row?.grantedScopes) && row.grantedScopes.includes(scope);
}
