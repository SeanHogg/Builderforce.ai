/**
 * OpenRouter CONNECTIONS (migration 0382) — a tenant's named OpenRouter model sets.
 *
 * WHY THIS IS NOT JUST ANOTHER BYO PROVIDER. `tenantProviderKeyService` models one credential
 * per PROVIDER, and each connected provider contributes exactly ONE implicit frontier flagship
 * (`modelPool.BYO_FRONTIER_FLAGSHIPS`). That shape is right for Anthropic or Meta — you connect
 * an account, we know which model to lead with. It is structurally wrong for OpenRouter, whose
 * entire value is the long tail of ids behind one endpoint: "connect OpenRouter" says nothing
 * about WHICH models the tenant wants their agents to run.
 *
 * So a connection is a LABEL + 1..N model ids, and a tenant may hold several ("Cheap coders"
 * above a connected Anthropic account, "Frontier" below it). The label is the unit an operator
 * orders in the precedence list; see `byoPrecedence.ts`, which stamps this table's `priority`
 * and the provider table's out of ONE integer space so the two interleave.
 *
 * THE KEY IS OPTIONAL, and the two cases bill differently — this module is where that
 * distinction is defined, because everything downstream (routing, metering, the UI copy) reads
 * it from here:
 *   • `hasKey` → the tenant's OWN OpenRouter account pays for the tokens. The gateway
 *     dispatches those ids on that key (threaded to the vendor as
 *     `VendorEnv.OPENROUTER_MODEL_KEYS`), so the usage row is `byo` and carries no token cost.
 *   • no key   → the request rides Builderforce's metered OpenRouter key and is priced from
 *     the catalog like any other pool model.
 * In BOTH cases WE route, fail over and meter the turn, so it carries the flat per-request
 * platform surcharge (`usageLedger.PREMIUM_REQUEST_SURCHARGE_MILLICENTS`). "Who pays for the
 * tokens" and "who charges for the routing" are separate questions.
 *
 * SECRETS. Model ids, labels and ordering are public-ish metadata and are read-through cached
 * (they sit on the hot completion path via `resolveTenantLlmCredentials`). The encrypted keys
 * are NOT cached — same rule `resolveTenantVendorKeys` follows — and are only read when the
 * cached metadata says at least one connection actually has one, so a tenant with no keyed
 * connection never pays for that query.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { tenantOpenRouterConnections } from '../../infrastructure/database/schema';
import { encryptSecretForStorage, decryptSecretFromStorage } from '../../infrastructure/auth/MfaService';
import { credentialSecret } from '../integrations/credentialCrypto';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

type Env = HonoEnv['Bindings'];

/** Hard ceiling on models per connection. A registration is a curated set the operator
 *  ordered by hand — an unbounded list would compose an unbounded cascade seed. */
export const MAX_MODELS_PER_CONNECTION = 25;
/** Hard ceiling on connections per tenant, for the same reason. */
export const MAX_CONNECTIONS_PER_TENANT = 20;

/** One connection as every non-secret consumer sees it (settings list, routing seed,
 *  model picker). Deliberately carries `hasKey`, never the key. */
export interface OpenRouterConnection {
  id: number;
  label: string;
  /** Bare OpenRouter model ids, in the operator's chosen order. */
  models: string[];
  /** True when the tenant bound their OWN OpenRouter key to this connection. */
  hasKey: boolean;
  /** Shared BYO precedence — LOWER = tried first; `null` = unset. */
  priority: number | null;
}

const cacheKey = (tenantId: number): string => `openrouter-connections:${tenantId}`;

/**
 * The `openrouter/<id>` route for a bare OpenRouter model id.
 *
 * The prefix is NOT cosmetic. A bare `openai/gpt-4.1` is OpenRouter's `<org>/<slug>`
 * namespace, but `direct/openai/gpt-4.1` is the tenant-keyed direct OpenAI vendor — and the
 * registry's DEFAULT_VENDOR fallback means an unrecognised bare id silently resolves to
 * OpenRouter anyway. Prefixing at the boundary makes the routing explicit for every id,
 * including ones absent from our curated catalog (which is the whole point of a connection:
 * reaching the long tail).
 */
export function connectionModelRef(bareModelId: string): string {
  return `openrouter/${bareModelId}`;
}

/** Strip the `openrouter/` prefix back off — the id OpenRouter itself expects. */
export function bareModelId(ref: string): string {
  return ref.startsWith('openrouter/') ? ref.slice('openrouter/'.length) : ref;
}

/**
 * Every connection's models as dispatchable refs, most-preferred connection first and, within
 * a connection, in the operator's chosen order. De-duped: the same id may appear in two
 * connections, and the HIGHER-priority one must win its seed position (a duplicate later in
 * the chain is dead weight that only lengthens the cascade).
 *
 * THE ordering both the gateway seed and the `/v1/models` picker read, so what we advertise as
 * selectable and what we actually lead with can never disagree.
 */
export function connectionModelRefs(connections: readonly OpenRouterConnection[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const conn of connections) {
    for (const model of conn.models) {
      const ref = connectionModelRef(model);
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

/**
 * The model refs served by the tenant's OWN OpenRouter key — the subset of
 * {@link connectionModelRefs} whose connection has a key bound.
 *
 * Two consumers, and they must agree: the proxy marks a resolution on one of these `byo`
 * (token cost 0, and exempt from the SHARED-key cooldown keyspace, because a 429 on our key
 * says nothing about the tenant's account), and the vendor resolves the per-model key from the
 * same set. Deriving both from one function is what stops a model being billed as ours while
 * dispatched on theirs, or vice versa.
 */
export function keyedConnectionModelRefs(connections: readonly OpenRouterConnection[]): Set<string> {
  const set = new Set<string>();
  for (const conn of connections) {
    if (!conn.hasKey) continue;
    for (const model of conn.models) set.add(connectionModelRef(model));
  }
  return set;
}

/** Coerce a stored `models` value to a clean string array. JSONB is schema-less at the driver
 *  boundary, and a malformed row must degrade to "no models", never throw on the hot path. */
function toModelList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is string => typeof m === 'string')
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, MAX_MODELS_PER_CONNECTION);
}

/**
 * A tenant's connections, most-preferred first (priority asc, unset last, then id) — no
 * secrets. Read-through cached: this sits on the completion path via
 * `resolveTenantLlmCredentials`, and for the overwhelming majority of tenants (who have no
 * connections at all) the cached empty array means the hot path issues no DB read whatsoever.
 * Invalidated on every write below.
 */
export async function listOpenRouterConnections(env: Env, tenantId: number): Promise<OpenRouterConnection[]> {
  return getOrSetCached(env, cacheKey(tenantId), async () => {
    try {
      const db = buildDatabase(env);
      const rows = await db
        .select({
          id: tenantOpenRouterConnections.id,
          label: tenantOpenRouterConnections.label,
          models: tenantOpenRouterConnections.models,
          priority: tenantOpenRouterConnections.priority,
          keyEnc: tenantOpenRouterConnections.keyEnc,
        })
        .from(tenantOpenRouterConnections)
        .where(eq(tenantOpenRouterConnections.tenantId, tenantId))
        // NULL priority = unset and MUST sort last (a set precedence always wins), then id
        // so the order is total and stable across reads.
        .orderBy(sql`${tenantOpenRouterConnections.priority} ASC NULLS LAST`, asc(tenantOpenRouterConnections.id));
      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        models: toModelList(r.models),
        hasKey: !!r.keyEnc,
        priority: r.priority,
      }));
    } catch (error) {
      // A credential/routing ENRICHMENT must never 500 the completion path — degrade to
      // "no connections" exactly as the provider-key resolver does.
      reportCaughtError(error, { source: 'application/llm/openRouterConnectionService.ts', operation: 'listOpenRouterConnections' });
      return [];
    }
  }, { kvTtlSeconds: 300 });
}

/**
 * Decrypted `bare model id → tenant OpenRouter key` for every KEYED connection — the map the
 * vendor resolves a per-model key from.
 *
 * Only called when {@link listOpenRouterConnections} already reported a keyed connection, so a
 * tenant with none never pays for this query. Never cached (secrets), never throws: an
 * undecryptable row is skipped and its models simply fall back to the operator key rather than
 * failing the request.
 */
export async function resolveOpenRouterConnectionKeys(env: Env, tenantId: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const claimed = new Set<string>();
  let rows: Array<{ models: unknown; keyEnc: string | null }> = [];
  try {
    const db = buildDatabase(env);
    rows = await db
      .select({ models: tenantOpenRouterConnections.models, keyEnc: tenantOpenRouterConnections.keyEnc })
      .from(tenantOpenRouterConnections)
      .where(eq(tenantOpenRouterConnections.tenantId, tenantId))
      .orderBy(sql`${tenantOpenRouterConnections.priority} ASC NULLS LAST`, asc(tenantOpenRouterConnections.id));
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/openRouterConnectionService.ts', operation: 'resolveOpenRouterConnectionKeys' });
    return out;
  }
  for (const row of rows) {
    let key = '';
    if (row.keyEnc) {
      try {
        key = await decryptSecretFromStorage(row.keyEnc, credentialSecret(env), { tenantId, legacySecret: env.JWT_SECRET });
      } catch (error) {
        reportCaughtError(error, { source: 'application/llm/openRouterConnectionService.ts', operation: 'resolveOpenRouterConnectionKeys' });
      }
    }
    // The first (highest-priority) connection claims the model even when it is
    // managed-keyed or its key cannot decrypt. Otherwise a duplicate in a lower
    // keyed connection would silently change both funding and billing provenance.
    for (const model of toModelList(row.models)) {
      if (claimed.has(model)) continue;
      claimed.add(model);
      if (key) out[model] = key;
    }
  }
  return out;
}

export interface UpsertOpenRouterConnectionInput {
  /** Omit to CREATE; supply to update that connection in place. */
  id?: number;
  label: string;
  /** Bare OpenRouter model ids (1..N). */
  models: readonly string[];
  /** Bind/replace the tenant's own OpenRouter key. Omit to leave the stored key untouched. */
  apiKey?: string | null;
  /** Explicitly drop a previously-bound key (fall back to the managed key). */
  clearKey?: boolean;
}

export type UpsertFailure =
  | 'label_required'
  | 'models_required'
  | 'too_many_models'
  | 'invalid_models'
  | 'too_many_connections'
  | 'duplicate_label'
  | 'not_found';

export type UpsertResult =
  | { ok: true; connection: OpenRouterConnection }
  | { ok: false; reason: UpsertFailure };

/**
 * Create or update ONE connection. Validation lives here (not in the route) so the HTTP
 * surface and any future caller — a seeding script, an MCP tool — enforce the same limits.
 * Returns a discriminated result rather than throwing, because every failure here is a
 * user-correctable 400, not an exception.
 */
export async function upsertOpenRouterConnection(
  env: Env,
  tenantId: number,
  input: UpsertOpenRouterConnectionInput,
  userId: string | null,
): Promise<UpsertResult> {
  const label = input.label.trim();
  if (!label) return { ok: false, reason: 'label_required' };
  const models = [...new Set(input.models.map((m) => m.trim()).filter(Boolean))];
  if (models.length === 0) return { ok: false, reason: 'models_required' };
  if (models.length > MAX_MODELS_PER_CONNECTION) return { ok: false, reason: 'too_many_models' };
  // OpenRouter ids are `<author>/<slug>`. Reject routing prefixes, whitespace,
  // URLs and control characters at the trust boundary; the UI catalog is not a
  // security boundary and API callers can submit arbitrary JSON.
  if (models.some((model) => !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:+-]+$/.test(model))) {
    return { ok: false, reason: 'invalid_models' };
  }

  const db = buildDatabase(env);
  const existing = await listOpenRouterConnections(env, tenantId);
  if (input.id == null && existing.length >= MAX_CONNECTIONS_PER_TENANT) {
    return { ok: false, reason: 'too_many_connections' };
  }
  // Case-insensitive, matching the unique index — so the conflict is reported as a friendly
  // 409 instead of surfacing a raw constraint violation.
  const clash = existing.find((c) => c.label.toLowerCase() === label.toLowerCase() && c.id !== input.id);
  if (clash) return { ok: false, reason: 'duplicate_label' };

  const apiKey = input.apiKey?.trim();
  const keyEnc = apiKey
    ? await encryptSecretForStorage(apiKey, credentialSecret(env), { tenantId })
    : null;

  let row: { id: number; label: string; models: unknown; priority: number | null; keyEnc: string | null } | undefined;
  if (input.id == null) {
    [row] = await db
      .insert(tenantOpenRouterConnections)
      .values({ tenantId, label, models, keyEnc, createdByUserId: userId })
      .returning({
        id: tenantOpenRouterConnections.id,
        label: tenantOpenRouterConnections.label,
        models: tenantOpenRouterConnections.models,
        priority: tenantOpenRouterConnections.priority,
        keyEnc: tenantOpenRouterConnections.keyEnc,
      });
  } else {
    [row] = await db
      .update(tenantOpenRouterConnections)
      .set({
        label,
        models,
        // Three distinct intents, and only an explicit one may touch the stored secret:
        // a new key replaces it, `clearKey` drops it, and neither leaves it alone — so
        // renaming a connection or editing its model list can't silently unbind the key.
        ...(keyEnc ? { keyEnc } : input.clearKey ? { keyEnc: null } : {}),
        updatedAt: sql`NOW()`,
      })
      .where(and(
        eq(tenantOpenRouterConnections.tenantId, tenantId),
        eq(tenantOpenRouterConnections.id, input.id),
      ))
      .returning({
        id: tenantOpenRouterConnections.id,
        label: tenantOpenRouterConnections.label,
        models: tenantOpenRouterConnections.models,
        priority: tenantOpenRouterConnections.priority,
        keyEnc: tenantOpenRouterConnections.keyEnc,
      });
    if (!row) return { ok: false, reason: 'not_found' };
  }

  await invalidateOpenRouterConnections(env, tenantId);
  return {
    ok: true,
    connection: {
      id: row!.id,
      label: row!.label,
      models: toModelList(row!.models),
      hasKey: !!row!.keyEnc,
      priority: row!.priority,
    },
  };
}

/** Remove one connection. Returns false when it doesn't belong to this tenant. */
export async function deleteOpenRouterConnection(env: Env, tenantId: number, id: number): Promise<boolean> {
  const db = buildDatabase(env);
  const deleted = await db
    .delete(tenantOpenRouterConnections)
    .where(and(
      eq(tenantOpenRouterConnections.tenantId, tenantId),
      eq(tenantOpenRouterConnections.id, id),
    ))
    .returning({ id: tenantOpenRouterConnections.id });
  await invalidateOpenRouterConnections(env, tenantId);
  return deleted.length > 0;
}

/** Drop the cached connection list for a tenant. Exported because `byoPrecedence` writes this
 *  table's `priority` column and must invalidate the same key. */
export async function invalidateOpenRouterConnections(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, cacheKey(tenantId)).catch((error: unknown) => {
    reportCaughtError(error, { source: 'application/llm/openRouterConnectionService.ts', operation: 'invalidateOpenRouterConnections' });
  });
}

/** Stamp one connection's precedence. Used only by `byoPrecedence.setByoPrecedence`, which
 *  owns the shared integer space across this table and `tenant_llm_provider_keys`. */
export async function setOpenRouterConnectionPriority(
  env: Env,
  tenantId: number,
  ranks: ReadonlyMap<number, number | null>,
): Promise<void> {
  if (ranks.size === 0) return;
  const db = buildDatabase(env);
  for (const [id, priority] of ranks) {
    await db
      .update(tenantOpenRouterConnections)
      .set({ priority, updatedAt: sql`NOW()` })
      .where(and(
        eq(tenantOpenRouterConnections.tenantId, tenantId),
        eq(tenantOpenRouterConnections.id, id),
      ));
  }
  await invalidateOpenRouterConnections(env, tenantId);
}
