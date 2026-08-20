/**
 * The REVIEW SANDBOX — the workspace a candidate version is installed into for
 * the length of one dynamic review, and taken out of again.
 *
 * ── WHY A REAL TENANT AND A REAL INSTALL ────────────────────────────────────
 * The dynamic stage could have re-implemented "resolve this manifest and call an
 * action" against the submitted JSON directly. It deliberately does not. What a
 * reviewer needs to know is not "does this JSON describe a reachable API" — the
 * static stage nearly answers that — it is "does the thing that happens when a
 * customer presses Install work". Those differ at every seam between them: the
 * grant filter in `installedConnectorManifests`, the re-parse on read, the
 * key-collision precedence in `connectorRegistry`, the cache invalidation. A
 * review that skipped those would pass a package that breaks on the first real
 * install, which is precisely the failure the stage exists to catch.
 *
 * So the sandbox is an ordinary `tenants` row and the install is an ordinary
 * `tenant_extension_installs` row, and the stage reaches the manifest through
 * `resolveConnector` like every other caller on the platform.
 *
 * ── ONE SANDBOX, NOT ONE PER PUBLISHER ──────────────────────────────────────
 * Nothing accumulates in it: the install is removed in a `finally`, no customer
 * data is ever written to it, and no publisher signs into it. A sandbox per
 * vendor would be a `tenants` row per vendor for a workspace that is empty
 * between reviews — the Neon-cost question PRD 24 §9.4 raises, pointed at a table
 * that does not need it. (§9.4 is asking about the PUBLISHER's development
 * sandbox, which is a different workspace for a different purpose and is not
 * this one.)
 *
 * ── AND WHY THE INSTALL IS WRITTEN HERE RATHER THAN THROUGH `installPackage` ─
 * `installPackage` refuses anything that is not `listed` with a published head,
 * and it is right to: that is the door a customer comes through. A candidate
 * version under review is by definition neither. Reviewing it through the
 * customer door would mean either weakening that door or publishing a package to
 * review it, and both are worse than one function here that is unreachable from
 * a request.
 */

import { eq, and } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenantExtensionInstalls, tenants } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { invalidateInstalls } from './extensionInstalls';

/** The slug migration 1094 seeds. One definition, two readers: this and the SQL. */
export const REVIEW_SANDBOX_SLUG = 'extension-review-sandbox';

/**
 * The sandbox workspace, creating it if the deployment has not got one.
 *
 * Migration 1094 seeds the row, so the create path is for a development database
 * restored from before it. `onConflictDoNothing` then re-select rather than
 * `returning()`: two submissions racing must both end up with the SAME workspace,
 * and an insert that lost the race returns nothing at all.
 *
 * Returns `null` rather than throwing when the row cannot be established. The
 * caller's rule (`reviewPipeline` precedence 5) is that a stage which cannot
 * reach its sandbox SKIPS — a platform-side problem must not refuse a publisher's
 * submission.
 */
export async function resolveSandboxTenantId(db: Db): Promise<number | null> {
  try {
    const found = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, REVIEW_SANDBOX_SLUG))
      .limit(1);
    if (found[0]) return found[0].id;

    await db
      .insert(tenants)
      .values({ name: 'Extension Review Sandbox', slug: REVIEW_SANDBOX_SLUG, plan: 'free' })
      .onConflictDoNothing();

    const created = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, REVIEW_SANDBOX_SLUG))
      .limit(1);
    return created[0]?.id ?? null;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/developer/reviewSandbox.ts',
      operation: 'resolveSandboxTenantId',
    });
    return null;
  }
}

/**
 * Install `versionId` into the sandbox, run `body`, and remove it again.
 *
 * The grant is the version's FULL requested scope set. That is not generosity —
 * it is the only grant that exercises what the package asks for, and a review
 * that installed it with fewer scopes than it requests would test a
 * configuration no customer will ever run.
 *
 * The removal is a hard DELETE and not the soft `disabledAt` an uninstall uses.
 * A disabled row is kept because it anchors call logs and remembers that a
 * workspace once installed something; neither is true of a review fixture, and
 * leaving one behind would make `install_count` and the sandbox's own install
 * list accumulate a row per submission forever.
 *
 * `finally` rather than a trailing call: if the stage throws mid-probe, the
 * sandbox must still come out clean, or the next review resolves the PREVIOUS
 * submission's manifest under the same connector key.
 */
export async function withSandboxInstall<T>(
  db: Db,
  env: Env,
  input: { sandboxTenantId: number; packageId: string; versionId: string; scopes: string[] },
  body: (sandboxTenantId: number) => Promise<T>,
): Promise<T> {
  const { sandboxTenantId, packageId, versionId, scopes } = input;

  await db
    .insert(tenantExtensionInstalls)
    .values({
      tenantId: sandboxTenantId,
      packageId,
      versionId,
      grantedScopes: scopes,
      installedByUserId: null,
    })
    .onConflictDoUpdate({
      target: [tenantExtensionInstalls.tenantId, tenantExtensionInstalls.packageId],
      set: { versionId, grantedScopes: scopes, disabledAt: null, updatedAt: new Date() },
    });

  // The registry caches the sandbox's catalog; without this the stage would
  // resolve whatever the PREVIOUS review of this package installed.
  await invalidateInstalls(env, sandboxTenantId);

  try {
    return await body(sandboxTenantId);
  } finally {
    await db
      .delete(tenantExtensionInstalls)
      .where(scopedToTenant(
        tenantExtensionInstalls,
        sandboxTenantId,
        eq(tenantExtensionInstalls.packageId, packageId),
      ))
      .catch((error: unknown) => {
        reportCaughtError(error, {
          source: 'application/developer/reviewSandbox.ts',
          operation: 'withSandboxInstall:cleanup',
        });
      });
    await invalidateInstalls(env, sandboxTenantId).catch((error: unknown) => {
      reportCaughtError(error, {
        source: 'application/developer/reviewSandbox.ts',
        operation: 'withSandboxInstall:invalidate',
      });
    });
  }
}

/**
 * Is this workspace the review sandbox?
 *
 * Exported so the analytics and directory reads can EXCLUDE it. A review install
 * that lasted four seconds is not a customer, and counting it would make every
 * package's install analytics report one workspace that does not exist and never
 * came back — churn invented by our own pipeline.
 */
export async function isSandboxTenant(db: Db, tenantId: number): Promise<boolean> {
  const [row] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.slug, REVIEW_SANDBOX_SLUG)))
    .limit(1);
  return Boolean(row);
}
