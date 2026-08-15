/**
 * Connector registry — the ONE place that answers "what connectors does this
 * tenant have, and what is the manifest for key X?".
 *
 * Merges three sources that must never be resolved separately by a caller:
 *   • built-in manifests (code, `defaults/`) — same for every tenant;
 *   • tenant-authored rows (`connectors`) — published ones only, for agent-facing
 *     reads; drafts are visible to the builder UI and to nothing else;
 *   • MARKETPLACE installs (`tenant_extension_installs` → `extension_versions`) —
 *     a connector a third-party publisher shipped and this tenant installed
 *     (PRD 24). Added here rather than at each consumer for the reason this
 *     module exists: the agent tool catalog, the workflow action picker and the
 *     runtime all already ask this one question, so a published connector becomes
 *     callable everywhere by extending one merge instead of teaching six callers
 *     what a marketplace is.
 *
 * Neither a tenant key nor an installed one can shadow a built-in:
 * `RESERVED_CONNECTOR_KEYS` is enforced on write for tenant connectors and by
 * `packageReview`'s `reserved_key` check for published ones, so the merge has no
 * precedence question to get wrong. A tenant-authored key beats an installed one
 * if a customer somehow holds both — the workspace's own manifest is the one its
 * owner can see and edit, so it is the one that should win.
 *
 * Reads are served through the shared read-through cache. The catalog is hit on
 * every Brain open, every agent run that advertises tools, and every gallery
 * render; without it that is a table scan per tool-list build.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connectors } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { installedConnectorManifests } from '../developer/extensionInstalls';
import {
  parseConnectorManifest,
  type ConnectorManifest,
} from './connectorManifest';
import { BUILTIN_CONNECTORS, BUILTIN_CONNECTOR_LIST } from './defaults';

/** Where a manifest came from — drives "Built-in" / "Custom" / "Marketplace" in the catalog UI. */
export type ConnectorOrigin = 'builtin' | 'tenant' | 'marketplace';

export interface ResolvedConnector {
  manifest: ConnectorManifest;
  origin: ConnectorOrigin;
  /** Row id for tenant connectors, install id for marketplace ones; null for built-ins. */
  id: string | null;
  status: 'published' | 'draft';
  version: number;
  /** Publisher slug, for a marketplace connector. Null for the other two origins —
   *  a built-in's publisher is us and a tenant's is itself. */
  packageSlug?: string | null;
}

const catalogCacheKey = (tenantId: number): string => `connectors:catalog:${tenantId}`;

/** Drop the cached catalog for a tenant. Call after ANY connector write. */
export async function invalidateConnectorCatalog(env: Env, tenantId: number): Promise<void> {
  // The action catalog is a PROJECTION of this one, so it goes stale on exactly
  // the same writes. Dropping both here means a caller cannot invalidate one and
  // forget the other — which would leave a newly published connector missing from
  // the workflow builder's picker for ten minutes after it appeared in the gallery.
  await Promise.all([
    invalidateCached(env, catalogCacheKey(tenantId)),
    invalidateCached(env, `connector-action-catalog:${tenantId}`),
  ]);
}

/** True when `key` names a built-in and therefore cannot be claimed by a tenant.
 *  Defined in `defaults/` beside the set it tests; re-exported here because this
 *  is where callers already look for it. */
export { isReservedConnectorKey } from './defaults';

function builtinResolved(manifest: ConnectorManifest): ResolvedConnector {
  return { manifest, origin: 'builtin', id: null, status: 'published', version: 1 };
}

/**
 * Tenant-authored connectors, validated on read.
 *
 * A stored manifest was validated on write, but a row can outlive a contract
 * change (a field we later made required, a param location we later dropped).
 * Re-parsing here means a stale row is SKIPPED rather than handed to the runtime
 * half-understood — the connector disappears from the catalog, which is visible,
 * instead of failing mid-call with a confusing upstream error.
 */
async function loadTenantConnectors(db: Db, tenantId: number): Promise<ResolvedConnector[]> {
  const rows = await db.select().from(connectors).where(eq(connectors.tenantId, tenantId));
  const out: ResolvedConnector[] = [];
  for (const row of rows) {
    try {
      out.push({
        manifest: parseConnectorManifest(row.manifest),
        origin: 'tenant',
        id: row.id,
        status: row.status === 'published' ? 'published' : 'draft',
        version: row.version,
      });
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/connectors/connectorRegistry.ts',
        operation: `loadTenantConnectors:${row.connectorKey}`,
      });
    }
  }
  return out;
}

/**
 * Marketplace connectors this tenant has installed.
 *
 * The install service owns the join, the grant check and the re-parse; this
 * module only decides where the result sits in the merge. Keeping the two apart
 * is what stops the registry from having to know what a scope grant is.
 */
async function loadInstalledConnectors(db: Db, tenantId: number): Promise<ResolvedConnector[]> {
  const installed = await installedConnectorManifests(db, tenantId);
  return installed.map(({ manifest, installId, packageSlug }) => ({
    manifest,
    origin: 'marketplace' as const,
    id: installId,
    // An install only ever points at an APPROVED, PUBLISHED version — an
    // unpublished one cannot be installed — so there is no draft state to carry.
    status: 'published' as const,
    version: 1,
    packageSlug,
  }));
}

/**
 * The full catalog for a tenant — built-ins, the tenant's own connectors
 * (INCLUDING drafts), and its marketplace installs. For anything agent-facing use
 * {@link listPublishedConnectors}.
 *
 * A key collision resolves to the FIRST entry, and the order below is the
 * precedence stated in this module's header: built-in, then tenant-authored, then
 * installed.
 */
export async function listConnectorsForTenant(
  db: Db,
  tenantId: number,
  env?: Env,
): Promise<ResolvedConnector[]> {
  const load = async (): Promise<ResolvedConnector[]> => {
    // The two table reads are independent, so they overlap rather than queue.
    const [tenantOwned, installed] = await Promise.all([
      loadTenantConnectors(db, tenantId),
      loadInstalledConnectors(db, tenantId),
    ]);
    const claimed = new Set([...BUILTIN_CONNECTORS.keys(), ...tenantOwned.map((c) => c.manifest.key)]);
    return [
      ...BUILTIN_CONNECTOR_LIST.map(builtinResolved),
      ...tenantOwned,
      ...installed.filter((c) => !claimed.has(c.manifest.key)),
    ];
  };
  if (!env) return load();
  return getOrSetCached(env, catalogCacheKey(tenantId), load, { kvTtlSeconds: 300, l1TtlMs: 60_000 });
}

/** Catalog entries an agent may actually call — drafts excluded. */
export async function listPublishedConnectors(
  db: Db,
  tenantId: number,
  env?: Env,
): Promise<ResolvedConnector[]> {
  return (await listConnectorsForTenant(db, tenantId, env)).filter((c) => c.status === 'published');
}

/**
 * Resolve one connector key for a tenant. Built-ins short-circuit without a query
 * — the common case (an agent calling Slack) costs no database round-trip.
 *
 * A marketplace install is checked LAST, and only when the tenant authored
 * nothing under that key, so the precedence here is the same one
 * {@link listConnectorsForTenant} applies. The two must agree: a key that lists
 * as the tenant's own and RESOLVES to an installed manifest would run different
 * code than the catalog said it would.
 */
export async function resolveConnector(
  db: Db,
  tenantId: number,
  key: string,
  env?: Env,
): Promise<ResolvedConnector | null> {
  const builtin = BUILTIN_CONNECTORS.get(key);
  if (builtin) return builtinResolved(builtin);

  const [row] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.connectorKey, key)))
    .limit(1);

  if (!row) {
    const installed = await loadInstalledConnectors(db, tenantId);
    return installed.find((c) => c.manifest.key === key) ?? null;
  }

  try {
    return {
      manifest: parseConnectorManifest(row.manifest),
      origin: 'tenant',
      id: row.id,
      status: row.status === 'published' ? 'published' : 'draft',
      version: row.version,
    };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/connectors/connectorRegistry.ts',
      operation: `resolveConnector:${key}`,
    });
    return null;
  }
}

/** Look up one action on a resolved connector. */
export function findAction(resolved: ResolvedConnector, actionKey: string) {
  return resolved.manifest.actions.find((a) => a.key === actionKey) ?? null;
}
