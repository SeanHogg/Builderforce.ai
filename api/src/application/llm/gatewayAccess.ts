/**
 * Gateway authentication — WHO is calling the LLM gateway, as a {@link TenantAccess}.
 *
 * Carved out of `presentation/routes/llmRoutes.ts`, where the credential loaders,
 * the membership read and the three Bearer doors (`bfa_*`/`clk_*` agent-host keys,
 * `bfk_*` tenant API keys, and web/service JWTs) ran SQL and KV reads inline in the
 * presentation layer. They live here so a route only ever asks "who is this?" and
 * never reaches into `infrastructure/` to answer it.
 *
 * The presentation layer re-exports {@link requireTenantAccess},
 * {@link resolveBearerTenantId}, {@link TenantAccess} and {@link TenantAccessError}
 * from `presentation/routes/llmRoutes.ts`, so no importer changed.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { requestDb } from '../shared/dbHandle';
import { resolveTenantPlan, type TenantPlanSnapshot } from '../tenant/tenantPlanSnapshot';
import { originAllowed, deserializeScopes, touchTenantApiKey, keyMayActInOtherWorkspace } from './tenantApiKeyService';
import { coerceStringArrayOrNull } from '../../domain/shared/jsonColumn';
import { TenantRole } from '../../domain/shared/types';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { tenantApiKeys, users } from '../../infrastructure/database/schema';
import { loadAgentHostKeyByHash } from '../../infrastructure/auth/agentHostKeyLookup';
import { resolveKeyCached, type ResolvedKey } from '../../infrastructure/auth/keyResolutionCache';
import { resolveTenantMembership, type ResolvedMembership } from '../auth/tenantMembership';
import { verifyJwt, signJwt } from '../../infrastructure/auth/JwtService';
import { parseMachineSubject } from '../../infrastructure/auth/machineSubject';
import { hashSecret } from '../../infrastructure/auth/HashService';

/**
 * Typed error thrown by `requireTenantAccess` so callers can return the right
 * HTTP status + code without each catch site re-implementing the mapping.
 * Single source of truth for "auth-related rejection" surface.
 */
export class TenantAccessError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403,
    public readonly code: string,
    message: string,
  ) { super(message); this.name = 'TenantAccessError'; }
}

export type TenantAccess = TenantPlanSnapshot & {
  userId: string | null;
  tenantId: number;
  /** Numeric agentHost ID, set when request authenticates via agentHost API key. */
  agentHostId: number | null;
  /** Per-agentHost daily token budget (null = no per-agentHost cap). */
  agentHostTokenDailyLimit: number | null;
  /** UUID of the `bfk_*` tenant API key that authenticated, when applicable. */
  tenantApiKeyId: string | null;
  /** Endpoint scopes of the authenticating `bfk_*` key. null = unrestricted
   *  (full-tenant key) or a non-key auth path (agentHost / JWT). See migration 0070. */
  tenantApiKeyScopes: string[] | null;
  /** The caller's role in the tenant. A `bfk_*` key carries its CREATOR's membership
   *  role (it is that member's editor credential), and `userId` names the creator;
   *  `clk_*`/`bfa_*` agent-host keys are anonymous DEVELOPERs. */
  role: TenantRole;
  /** True when `users.isSuperadmin` holds for the caller — the JWT's subject, or the
   *  creator of a `bfk_*` key. Bypasses plan-cap and strict-pin gates so platform
   *  admins can use the gateway without hitting tenant caps. Always false for the
   *  `clk_*`/`bfa_*` agent-host path. */
  isSuperadmin: boolean;
};

/**
 * DB loader for a tenant API key (`bfk_*`) → its cached auth envelope. Shared by
 * {@link requireTenantAccess} and {@link resolveBearerTenantId} for the same
 * cache-shape reason as `loadAgentHostKeyByHash` (infrastructure/auth/agentHostKeyLookup).
 */
async function loadTenantApiKeyByHash(env: HonoEnv['Bindings'], keyHash: string): Promise<ResolvedKey> {
  return loadTenantApiKey(buildDatabase(env), { keyHash });
}

/** The ONE key-row read behind gateway auth: by secret hash, or by id (a JWT's `kid`). */
async function loadTenantApiKey(db: Db, lookup: { keyHash: string } | { id: string }): Promise<ResolvedKey> {
  const [r] = await db
    .select({
      id:              tenantApiKeys.id,
      tenantId:        tenantApiKeys.tenantId,
      revokedAt:       tenantApiKeys.revokedAt,
      allowedOrigins:  tenantApiKeys.allowedOrigins,
      scopes:          tenantApiKeys.scopes,
      // A key minted by a superadmin (e.g. the IDE editor key) inherits the
      // superadmin's unlimited budget — mirrors the JWT path's users.isSuperadmin.
      creatorIsSuperadmin: users.isSuperadmin,
      // ── THE KEY ACTS AS ITS CREATOR ─────────────────────────────────────────────
      // A `bfk_*` key is a person's editor credential: the device sign-in mints one for
      // the signed-in member, and `/auth/tenant-api-key-token` already exchanges it for a
      // session AS that member. Yet the gateway auth path resolved every such key to an
      // anonymous DEVELOPER, so a platform tool the VS Code chat replayed through
      // `/v1/mcp/call` ran as a role its owner never held. Measured on chat #103: the
      // workspace OWNER, directing the agent from the editor, asked it to coordinate a
      // ticket and was answered `403 manager role required` — by their own workspace.
      // Only the creator's ID lives in this long-lived entry (it never changes). Their
      // ROLE is resolved per request through the short-TTL membership resolver the JWT
      // path uses ({@link resolveMembership}), so a demotion or removal takes effect
      // within its self-heal window rather than the year this entry may live.
      createdByUserId: tenantApiKeys.createdByUserId,
      // Which device-flow app the key was issued to — only an editor key may re-scope to
      // another workspace (see `resolveKeyActingTenant`).
      client: tenantApiKeys.client,
    })
    .from(tenantApiKeys)
    .leftJoin(users, eq(users.id, tenantApiKeys.createdByUserId))
    .where('keyHash' in lookup ? eq(tenantApiKeys.keyHash, lookup.keyHash) : eq(tenantApiKeys.id, lookup.id))
    .limit(1);
  if (!r || r.revokedAt) return { ok: false, reason: 'Invalid or revoked tenant API key' };
  // Pre-resolve allowedOrigins + scopes so a cache hit doesn't have to. `allowed_origins`
  // is a jsonb column typed `string[]`, so it arrives parsed — routed through the ONE
  // shared coercer (which tolerates both the parsed array and a legacy stringified row)
  // rather than a second private JSON.parse that only handled the legacy shape.
  const allowlist: string[] | null = coerceStringArrayOrNull(r.allowedOrigins);
  return {
    ok: true,
    payload: {
      id: r.id, tenantId: r.tenantId, allowedOrigins: allowlist, scopes: deserializeScopes(r.scopes),
      isSuperadmin: r.creatorIsSuperadmin === true,
      createdByUserId: r.createdByUserId ?? null,
      client: r.client ?? null,
    },
  };
}

/**
 * What a derived editor session's key (the JWT `kid`) allows RIGHT NOW, read live through
 * the same loader as gateway auth: `valid` = it exists, is not revoked and was minted by
 * `userId` (so a revoked key cannot keep renewing JWTs); `mayRescope` = it also passes the
 * editor-key bar ({@link keyMayActInOtherWorkspace}) the gateway applies to
 * `x-builderforce-workspace`, so the workspace picker can never offer a workspace the
 * gateway will refuse.
 */
export async function resolveEditorKeySession(
  db: Db,
  keyId: string,
  userId: string,
): Promise<{ valid: boolean; mayRescope: boolean }> {
  const resolved = await loadTenantApiKey(db, { id: keyId });
  if (!resolved.ok) return { valid: false, mayRescope: false };
  const key = resolved.payload as ActingKey;
  if (key.createdByUserId !== userId) return { valid: false, mayRescope: false };
  return { valid: true, mayRescope: keyMayActInOtherWorkspace(key) };
}

/**
 * THE membership read behind gateway auth: is this user an active member of this
 * tenant, are they a superadmin, and what is their role. Delegates to the ONE cached
 * resolver (`application/auth/tenantMembership`) that `authMiddleware` also uses, so
 * the gateway and every `/api/*` route can never disagree about who a member is.
 *
 * Shared by the JWT path (which reads the superadmin flag) and the `bfk_*` path (which
 * reads the key creator's role).
 */
function resolveMembership(c: Context<HonoEnv>, tenantId: number, userId: string): Promise<ResolvedMembership | null> {
  return resolveTenantMembership(c.env, () => requestDb(c), tenantId, userId);
}

/** Request header a `bfk_*` caller sets to act in a workspace other than the key's own. */
export const WORKSPACE_HEADER = 'x-builderforce-workspace';

/** The workspace the caller names in {@link WORKSPACE_HEADER} when it differs from the key's
 *  own tenant; `null` when the header is absent, empty or the key's tenant (the default). */
function requestedWorkspace(c: Context<HonoEnv>, keyTenantId: number): string | null {
  const raw = (c.req.header(WORKSPACE_HEADER) ?? '').trim();
  return raw === '' || raw === String(keyTenantId) ? null : raw;
}

type ActingKey = {
  tenantId: number;
  createdByUserId?: string | null;
  scopes?: string[] | null;
  allowedOrigins?: string[] | null;
  /** The device-flow app the key was issued to (`tenant_api_keys.client`). */
  client?: string | null;
};

/**
 * THE tenant a `bfk_*` key acts as for this request, plus the acting member's membership
 * there. A key is a person's editor credential bound to ONE tenant, but that person may
 * select another workspace they belong to; the editor then names it in
 * {@link WORKSPACE_HEADER}. Honoured ONLY for an UNRESTRICTED, server-only, device-flow
 * (editor) key whose creator is an active member of the target — the same bar as
 * `/api/auth/tenant-api-key-token` (`keyMayActAsMember`), so a scoped site key, a
 * browser key or a hand-made integration key can never be turned into a member session
 * in another tenant. Anything else is a hard 403 — silently falling back to the key's
 * tenant is what made BYO/platform tools run against the wrong workspace.
 */
async function resolveKeyActingTenant(
  c: Context<HonoEnv>,
  key: ActingKey,
): Promise<{ tenantId: number; membership: ResolvedMembership | null }> {
  const raw = requestedWorkspace(c, key.tenantId);
  const creator = key.createdByUserId ?? null;
  if (raw === null) {
    return { tenantId: key.tenantId, membership: creator ? await resolveMembership(c, key.tenantId, creator) : null };
  }
  const target = /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(target)) {
    throw new TenantAccessError(400, 'workspace_invalid', `Invalid ${WORKSPACE_HEADER} header '${raw}'.`);
  }
  if (!keyMayActInOtherWorkspace(key)) {
    throw new TenantAccessError(
      403,
      'editor_key_required',
      'Only an unrestricted, server-only editor key issued by device sign-in can act in another workspace.',
    );
  }
  const membership = await resolveMembership(c, target, key.createdByUserId as string);
  if (!membership) {
    throw new TenantAccessError(
      403,
      'workspace_not_member',
      `This API key's owner is not an active member of workspace ${target}, so it cannot act there.`,
    );
  }
  return { tenantId: target, membership };
}

/**
 * Resolve JUST the tenant id from a request's Bearer credential, for pre-auth
 * gating (the rate-limit middleware runs before the route's own
 * {@link requireTenantAccess}). Reuses the SAME `resolveKeyCached` cache + the
 * SAME loaders as the full auth path, so no parallel resolver and no divergent
 * cache value. Machine keys (`bfa_*`/`clk_*`/`bfk_*`) and web/service JWTs all
 * resolve to a tenant id; anonymous or unresolvable callers return null and fall
 * through un-throttled (public ingest paths rely on this). Never throws.
 */
export async function resolveBearerTenantId(c: Context<HonoEnv>): Promise<number | null> {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (c.req.query('token') ?? '');
  if (!token) return null;
  try {
    if (token.startsWith('bfa_') || token.startsWith('clk_')) {
      const keyHash = await hashSecret(token);
      const resolved = await resolveKeyCached(c.env, 'clk', keyHash, () => loadAgentHostKeyByHash(buildDatabase(c.env), keyHash));
      return resolved.ok ? Number((resolved.payload as { tenantId: number }).tenantId) : null;
    }
    if (token.startsWith('bfk_')) {
      const keyHash = await hashSecret(token);
      const resolved = await resolveKeyCached(c.env, 'bfk', keyHash, () => loadTenantApiKeyByHash(c.env, keyHash));
      if (!resolved.ok) return null;
      const key = resolved.payload as ActingKey;
      // The common case (no workspace override) needs no membership read.
      if (requestedWorkspace(c, Number(key.tenantId)) === null) return Number(key.tenantId);
      // Same resolver as requireTenantAccess; a rejected workspace header falls back to
      // the key's tenant here (the route's own auth then returns the 403).
      return resolveKeyActingTenant(c, key).then((acting) => acting.tenantId, () => Number(key.tenantId));
    }
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    return typeof payload.tid === 'number' ? payload.tid : null;
  } catch {
    return null;
  }
}

export async function requireTenantAccess(c: Context<HonoEnv>): Promise<TenantAccess> {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  // BuilderForce Agent API key path: agent instances send their raw key directly
  // as the Bearer token rather than exchanging it for a JWT first. New keys are
  // `bfa_*`; legacy `clk_*` keys (retired "claw" brand) are still accepted.
  if (token.startsWith('bfa_') || token.startsWith('clk_')) {
    const keyHash = await hashSecret(token);

    const resolved = await resolveKeyCached(c.env, 'clk', keyHash, () => loadAgentHostKeyByHash(buildDatabase(c.env), keyHash));

    if (!resolved.ok) throw new Error(resolved.reason);
    const agentHost = resolved.payload as { id: number; tenantId: number; tokenDailyLimit: number | null };

    return {
      userId: null,
      tenantId: agentHost.tenantId,
      agentHostId: agentHost.id,
      agentHostTokenDailyLimit: agentHost.tokenDailyLimit,
      tenantApiKeyId: null,
      tenantApiKeyScopes: null,
      role: TenantRole.DEVELOPER,
      isSuperadmin: false,
      ...(await resolveTenantPlan(c.env, agentHost.tenantId)),
    };
  }

  // Tenant API key path (bfk_*): self-service tenant credential issued from
  // the portal; gateway-only. No agentHost context — plan-level cap still applies.
  if (token.startsWith('bfk_')) {
    const keyHash = await hashSecret(token);

    // KV-cached lookup: ~1ms hit, ~30-80ms miss. Cache entry covers everything
    // the auth path needs (id, tenantId, allowedOrigins, revoked flag) so a hit
    // requires zero DB calls. Falls through to DB when AUTH_CACHE_KV is unbound.
    const resolved = await resolveKeyCached(c.env, 'bfk', keyHash, () => loadTenantApiKeyByHash(c.env, keyHash));

    if (!resolved.ok) throw new Error(resolved.reason);
    const { id: keyId, tenantId: keyTenantId, allowedOrigins: allowlist, scopes: keyScopes, isSuperadmin: keyIsSuperadmin, createdByUserId, client: keyClient } =
      resolved.payload as { id: string; tenantId: number; allowedOrigins: string[] | null; scopes?: string[] | null; isSuperadmin?: boolean; createdByUserId?: string | null; client?: string | null };

    // Origin allowlist enforcement (single source: tenantApiKeyService.originAllowed).
    const origin = c.req.header('Origin') ?? null;
    if (!originAllowed(allowlist, origin)) {
      throw new TenantAccessError(
        403,
        'origin_not_authorized',
        `Origin '${origin}' is not authorized for this tenant API key. ` +
        `This key is server-only — to use it from a browser, register the origin in the portal under Settings → API keys.`,
      );
    }

    // Throttled (once per KEY_LAST_USED_THROTTLE_MS per key) — never an UPDATE per call.
    c.executionCtx.waitUntil(
      touchTenantApiKey(requestDb(c), keyId).catch((error) => { /* never let bookkeeping fail the request */
        reportCaughtError(error, { source: 'application/llm/gatewayAccess.ts', operation: 'requireTenantAccess' });
      }),
    );

    // The key acts as the member who minted it (see `loadTenantApiKeyByHash`): their id
    // and their CURRENT role in this workspace, from the short-TTL membership resolver.
    // A key whose creator is gone, or who is no longer an active member, keeps the
    // anonymous DEVELOPER floor it always had.
    // With `x-builderforce-workspace` the key acts in that workspace instead, as the same
    // creator under THEIR role there (see `resolveKeyActingTenant`).
    const { tenantId: actingTenantId, membership: creator } =
      await resolveKeyActingTenant(c, {
        tenantId: keyTenantId, createdByUserId, scopes: keyScopes, allowedOrigins: allowlist, client: keyClient,
      });

    return {
      userId: creator ? createdByUserId ?? null : null,
      tenantId: actingTenantId,
      agentHostId: null,
      agentHostTokenDailyLimit: null,
      tenantApiKeyId: keyId,
      tenantApiKeyScopes: keyScopes ?? null,
      role: creator?.role ?? TenantRole.DEVELOPER,
      // The creator's LIVE flag wins when their membership is known; the key's cached flag
      // (stale for up to a year) only backs the no-creator floor, in the key's OWN tenant.
      isSuperadmin: creator ? creator.isSuperadmin === true : keyIsSuperadmin === true,
      ...(await resolveTenantPlan(c.env, actingTenantId)),
    };
  }

  // JWT path: web users and agentHosts that exchanged their API key for a JWT
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (payload.tid == null) {
    throw new Error('Workspace token is required');
  }

  // Service tokens carry no real user: agentHost instances (`agentHost:*`) and short-lived
  // embed-session tokens (`embed:*`) minted server-to-server from a bfk_* key.
  // Neither has a tenant_members row, so both skip the membership check. Decoded through
  // the ONE machine-subject parser rather than re-spelling the prefixes here.
  const isServiceToken = parseMachineSubject(payload.sub) !== null;
  // Join `users.isSuperadmin` into the membership check so we don't depend on
  // the JWT carrying `sa: true`. Old JWTs minted before the `sa` claim was
  // added still grant superadmin bypass — no re-login required. New JWTs that
  // already carry the claim still benefit (the join is one DB round trip the
  // membership check was already paying for).
  let dbIsSuperadmin = false;
  if (!isServiceToken) {
    // The ONE membership read (see `resolveMembership`): active membership is required,
    // and the superadmin flag is read live rather than trusted from the JWT.
    const membership = await resolveMembership(c, payload.tid, payload.sub);
    if (!membership) throw new Error('User is not an active member of this tenant');
    dbIsSuperadmin = membership.isSuperadmin;
  }

  return {
    userId: isServiceToken ? null : payload.sub,
    tenantId: payload.tid,
    agentHostId: null,
    agentHostTokenDailyLimit: null,
    tenantApiKeyId: null,
    tenantApiKeyScopes: null,
    role: payload.role,
    // `users.isSuperadmin` (joined into the membership query above) is the
    // sole source of truth — fresh on every call, instant revocation.
    // Service tokens (agentHost / embed) are never superadmin.
    isSuperadmin: !isServiceToken && dbIsSuperadmin,
    ...(await resolveTenantPlan(c.env, payload.tid)),
  };
}

/**
 * Mint the SHORT-LIVED tenant-scoped relay JWT `POST /v1/embed-session` hands back.
 * Its `sub` is `embed:<keyId>`, which {@link requireTenantAccess} recognises as a
 * service token (no tenant_members row required).
 */
export function mintEmbedSessionToken(
  env: HonoEnv['Bindings'],
  tenantApiKeyId: string,
  tenantId: number,
  ttlSeconds: number,
): Promise<string> {
  return signJwt(
    { sub: `embed:${tenantApiKeyId}`, tid: tenantId, role: TenantRole.DEVELOPER },
    env.JWT_SECRET,
    ttlSeconds,
  );
}
