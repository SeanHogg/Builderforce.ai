/**
 * Tenant API key (bfk_*) management — shared between the owner self-service
 * flow (`tenantApiKeyRoutes.ts`) and the superadmin mint-on-behalf flow
 * (`adminRoutes.ts`). Single source of truth for raw-key generation,
 * hashing, table layout, and origin-allowlist semantics.
 */
import { and, desc, eq, gte, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { llmUsageLog, tenantApiKeys } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { invalidateKeyCache } from '../../infrastructure/auth/keyResolutionCache';

export interface TenantApiKeyRow {
  id:               string;
  name:             string;
  createdByUserId:  string | null;
  /** Browser allowlist — null = server-only, ['*'] = any origin, otherwise list of exact origins. */
  allowedOrigins:   string[] | null;
  lastUsedAt:       Date | null;
  revokedAt:        Date | null;
  createdAt:        Date;
}

export interface MintedTenantApiKey {
  /** Raw `bfk_*` key — only available at mint time. */
  key:        string;
  id:         string;
  name:       string;
  allowedOrigins: string[] | null;
  createdAt:  Date;
}

export interface MintTenantApiKeyInput {
  tenantId:        number;
  name:            string;
  /** User minting the key. Null for system / admin-on-behalf calls. */
  createdByUserId: string | null;
  /**
   * Browser origin allowlist:
   *   - undefined / null  → server-only key (any request with `Origin` header is rejected at auth time)
   *   - ['*']             → any origin allowed (escape hatch — equivalent to legacy bfk_*)
   *   - ['https://example.com', ...] → exact-origin allowlist
   */
  allowedOrigins?: string[] | null;
}

function serializeOrigins(origins: string[] | null | undefined): string | null {
  if (!origins || origins.length === 0) return null;
  return JSON.stringify(origins);
}

function deserializeOrigins(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : null;
  } catch {
    return null;
  }
}

/** Mint a new bfk_* key for a tenant. Returns the raw key once; only the hash is stored. */
export async function mintTenantApiKey(
  db: Db,
  input: MintTenantApiKeyInput,
): Promise<MintedTenantApiKey> {
  const rawKey  = generateApiKey('bfk');
  const keyHash = await hashSecret(rawKey);

  const [row] = await db
    .insert(tenantApiKeys)
    .values({
      tenantId:        input.tenantId,
      name:            input.name,
      keyHash,
      createdByUserId: input.createdByUserId,
      allowedOrigins:  serializeOrigins(input.allowedOrigins),
    })
    .returning({
      id:             tenantApiKeys.id,
      name:           tenantApiKeys.name,
      allowedOrigins: tenantApiKeys.allowedOrigins,
      createdAt:      tenantApiKeys.createdAt,
    });

  if (!row) throw new Error('Failed to mint tenant API key');
  return {
    key: rawKey,
    id: row.id,
    name: row.name,
    allowedOrigins: deserializeOrigins(row.allowedOrigins),
    createdAt: row.createdAt,
  };
}

/** List every key for a tenant, newest first. Raw key is never returned. */
export async function listTenantApiKeys(db: Db, tenantId: number): Promise<TenantApiKeyRow[]> {
  const rows = await db
    .select({
      id:               tenantApiKeys.id,
      name:             tenantApiKeys.name,
      createdByUserId:  tenantApiKeys.createdByUserId,
      allowedOrigins:   tenantApiKeys.allowedOrigins,
      lastUsedAt:       tenantApiKeys.lastUsedAt,
      revokedAt:        tenantApiKeys.revokedAt,
      createdAt:        tenantApiKeys.createdAt,
    })
    .from(tenantApiKeys)
    .where(eq(tenantApiKeys.tenantId, tenantId))
    .orderBy(desc(tenantApiKeys.createdAt));

  return rows.map((r) => ({ ...r, allowedOrigins: deserializeOrigins(r.allowedOrigins) }));
}

export interface UpdateTenantApiKeyInput {
  tenantId: number;
  keyId:    string;
  /** When provided, replaces the existing name. Empty string is rejected. */
  name?:    string;
  /**
   * When provided (including explicit `null`), replaces the existing origin
   * allowlist. `undefined` leaves the existing value untouched.
   */
  allowedOrigins?: string[] | null;
  /** Required to invalidate the auth cache so the new policy takes effect immediately. */
  env?: Env;
}

/**
 * Partial update for a tenant API key — name and/or allowed origins. Returns
 * the updated row, or `null` when no key matches the (tenantId, keyId) pair
 * or when the key is revoked. Always invalidates the auth cache when an
 * `env` is provided so the new policy takes effect within ~1 request rather
 * than waiting for the existing 60s TTL.
 *
 * Used by both the owner self-service flow and the superadmin mint-on-behalf
 * flow (DRY — single source for the partial-update semantics + cache-bust).
 */
export async function updateTenantApiKey(
  db: Db,
  args: UpdateTenantApiKeyInput,
): Promise<TenantApiKeyRow | null> {
  // Build the patch only from fields the caller actually supplied — avoids
  // accidentally clearing one column when the caller only wanted to set another.
  const patch: Record<string, unknown> = {};
  if (typeof args.name === 'string') {
    const trimmed = args.name.trim();
    if (trimmed.length === 0) return null; // empty rename is rejected; surface as no-op
    patch.name = trimmed;
  }
  if (args.allowedOrigins !== undefined) {
    patch.allowedOrigins = serializeOrigins(args.allowedOrigins);
  }
  if (Object.keys(patch).length === 0) return null;

  const [row] = await db
    .update(tenantApiKeys)
    .set(patch)
    .where(and(
      eq(tenantApiKeys.id, args.keyId),
      eq(tenantApiKeys.tenantId, args.tenantId),
      isNull(tenantApiKeys.revokedAt),
    ))
    .returning({
      id:               tenantApiKeys.id,
      name:             tenantApiKeys.name,
      keyHash:          tenantApiKeys.keyHash,
      createdByUserId:  tenantApiKeys.createdByUserId,
      allowedOrigins:   tenantApiKeys.allowedOrigins,
      lastUsedAt:       tenantApiKeys.lastUsedAt,
      revokedAt:        tenantApiKeys.revokedAt,
      createdAt:        tenantApiKeys.createdAt,
    });
  if (!row) return null;

  if (args.env) {
    await invalidateKeyCache(args.env, 'bfk', row.keyHash);
  }

  return {
    id:              row.id,
    name:            row.name,
    createdByUserId: row.createdByUserId,
    allowedOrigins:  deserializeOrigins(row.allowedOrigins),
    lastUsedAt:      row.lastUsedAt,
    revokedAt:       row.revokedAt,
    createdAt:       row.createdAt,
  };
}

/**
 * Revoke a key. Returns true if the key existed, was for the given tenant,
 * and was active. Also invalidates the auth cache so the revocation takes
 * effect immediately rather than waiting up to 60s for the cached "valid"
 * entry to expire.
 *
 * Cache invalidation needs the key *hash* (cache key), which we fetch in the
 * same query that flags the row revoked — single DB round-trip.
 */
export async function revokeTenantApiKey(
  db: Db,
  args: { tenantId: number; keyId: string; env?: Env },
): Promise<boolean> {
  const [row] = await db
    .update(tenantApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(tenantApiKeys.id, args.keyId),
      eq(tenantApiKeys.tenantId, args.tenantId),
      isNull(tenantApiKeys.revokedAt),
    ))
    .returning({ id: tenantApiKeys.id, keyHash: tenantApiKeys.keyHash });
  if (!row) return false;

  if (args.env) {
    await invalidateKeyCache(args.env, 'bfk', row.keyHash);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-key usage / audit-trail queries — used by both the owner self-service
// and superadmin flows so the shape never drifts.
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantApiKeyUsageRow {
  id:               number;
  createdAt:        string;
  model:            string;
  promptTokens:     number;
  completionTokens: number;
  totalTokens:      number;
  retries:          number;
  streamed:         boolean;
  useCase:          string | null;
  metadata:         Record<string, unknown> | null;
  idempotencyKey:   string | null;
  userId:           string | null;
}

export interface TenantApiKeyUsageSummary {
  /** Total rows matching the (tenantId, keyId, days) filter. */
  total:            number;
  /** Sum of `total_tokens` across the same window. */
  totalTokens:      number;
  /** Distinct models the key dispatched against in the window. */
  modelCount:       number;
}

export interface TenantApiKeyUsageResult {
  summary: TenantApiKeyUsageSummary;
  rows:    TenantApiKeyUsageRow[];
  /** Echo of the input window for caller convenience. */
  days:    number;
  page:    number;
  limit:   number;
}

/**
 * Audit-trail query for one `bfk_*` key. Returns recent usage rows + a
 * summary aggregation in a single round-trip-safe shape. Tenant-scoped via
 * the `tenantId` parameter so admin and owner callers can both use it
 * without leaking cross-tenant data.
 */
export async function queryTenantApiKeyUsage(
  db: Db,
  args: { tenantId: number; keyId: string; days?: number; page?: number; limit?: number },
): Promise<TenantApiKeyUsageResult> {
  const days  = Math.min(Math.max(args.days  ?? 30,  1),  90);
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const page  = Math.max(args.page ?? 1, 1);
  const offset = (page - 1) * limit;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Confirm the key exists for this tenant before exposing usage. Prevents
  // a caller with one tenant's auth from probing another tenant's key ids.
  const [key] = await db
    .select({ id: tenantApiKeys.id })
    .from(tenantApiKeys)
    .where(and(eq(tenantApiKeys.id, args.keyId), eq(tenantApiKeys.tenantId, args.tenantId)))
    .limit(1);
  if (!key) {
    return { summary: { total: 0, totalTokens: 0, modelCount: 0 }, rows: [], days, page, limit };
  }

  const rowsRaw = await db
    .select({
      id:               llmUsageLog.id,
      createdAt:        llmUsageLog.createdAt,
      model:            llmUsageLog.model,
      promptTokens:     llmUsageLog.promptTokens,
      completionTokens: llmUsageLog.completionTokens,
      totalTokens:      llmUsageLog.totalTokens,
      retries:          llmUsageLog.retries,
      streamed:         llmUsageLog.streamed,
      useCase:          llmUsageLog.useCase,
      metadata:         llmUsageLog.metadata,
      idempotencyKey:   llmUsageLog.idempotencyKey,
      userId:           llmUsageLog.userId,
    })
    .from(llmUsageLog)
    .where(and(
      eq(llmUsageLog.tenantApiKeyId, args.keyId),
      eq(llmUsageLog.tenantId, args.tenantId),
      gte(llmUsageLog.createdAt, since),
    ))
    .orderBy(desc(llmUsageLog.createdAt))
    .limit(limit)
    .offset(offset);

  // Single GROUP BY for total + token sum + distinct-model count. Cheaper
  // than three separate queries and keeps the cards consistent with rows.
  const [summary] = await db
    .select({
      total:       sql<number>`COUNT(*)::int`,
      totalTokens: sum(llmUsageLog.totalTokens),
      modelCount:  sql<number>`COUNT(DISTINCT ${llmUsageLog.model})::int`,
    })
    .from(llmUsageLog)
    .where(and(
      eq(llmUsageLog.tenantApiKeyId, args.keyId),
      eq(llmUsageLog.tenantId, args.tenantId),
      gte(llmUsageLog.createdAt, since),
    ));

  const rows: TenantApiKeyUsageRow[] = rowsRaw.map((r) => ({
    id:               r.id,
    createdAt:        r.createdAt.toISOString(),
    model:            r.model,
    promptTokens:     r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens:      r.totalTokens,
    retries:          r.retries,
    streamed:         r.streamed,
    useCase:          r.useCase,
    metadata:         parseMetadata(r.metadata),
    idempotencyKey:   r.idempotencyKey,
    userId:           r.userId,
  }));

  return {
    summary: {
      total:       Number(summary?.total ?? 0),
      totalTokens: Number(summary?.totalTokens ?? 0),
      modelCount:  Number(summary?.modelCount ?? 0),
    },
    rows,
    days,
    page,
    limit,
  };
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}

/**
 * Origin allowlist check — single source of truth for "is this request's
 * `Origin` header acceptable for this key?" Used by both the gateway auth
 * and (in the future) any other route that authenticates with a bfk_*.
 *
 *   - allowlist null/empty  → server-only; rejects any browser request
 *   - allowlist ['*']       → any origin allowed
 *   - allowlist [exact, …]  → exact-match check
 *
 * Wildcard subdomains (`https://*.example.com`) are intentionally NOT
 * supported in v1 — exact match keeps the security surface tight. Add later
 * if a tenant has a real need.
 */
export function originAllowed(allowedOrigins: string[] | null, origin: string | null): boolean {
  // No Origin header → server-side request → allowed.
  if (!origin) return true;
  // Origin present, no allowlist → server-only key, browser request denied.
  if (!allowedOrigins || allowedOrigins.length === 0) return false;
  // Wildcard escape hatch.
  if (allowedOrigins.includes('*')) return true;
  // Exact match.
  return allowedOrigins.includes(origin);
}
