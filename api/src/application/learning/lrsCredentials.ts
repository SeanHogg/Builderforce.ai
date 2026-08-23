/**
 * LRS CREDENTIALS — the Basic key an authoring tool holds, and the external LRS
 * this one forwards to. Both are `connections` rows.
 *
 * ── WHY THERE IS NO `lrs_credentials` TABLE AND NO `external_lrs_targets` ────
 * The coverage map sends the first to the `credential` primitive and folds the
 * second into a sibling, and they land in the same place because they are the
 * same fact seen from two ends: a named party, an endpoint, a status, and a
 * secret. Inbound, we issue the secret and somebody else holds it. Outbound, they
 * issued it and we hold it. Nothing else differs, so nothing else is modelled —
 * `config.direction` says which end this row is.
 *
 * That is what buys the whole connection surface for free: a listing that shows
 * "connected / revoked", a reconnect flow, an expiry sweep, and one encrypted
 * store. A second pair of bespoke tables would have re-implemented all four.
 *
 * ── WHY THE SECRET GOES THROUGH `connectionApiKey` ──────────────────────────
 * Because a static Basic password IS a static API key, and that module's own
 * docstring exists to stop a second sealing path being written for exactly this
 * case. One crypto path, one `credentials` row shape.
 *
 * ── WHY AUTHENTICATION IS A CROSS-TENANT READ, AND WHY IT IS NOT CACHED ─────
 * An inbound xAPI request carries `Authorization: Basic` and nothing else. The
 * authoring tool that sends it has never heard of a workspace, so resolving the
 * tenant IS the authentication — there is no tenant to scope the lookup by, which
 * is what `acrossTenants(…, 'share_token', …)` is for: a bearer credential
 * presented on its own, with the credential itself as the access predicate.
 *
 * And it is deliberately uncached. Every other read on this surface is cached;
 * this one must not be, because the interval between "revoke" and "the key stops
 * working" would become the cache TTL. A revoked credential has to be dead on the
 * next request, so the cost — one partial-index read (migration 1114) plus one
 * decrypt, on a path that is already writing to the database — is paid every time.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connections } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { generateApiKey } from '../../infrastructure/auth/HashService';
import { timingSafeEqual } from '../../infrastructure/crypto/constantTime';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  deleteConnectionApiKey, readConnectionApiKey, writeConnectionApiKey,
} from '../integrations/connectionApiKey';

export const LRS_VENDOR = 'lrs';
export const LRS_CAPABILITY = 'lrs';

/** 'inbound' — a key WE issued, that an authoring tool sends us.
 *  'outbound' — a key SOMEBODY ELSE issued, that we send to their LRS. */
export type LrsDirection = 'inbound' | 'outbound';

export interface LrsCredential {
  id: number;
  direction: LrsDirection;
  /** The Basic username. Public by construction — it travels in every request —
   *  which is why it is a column and only its partner is sealed. */
  key: string;
  label: string;
  /** Outbound only: the base URL statements are forwarded to. */
  endpoint: string | null;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export type LrsCredentialRefusal =
  | { ok: false; reason: 'bad_endpoint'; detail: string }
  | { ok: false; reason: 'not_found'; detail: string };

export type LrsAuth =
  | { ok: true; tenantId: number; connectionId: number; label: string }
  | { ok: false; status: 401 | 403; detail: string };

const credentialsCacheKey = (tenantId: number) => `lrs:credentials:${tenantId}`;

/**
 * Mint an inbound credential. The secret is returned ONCE and never again — it is
 * sealed on the way in and there is no read path that hands it back, which is the
 * property that makes "we cannot recover it, rotate it" true rather than policy.
 */
export async function issueInboundCredential(
  db: Db, env: Env,
  input: { tenantId: number; userId?: string | null; label: string },
): Promise<{ ok: true; credential: LrsCredential; secret: string }> {
  const key = generateApiKey('bfx');
  const secret = generateApiKey('bfx');

  const [row] = await db.insert(connections).values({
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    vendor: LRS_VENDOR,
    capability: LRS_CAPABILITY,
    externalAccount: key,
    displayName: input.label.trim().slice(0, 255) || 'xAPI credential',
    status: 'connected',
    config: { direction: 'inbound' },
  }).returning();
  if (!row) throw new Error('issueInboundCredential: no row returned');

  await writeConnectionApiKey(db, env, {
    tenantId: input.tenantId, connectionId: row.id, apiKey: secret,
  });
  await invalidateCached(env, credentialsCacheKey(input.tenantId));
  return { ok: true, credential: toCredential(row), secret };
}

/**
 * Register an external LRS to forward statements to.
 *
 * The endpoint is validated as an absolute https URL here rather than at the
 * forwarder, because a target that cannot be reached is a configuration mistake
 * the person making it should see immediately — not a delivery failure discovered
 * later against a queue of statements.
 */
export async function registerOutboundTarget(
  db: Db, env: Env,
  input: {
    tenantId: number; userId?: string | null; label: string;
    endpoint: string; key: string; secret: string;
  },
): Promise<{ ok: true; credential: LrsCredential } | LrsCredentialRefusal> {
  const endpoint = normaliseEndpoint(input.endpoint);
  if (!endpoint) {
    return { ok: false, reason: 'bad_endpoint', detail: 'an LRS endpoint must be an absolute https URL' };
  }

  const config = { direction: 'outbound', endpoint };
  const label = input.label.trim().slice(0, 255) || endpoint;
  const [row] = await db.insert(connections).values({
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    vendor: LRS_VENDOR,
    capability: LRS_CAPABILITY,
    // The KEY, not the endpoint: `uq_connections_account` keys on this column, and
    // two credentials against one endpoint are legitimate while two rows carrying
    // the same key are the same credential written twice.
    externalAccount: input.key.slice(0, 320),
    displayName: label,
    status: 'connected',
    config,
  }).onConflictDoUpdate({
    target: [
      connections.tenantId, connections.userId, connections.vendor,
      connections.capability, connections.externalAccount,
    ],
    set: { displayName: label, status: 'connected', config, updatedAt: new Date() },
  }).returning();
  if (!row) throw new Error('registerOutboundTarget: no row returned');

  await writeConnectionApiKey(db, env, {
    tenantId: input.tenantId, connectionId: row.id, apiKey: input.secret,
  });
  await invalidateCached(env, credentialsCacheKey(input.tenantId));
  return { ok: true, credential: toCredential(row) };
}

/** Every LRS credential in the workspace, both directions. Cached — it is a
 *  settings listing, and every writer here drops the key. Secrets never appear. */
export async function listLrsCredentials(db: Db, env: Env, tenantId: number): Promise<LrsCredential[]> {
  return getOrSetCached(env, credentialsCacheKey(tenantId), async () => {
    const rows = await db.select()
      .from(connections)
      .where(scopedToTenant(connections, tenantId, and(
        eq(connections.vendor, LRS_VENDOR),
        eq(connections.capability, LRS_CAPABILITY),
      ))!);
    return rows.map(toCredential);
  }, { kvTtlSeconds: 120 });
}

/**
 * Revoke a credential.
 *
 * The connection row is kept and marked `revoked` rather than deleted, so the
 * listing can say "revoked" instead of forgetting the key existed — but the
 * SECRET is destroyed, because a sealed blob nothing can authenticate with is an
 * orphan that only ever appears in a breach.
 */
export async function revokeLrsCredential(
  db: Db, env: Env, tenantId: number, id: number,
): Promise<{ ok: true } | LrsCredentialRefusal> {
  const [row] = await db.update(connections)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(scopedToTenant(connections, tenantId, and(
      eq(connections.id, id),
      eq(connections.vendor, LRS_VENDOR),
    ))!)
    .returning({ id: connections.id });
  if (!row) return { ok: false, reason: 'not_found', detail: 'no such LRS credential in this workspace' };

  await deleteConnectionApiKey(db, tenantId, id);
  await invalidateCached(env, credentialsCacheKey(tenantId));
  return { ok: true };
}

/**
 * Authenticate an inbound xAPI request from its `Authorization` header.
 *
 * Refuses in three shapes on purpose. A missing or malformed header is a 401 with
 * a challenge — the client can retry with credentials. An unknown or revoked key
 * is also a 401, worded identically to a wrong secret so the response cannot be
 * used to enumerate which keys exist. An OUTBOUND row presented as an inbound
 * credential is a 403: the key is real, and using our copy of somebody else's
 * credential to write into our own LRS is a confusion worth naming.
 */
export async function authenticateLrsRequest(
  db: Db, env: Env, authorization: string | null | undefined,
): Promise<LrsAuth> {
  const presented = parseBasic(authorization);
  if (!presented) return { ok: false, status: 401, detail: 'xAPI requires HTTP Basic authentication' };

  const [row] = await db.select({
    id: connections.id,
    tenantId: connections.tenantId,
    status: connections.status,
    displayName: connections.displayName,
    config: connections.config,
  })
    .from(connections)
    .where(acrossTenants(connections, 'share_token',
      eq(connections.vendor, LRS_VENDOR),
      eq(connections.externalAccount, presented.key)))
    .limit(1);

  if (!row || row.status !== 'connected') {
    return { ok: false, status: 401, detail: 'unknown or revoked credential' };
  }
  if (directionOf(row.config) !== 'inbound') {
    return { ok: false, status: 403, detail: 'that credential belongs to an external LRS, not to this one' };
  }

  const secret = await readConnectionApiKey(db, env, row.tenantId, row.id);
  if (!secret || !timingSafeEqual(secret, presented.secret)) {
    return { ok: false, status: 401, detail: 'unknown or revoked credential' };
  }
  return { ok: true, tenantId: row.tenantId, connectionId: row.id, label: row.displayName };
}

/** Stamp a credential as used. Best-effort, and the caller hands it to
 *  `waitUntil`: failing to record the timestamp must never fail the statement
 *  that was already accepted. */
export async function touchLrsCredential(db: Db, tenantId: number, connectionId: number): Promise<void> {
  await db.update(connections)
    .set({ lastSyncedAt: new Date() })
    .where(scopedToTenant(connections, tenantId, eq(connections.id, connectionId))!);
}

/**
 * Record how the last forwarding attempt to this target went.
 *
 * Success clears the error and stamps `lastSyncedAt`; failure writes the reason
 * and moves the connection to `expired`, which is the status the settings listing
 * already renders as "needs attention". Reusing the connection lifecycle rather
 * than inventing a forwarding-specific health field is what puts a broken LRS
 * target on the same screen as a broken mailbox.
 */
export async function recordForwardOutcome(
  db: Db, tenantId: number, connectionId: number, failure: string | null,
): Promise<void> {
  await db.update(connections)
    .set(failure === null
      ? { status: 'connected', lastError: null, lastSyncedAt: new Date(), updatedAt: new Date() }
      : { status: 'expired', lastError: failure.slice(0, 500), updatedAt: new Date() })
    .where(scopedToTenant(connections, tenantId, eq(connections.id, connectionId))!);
}

/** The external LRSs this workspace forwards to, with their secrets opened.
 *  Read only by the forwarder, which is why the secret is on this shape and on no
 *  other in this module. */
export async function outboundTargets(
  db: Db, env: Env, tenantId: number,
): Promise<Array<{ connectionId: number; endpoint: string; key: string; secret: string }>> {
  const rows = await db.select({
    id: connections.id,
    externalAccount: connections.externalAccount,
    config: connections.config,
  })
    .from(connections)
    .where(scopedToTenant(connections, tenantId, and(
      eq(connections.vendor, LRS_VENDOR),
      eq(connections.status, 'connected'),
    ))!);

  const outbound = rows.filter((r) => directionOf(r.config) === 'outbound' && endpointOf(r.config));
  const opened = await Promise.all(outbound.map(async (r) => {
    const secret = await readConnectionApiKey(db, env, tenantId, r.id);
    const endpoint = endpointOf(r.config);
    return secret && endpoint
      ? { connectionId: r.id, endpoint, key: r.externalAccount, secret }
      : null;
  }));
  return opened.filter((t): t is NonNullable<typeof t> => t !== null);
}

/** `Basic base64(key:secret)`, or null. A colon in the SECRET is legal and is
 *  preserved — only the first one separates. */
export function parseBasic(header: string | null | undefined): { key: string; secret: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return null;

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;
  return { key: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
}

/** Absolute https, no query, no fragment, trailing slash trimmed. Anything else
 *  is refused rather than repaired — guessing at a half-typed endpoint is how
 *  statements get posted somewhere nobody meant. */
export function normaliseEndpoint(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`.slice(0, 320);
}

function directionOf(config: unknown): LrsDirection {
  const value = (config as { direction?: unknown } | null)?.direction;
  return value === 'outbound' ? 'outbound' : 'inbound';
}

function endpointOf(config: unknown): string | null {
  const value = (config as { endpoint?: unknown } | null)?.endpoint;
  return typeof value === 'string' && value ? value : null;
}

function toCredential(row: typeof connections.$inferSelect): LrsCredential {
  return {
    id: row.id,
    direction: directionOf(row.config),
    key: row.externalAccount,
    label: row.displayName,
    endpoint: endpointOf(row.config),
    status: row.status,
    lastUsedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
