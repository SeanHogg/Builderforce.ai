/**
 * Connector registry — the ONE place that answers "what connectors does this
 * tenant have, and what is the manifest for key X?".
 *
 * Merges two sources that must never be resolved separately by a caller:
 *   • built-in manifests (code, `defaults/`) — same for every tenant;
 *   • tenant-authored rows (`connectors`) — published ones only, for agent-facing
 *     reads; drafts are visible to the builder UI and to nothing else.
 *
 * A tenant key can never shadow a built-in: `RESERVED_CONNECTOR_KEYS` is enforced
 * on write, so the merge has no precedence question to get wrong.
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
import {
  parseConnectorManifest,
  type ConnectorManifest,
} from './connectorManifest';
import { BUILTIN_CONNECTORS, BUILTIN_CONNECTOR_LIST, RESERVED_CONNECTOR_KEYS } from './defaults';

/** Where a manifest came from — drives "Built-in" vs "Custom" in the catalog UI. */
export type ConnectorOrigin = 'builtin' | 'tenant';

export interface ResolvedConnector {
  manifest: ConnectorManifest;
  origin: ConnectorOrigin;
  /** Row id for tenant connectors; null for built-ins. */
  id: string | null;
  status: 'published' | 'draft';
  version: number;
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

/** True when `key` names a built-in and therefore cannot be claimed by a tenant. */
export function isReservedConnectorKey(key: string): boolean {
  return RESERVED_CONNECTOR_KEYS.has(key);
}

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
 * The full catalog for a tenant — built-ins plus the tenant's own connectors,
 * INCLUDING drafts. For anything agent-facing use {@link listPublishedConnectors}.
 */
export async function listConnectorsForTenant(
  db: Db,
  tenantId: number,
  env?: Env,
): Promise<ResolvedConnector[]> {
  const load = async (): Promise<ResolvedConnector[]> => [
    ...BUILTIN_CONNECTOR_LIST.map(builtinResolved),
    ...(await loadTenantConnectors(db, tenantId)),
  ];
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
  if (!row) return null;
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
