/**
 * Connector write-side service — authoring connectors and configuring connections.
 *
 * Every write funnels through here so the three invariants that keep the catalog
 * trustworthy hold in one place rather than per route:
 *   1. a manifest is VALIDATED before it is stored, and re-validated on every edit;
 *   2. a tenant key can never shadow a built-in (`isReservedConnectorKey`);
 *   3. any write invalidates BOTH caches — the catalog and the connected-key set —
 *      because a connector that is published but still absent from the tool list
 *      for five minutes reads as "the feature is broken".
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connectors, connectorConnections, connectorCallLogs } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { credentialSecret, encryptCredentials, decryptCredentials } from '../integrations/credentialCrypto';
import {
  authFieldsFor,
  parseConnectorManifest,
  ConnectorManifestError,
  type ConnectorManifest,
} from './connectorManifest';
import {
  invalidateConnectorCatalog,
  isReservedConnectorKey,
  resolveConnector,
  type ResolvedConnector,
} from './connectorRegistry';
import { invalidateConnectedConnectors } from './connectorTools';
import { executeConnectorAction, type ConnectorCallResult } from './connectorRuntime';

export class ConnectorServiceError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: string[]) {
    super(message);
    this.name = 'ConnectorServiceError';
  }
}

/** Both caches are stale after ANY connector or connection write. */
async function invalidateAll(env: Env, tenantId: number): Promise<void> {
  await Promise.all([invalidateConnectorCatalog(env, tenantId), invalidateConnectedConnectors(env, tenantId)]);
}

// ---------------------------------------------------------------------------
// Connector definitions
// ---------------------------------------------------------------------------

export interface ConnectorSummary {
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  origin: 'builtin' | 'tenant';
  status: 'published' | 'draft';
  /** Row id — null for built-ins, which have no row. */
  id: string | null;
  version: number;
  actionCount: number;
  docsUrl?: string;
  authKind: string;
  /** How many enabled connections this tenant has for the connector. */
  connectionCount: number;
}

function toSummary(entry: ResolvedConnector, connectionCount: number): ConnectorSummary {
  return {
    key: entry.manifest.key,
    name: entry.manifest.name,
    description: entry.manifest.description,
    category: entry.manifest.category,
    icon: entry.manifest.icon,
    origin: entry.origin,
    status: entry.status,
    id: entry.id,
    version: entry.version,
    actionCount: entry.manifest.actions.length,
    ...(entry.manifest.docsUrl ? { docsUrl: entry.manifest.docsUrl } : {}),
    authKind: entry.manifest.auth.kind,
    connectionCount,
  };
}

/** Catalog rows for the gallery, each carrying this tenant's connection count. */
export function summarizeCatalog(
  entries: readonly ResolvedConnector[],
  connectionCounts: ReadonlyMap<string, number>,
): ConnectorSummary[] {
  return entries.map((e) => toSummary(e, connectionCounts.get(e.manifest.key) ?? 0));
}

/** Enabled-connection counts per connector key, in ONE query (not N+1 per card). */
export async function connectionCountsByConnector(db: Db, tenantId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ key: connectorConnections.connectorKey, enabled: connectorConnections.enabled })
    .from(connectorConnections)
    .where(eq(connectorConnections.tenantId, tenantId));
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.enabled) continue;
    counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  }
  return counts;
}

function validateOrThrow(raw: unknown): ConnectorManifest {
  try {
    return parseConnectorManifest(raw);
  } catch (e) {
    if (e instanceof ConnectorManifestError) {
      throw new ConnectorServiceError('The connector manifest is not valid', 400, e.errors);
    }
    throw e;
  }
}

export async function createConnector(
  db: Db,
  env: Env,
  args: { tenantId: number; manifest: unknown; userId: string | null; publish?: boolean },
): Promise<{ id: string; manifest: ConnectorManifest; status: 'published' | 'draft' }> {
  const manifest = validateOrThrow(args.manifest);
  if (isReservedConnectorKey(manifest.key)) {
    throw new ConnectorServiceError(
      `"${manifest.key}" is a built-in connector key — choose a different key (e.g. "${manifest.key}-custom")`,
      409,
    );
  }
  const status = args.publish ? 'published' : 'draft';
  const [row] = await db
    .insert(connectors)
    .values({
      tenantId: args.tenantId,
      connectorKey: manifest.key,
      name: manifest.name,
      category: manifest.category,
      icon: manifest.icon,
      status,
      manifest,
      version: 1,
      createdByUserId: args.userId,
    })
    .returning({ id: connectors.id })
    .catch((e: unknown) => {
      // The unique index is the real guard against a duplicate key racing in.
      if (String(e).includes('uq_connectors_tenant_key')) {
        throw new ConnectorServiceError(`A connector with key "${manifest.key}" already exists`, 409);
      }
      throw e;
    });
  if (!row) throw new ConnectorServiceError('Failed to create connector', 500);
  await invalidateAll(env, args.tenantId);
  return { id: row.id, manifest, status };
}

export async function updateConnector(
  db: Db,
  env: Env,
  args: { tenantId: number; id: string; manifest?: unknown; status?: 'published' | 'draft' },
): Promise<{ manifest: ConnectorManifest | null; status: 'published' | 'draft' }> {
  const [existing] = await db
    .select()
    .from(connectors)
    .where(scopedToTenant(connectors, args.tenantId, eq(connectors.id, args.id)))
    .limit(1);
  if (!existing) throw new ConnectorServiceError('Connector not found', 404);

  const patch: Partial<typeof connectors.$inferInsert> = { updatedAt: new Date() };
  let manifest: ConnectorManifest | null = null;

  if (args.manifest !== undefined) {
    manifest = validateOrThrow(args.manifest);
    // The key is the join to `connector_connections`; changing it would orphan every
    // configured connection silently. Renaming is a delete-and-recreate, on purpose.
    if (manifest.key !== existing.connectorKey) {
      throw new ConnectorServiceError(
        `A connector's key cannot change once created (it is "${existing.connectorKey}") — existing connections reference it`,
        409,
      );
    }
    patch.manifest = manifest;
    patch.name = manifest.name;
    patch.category = manifest.category;
    patch.icon = manifest.icon;
    patch.version = existing.version + 1;
  }
  if (args.status) patch.status = args.status;

  await db.update(connectors).set(patch).where(scopedToTenant(connectors, args.tenantId, eq(connectors.id, args.id)));
  await invalidateAll(env, args.tenantId);
  return { manifest, status: args.status ?? (existing.status === 'published' ? 'published' : 'draft') };
}

export async function deleteConnector(
  db: Db,
  env: Env,
  args: { tenantId: number; id: string },
): Promise<{ deletedConnections: number }> {
  const [existing] = await db
    .select({ key: connectors.connectorKey })
    .from(connectors)
    .where(scopedToTenant(connectors, args.tenantId, eq(connectors.id, args.id)))
    .limit(1);
  if (!existing) throw new ConnectorServiceError('Connector not found', 404);

  // Connections key off `connector_key`, not a FK, so they do NOT cascade — clear
  // them here or the tenant is left with credentials pointing at nothing.
  const removed = await db
    .delete(connectorConnections)
    .where(scopedToTenant(connectorConnections, args.tenantId, eq(connectorConnections.connectorKey, existing.key)))
    .returning({ id: connectorConnections.id });
  await db.delete(connectors).where(scopedToTenant(connectors, args.tenantId, eq(connectors.id, args.id)));
  await invalidateAll(env, args.tenantId);
  return { deletedConnections: removed.length };
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface ConnectionView {
  id: string;
  connectorKey: string;
  name: string;
  enabled: boolean;
  baseUrlOverride: string | null;
  /** Non-secret credential values, echoed so the UI can identify the connection. */
  publicFields: Record<string, string>;
  /** Keys that HAVE a stored secret — never the values. */
  secretFieldsSet: string[];
  lastTestOk: boolean | null;
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

async function toConnectionView(
  env: Env,
  tenantId: number,
  row: typeof connectorConnections.$inferSelect,
  manifest: ConnectorManifest | null,
): Promise<ConnectionView> {
  const blob = (await decryptCredentials(row.credentialsEnc, row.iv, credentialSecret(env), tenantId)) ?? {};
  const fields = manifest ? authFieldsFor(manifest) : [];
  const publicFields: Record<string, string> = {};
  const secretFieldsSet: string[] = [];
  for (const f of fields) {
    const value = blob[f.key];
    if (value == null || value === '') continue;
    if (f.secret) secretFieldsSet.push(f.key);
    else publicFields[f.key] = String(value);
  }
  return {
    id: row.id,
    connectorKey: row.connectorKey,
    name: row.name,
    enabled: row.enabled,
    baseUrlOverride: row.baseUrlOverride,
    publicFields,
    secretFieldsSet,
    lastTestOk: row.lastTestOk,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listConnections(
  db: Db,
  env: Env,
  args: { tenantId: number; connectorKey?: string },
): Promise<ConnectionView[]> {
  const rows = await db
    .select()
    .from(connectorConnections)
    .where(
      scopedToTenant(
        connectorConnections,
        args.tenantId,
        args.connectorKey ? eq(connectorConnections.connectorKey, args.connectorKey) : undefined,
      ),
    )
    .orderBy(connectorConnections.createdAt);

  // Resolve each distinct connector ONCE — built-ins short-circuit without a query,
  // and a tenant with six Slack connections must not cost six lookups.
  const manifests = new Map<string, ConnectorManifest | null>();
  for (const key of new Set(rows.map((r) => r.connectorKey))) {
    manifests.set(key, (await resolveConnector(db, args.tenantId, key, env))?.manifest ?? null);
  }
  return Promise.all(rows.map((r) => toConnectionView(env, args.tenantId, r, manifests.get(r.connectorKey) ?? null)));
}

/** Reject credential keys the manifest never declared, and require the required ones. */
function checkCredentials(manifest: ConnectorManifest, values: Record<string, unknown>, partial: boolean): Record<string, string> {
  const fields = authFieldsFor(manifest);
  const known = new Set(fields.map((f) => f.key));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!known.has(k)) continue; // silently drop unknown keys rather than store junk
    if (v == null || v === '') continue;
    out[k] = String(v);
  }
  if (!partial) {
    const missing = fields.filter((f) => f.required && !out[f.key]).map((f) => f.label);
    if (missing.length) throw new ConnectorServiceError(`Missing required credential(s): ${missing.join(', ')}`, 400);
  }
  return out;
}

export async function createConnection(
  db: Db,
  env: Env,
  args: {
    tenantId: number;
    connectorKey: string;
    name: string;
    credentials: Record<string, unknown>;
    baseUrlOverride?: string | null;
    userId: string | null;
  },
): Promise<ConnectionView> {
  const resolved = await resolveConnector(db, args.tenantId, args.connectorKey, env);
  if (!resolved) throw new ConnectorServiceError(`Unknown connector "${args.connectorKey}"`, 404);

  const values = checkCredentials(resolved.manifest, args.credentials, false);
  const { enc, iv } = await encryptCredentials(values, credentialSecret(env), args.tenantId);

  const [row] = await db
    .insert(connectorConnections)
    .values({
      tenantId: args.tenantId,
      connectorKey: args.connectorKey,
      name: args.name,
      credentialsEnc: enc,
      iv,
      baseUrlOverride: args.baseUrlOverride ?? null,
      createdByUserId: args.userId,
    })
    .returning()
    .catch((e: unknown) => {
      if (String(e).includes('uq_connector_connections_tenant_key_name')) {
        throw new ConnectorServiceError(`A connection named "${args.name}" already exists for this connector`, 409);
      }
      throw e;
    });
  if (!row) throw new ConnectorServiceError('Failed to create connection', 500);
  await invalidateAll(env, args.tenantId);
  return toConnectionView(env, args.tenantId, row, resolved.manifest);
}

export async function updateConnection(
  db: Db,
  env: Env,
  args: {
    tenantId: number;
    id: string;
    name?: string;
    enabled?: boolean;
    credentials?: Record<string, unknown>;
    baseUrlOverride?: string | null;
  },
): Promise<ConnectionView> {
  const [existing] = await db
    .select()
    .from(connectorConnections)
    .where(scopedToTenant(connectorConnections, args.tenantId, eq(connectorConnections.id, args.id)))
    .limit(1);
  if (!existing) throw new ConnectorServiceError('Connection not found', 404);

  const resolved = await resolveConnector(db, args.tenantId, existing.connectorKey, env);
  const patch: Partial<typeof connectorConnections.$inferInsert> = { updatedAt: new Date() };
  if (args.name !== undefined) patch.name = args.name;
  if (args.enabled !== undefined) patch.enabled = args.enabled;
  if (args.baseUrlOverride !== undefined) patch.baseUrlOverride = args.baseUrlOverride;

  if (args.credentials && resolved) {
    // MERGE, don't replace: the edit form can't show a stored secret, so it posts
    // back only what the user retyped. A replace would blank every untouched field.
    const current = (await decryptCredentials(existing.credentialsEnc, existing.iv, credentialSecret(env), args.tenantId)) ?? {};
    const incoming = checkCredentials(resolved.manifest, args.credentials, true);
    const merged = { ...current, ...incoming };
    const { enc, iv } = await encryptCredentials(merged, credentialSecret(env), args.tenantId);
    patch.credentialsEnc = enc;
    patch.iv = iv;
  }

  const [row] = await db
    .update(connectorConnections)
    .set(patch)
    .where(scopedToTenant(connectorConnections, args.tenantId, eq(connectorConnections.id, args.id)))
    .returning();
  if (!row) throw new ConnectorServiceError('Failed to update connection', 500);
  await invalidateAll(env, args.tenantId);
  return toConnectionView(env, args.tenantId, row, resolved?.manifest ?? null);
}

export async function deleteConnection(
  db: Db,
  env: Env,
  args: { tenantId: number; id: string },
): Promise<void> {
  const rows = await db
    .delete(connectorConnections)
    .where(scopedToTenant(connectorConnections, args.tenantId, eq(connectorConnections.id, args.id)))
    .returning({ id: connectorConnections.id });
  if (rows.length === 0) throw new ConnectorServiceError('Connection not found', 404);
  await invalidateAll(env, args.tenantId);
}

/**
 * Verify a connection by making a real call.
 *
 * Uses the first NON-MUTATING action, because "test" must never create a customer
 * record as a side effect. A connector with no read action reports that plainly
 * rather than picking a write and hoping.
 */
export async function testConnection(
  db: Db,
  env: Env,
  args: { tenantId: number; id: string; actionKey?: string; input?: Record<string, unknown> },
): Promise<{ ok: boolean; message: string; result?: ConnectorCallResult }> {
  const [row] = await db
    .select()
    .from(connectorConnections)
    .where(scopedToTenant(connectorConnections, args.tenantId, eq(connectorConnections.id, args.id)))
    .limit(1);
  if (!row) throw new ConnectorServiceError('Connection not found', 404);

  const resolved = await resolveConnector(db, args.tenantId, row.connectorKey, env);
  if (!resolved) throw new ConnectorServiceError(`Unknown connector "${row.connectorKey}"`, 404);

  const action = args.actionKey
    ? resolved.manifest.actions.find((a) => a.key === args.actionKey)
    : resolved.manifest.actions.find((a) => !a.mutates && (a.required ?? []).length === 0)
      ?? resolved.manifest.actions.find((a) => !a.mutates);
  if (!action) {
    return { ok: false, message: 'This connector has no read-only action to test with — run an action manually instead.' };
  }

  let result: ConnectorCallResult;
  let message: string;
  try {
    result = await executeConnectorAction({
      db, env, tenantId: args.tenantId,
      connectorKey: row.connectorKey,
      actionKey: action.key,
      input: args.input ?? {},
      connectionId: row.id,
      actorKind: 'test',
      allowDraft: true,
    });
    message = result.ok ? `${action.label} responded ${result.status} in ${result.durationMs}ms` : (result.error ?? `Upstream returned ${result.status}`);
  } catch (e) {
    const failure = e instanceof Error ? e.message : 'Test failed';
    await db
      .update(connectorConnections)
      .set({ lastTestedAt: new Date(), lastTestOk: false })
      .where(scopedToTenant(connectorConnections, args.tenantId, eq(connectorConnections.id, row.id)));
    await invalidateAll(env, args.tenantId);
    return { ok: false, message: failure };
  }

  await db
    .update(connectorConnections)
    .set({ lastTestedAt: new Date(), lastTestOk: result.ok })
    .where(scopedToTenant(connectorConnections, args.tenantId, eq(connectorConnections.id, row.id)));
  await invalidateAll(env, args.tenantId);
  return { ok: result.ok, message, result };
}

/** Recent call history for a connection — the Activity tab. */
export async function listCallLogs(
  db: Db,
  args: { tenantId: number; connectionId?: string; limit?: number },
) {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  return db
    .select()
    .from(connectorCallLogs)
    .where(
      scopedToTenant(
        connectorCallLogs,
        args.tenantId,
        args.connectionId ? eq(connectorCallLogs.connectionId, args.connectionId) : undefined,
      ),
    )
    .orderBy(desc(connectorCallLogs.createdAt))
    .limit(limit);
}
