/**
 * Tenant MCP extension service — the server side of the Brain's extension
 * contract.
 *
 * A tenant registers a custom MCP server (URL + optional bearer secret). The
 * gateway:
 *   - advertises that server's tools to the Brain  (listToolsForTenant)
 *   - relays the Brain's tool calls to it SERVER-TO-SERVER  (callMcpTool)
 * so the customer's secret never reaches the browser. Secrets are encrypted at
 * rest with JWT_SECRET (AES-GCM), reusing the MFA storage helpers.
 *
 * Expected MCP server contract (what the customer implements):
 *   GET  {serverUrl}/tools  → { tools: [{ name, description, parameters }] }
 *   POST {serverUrl}/call   → body { tool, arguments }, returns arbitrary JSON
 * Both receive `Authorization: Bearer <secret>` when a secret is configured.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenantMcpExtensions } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  encryptSecretForStorage,
  decryptSecretFromStorage,
} from '../../infrastructure/auth/MfaService';

/** Read-through cache key for a tenant's merged MCP tool list [1406]. */
const mcpToolsCacheKey = (tenantId: number): string => `mcp-tools:tenant:${tenantId}`;

/** Drop the cached tool list for a tenant — call after any extension mutation so
 *  the next Brain open re-fetches the live `/tools` set instead of a stale one. */
export async function invalidateMcpToolsCache(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, mcpToolsCacheKey(tenantId));
}

/** A registered extension as returned to the portal — never includes the secret. */
export interface McpExtensionView {
  id: string;
  name: string;
  serverUrl: string;
  enabled: boolean;
  hasSecret: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** A tool advertised to the Brain, tagged with the extension that owns it. */
export interface McpToolEntry {
  extensionId: string;
  /** Original tool name on the MCP server (used on the relay call). */
  tool: string;
  /** Flat, namespaced, gateway-safe name the model sees (no dots). */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Reject anything that isn't a plain https URL — minimal SSRF guard. */
/** Reject an IPv4 literal in a loopback / private / link-local / reserved range
 *  (incl. the cloud metadata endpoint 169.254.169.254). Returns false for
 *  non-IPv4 strings so the caller falls through to hostname checks. */
function isBlockedIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return true; // malformed → reject
  return (
    a === 0 ||                            // 0.0.0.0/8 "this host"
    a === 10 ||                           // 10.0.0.0/8 private
    a === 127 ||                          // 127.0.0.0/8 loopback
    (a === 169 && b === 254) ||           // 169.254.0.0/16 link-local (+ metadata)
    (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12 private
    (a === 192 && b === 168) ||           // 192.168.0.0/16 private
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a >= 224                              // 224.0.0.0/4 multicast + 240/4 reserved
  );
}

/**
 * SSRF guard for a tenant-supplied MCP server URL [1402]. The gateway fetches
 * this URL server-side with the tenant's stored secret, so an internal target
 * must be rejected. Blocks non-https, loopback/private/link-local/reserved IP
 * literals (incl. 169.254.169.254 metadata), and obvious internal hostnames.
 *
 * Residual: a PUBLIC hostname that DNS-resolves to a private IP (rebinding) is
 * not caught here — that needs fetch-time IP pinning, which the Workers runtime
 * doesn't expose pre-fetch. The literal-IP + internal-name checks cover the
 * realistic owner-probing case.
 */
export function assertSafeServerUrl(serverUrl: string): void {
  let u: URL;
  try {
    u = new URL(serverUrl);
  } catch {
    throw new Error('serverUrl must be a valid absolute URL');
  }
  if (u.protocol !== 'https:') {
    throw new Error('serverUrl must use https://');
  }
  // Normalise: strip IPv6 brackets, lowercase.
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blockedNames = new Set(['localhost', 'metadata.google.internal']);
  const blockedSuffixes = ['.local', '.internal', '.lan', '.localhost'];
  const isBlockedIpv6 =
    host === '::1' || host === '::' ||
    host.startsWith('fe80:') ||           // link-local
    host.startsWith('fc') || host.startsWith('fd') || // fc00::/7 unique-local
    host.startsWith('::ffff:127.') ||     // IPv4-mapped loopback
    host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.');
  if (
    blockedNames.has(host) ||
    blockedSuffixes.some((s) => host.endsWith(s)) ||
    isBlockedIpv4(host) ||
    isBlockedIpv6
  ) {
    throw new Error('serverUrl must be a public host (internal/loopback/metadata addresses are not allowed)');
  }
}

function toView(row: typeof tenantMcpExtensions.$inferSelect): McpExtensionView {
  return {
    id: row.id,
    name: row.name,
    serverUrl: row.serverUrl,
    enabled: row.enabled,
    hasSecret: row.secretEnc != null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createMcpExtension(
  db: Db,
  args: { tenantId: number; name: string; serverUrl: string; secret?: string | null; createdByUserId: string; keyMaterial: string },
): Promise<McpExtensionView> {
  assertSafeServerUrl(args.serverUrl);
  const secretEnc = args.secret
    ? await encryptSecretForStorage(args.secret, args.keyMaterial)
    : null;
  const [row] = await db
    .insert(tenantMcpExtensions)
    .values({
      tenantId: args.tenantId,
      name: args.name,
      serverUrl: args.serverUrl,
      secretEnc,
      createdByUserId: args.createdByUserId,
    })
    .returning();
  if (!row) throw new Error('Failed to create MCP extension');
  return toView(row);
}

export async function listMcpExtensions(db: Db, tenantId: number): Promise<McpExtensionView[]> {
  const rows = await db
    .select()
    .from(tenantMcpExtensions)
    .where(eq(tenantMcpExtensions.tenantId, tenantId));
  return rows.map(toView);
}

export async function updateMcpExtension(
  db: Db,
  args: {
    tenantId: number;
    id: string;
    name?: string;
    serverUrl?: string;
    enabled?: boolean;
    secret?: string | null;
    keyMaterial: string;
  },
): Promise<McpExtensionView | null> {
  const patch: Partial<typeof tenantMcpExtensions.$inferInsert> = {};
  if (args.name !== undefined) patch.name = args.name;
  if (args.serverUrl !== undefined) {
    assertSafeServerUrl(args.serverUrl);
    patch.serverUrl = args.serverUrl;
  }
  if (args.enabled !== undefined) patch.enabled = args.enabled;
  if (args.secret !== undefined) {
    // `secret: null` clears it; a string re-encrypts.
    patch.secretEnc = args.secret ? await encryptSecretForStorage(args.secret, args.keyMaterial) : null;
  }
  if (Object.keys(patch).length === 0) return null;

  const [row] = await db
    .update(tenantMcpExtensions)
    .set(patch)
    .where(and(eq(tenantMcpExtensions.id, args.id), eq(tenantMcpExtensions.tenantId, args.tenantId)))
    .returning();
  return row ? toView(row) : null;
}

export async function deleteMcpExtension(
  db: Db,
  args: { tenantId: number; id: string },
): Promise<boolean> {
  const rows = await db
    .delete(tenantMcpExtensions)
    .where(and(eq(tenantMcpExtensions.id, args.id), eq(tenantMcpExtensions.tenantId, args.tenantId)))
    .returning({ id: tenantMcpExtensions.id });
  return rows.length > 0;
}

/** Flat, gateway-safe advertised name: `mcp_<8hex>_<tool>` (no dots). */
function advertisedName(extensionId: string, tool: string): string {
  const short = extensionId.replace(/-/g, '').slice(0, 8);
  const safeTool = tool.replace(/[^a-zA-Z0-9_]/g, '_');
  return `mcp_${short}_${safeTool}`;
}

/**
 * Fetch + merge the tools of every ENABLED extension for a tenant. Calls each
 * MCP server's `GET {serverUrl}/tools` server-to-server. An extension that errors
 * or times out is skipped (best-effort) so one bad server can't break the Brain.
 */
export async function listToolsForTenant(
  db: Db,
  tenantId: number,
  keyMaterial: string,
  fetchImpl: typeof fetch = fetch,
  /** When provided, the merged tool list is served through the read-through cache
   *  (L1 + AUTH_CACHE_KV, 60s) so opening the Brain doesn't hit every customer MCP
   *  server's `/tools` on each mount [1406]. Invalidated by extension mutations via
   *  {@link invalidateMcpToolsCache}. Omit (e.g. unit tests) to always fetch live. */
  env?: Env,
): Promise<McpToolEntry[]> {
  const load = async (): Promise<McpToolEntry[]> => {
    const rows = await db
      .select()
      .from(tenantMcpExtensions)
      .where(and(eq(tenantMcpExtensions.tenantId, tenantId), eq(tenantMcpExtensions.enabled, true)));

    const all: McpToolEntry[] = [];
    await Promise.all(
      rows.map(async (row) => {
        try {
          const headers: Record<string, string> = { Accept: 'application/json' };
          if (row.secretEnc) {
            headers.Authorization = `Bearer ${await decryptSecretFromStorage(row.secretEnc, keyMaterial)}`;
          }
          const res = await fetchImpl(`${row.serverUrl.replace(/\/$/, '')}/tools`, { headers });
          if (!res.ok) return;
          const body = (await res.json()) as { tools?: Array<{ name?: string; description?: string; parameters?: Record<string, unknown> }> };
          for (const t of body.tools ?? []) {
            if (!t.name) continue;
            all.push({
              extensionId: row.id,
              tool: t.name,
              name: advertisedName(row.id, t.name),
              description: t.description ?? '',
              parameters: t.parameters ?? { type: 'object', properties: {} },
            });
          }
        } catch {
          /* skip unreachable / malformed extension */
        }
      }),
    );
    return all;
  };

  if (!env) return load();
  return getOrSetCached(env, mcpToolsCacheKey(tenantId), load, { kvTtlSeconds: 60, l1TtlMs: 30_000 });
}

/**
 * Relay a single tool call to the owning extension's MCP server, server-to-server.
 * Returns the parsed JSON result. Throws on unknown extension or transport error.
 */
export async function callMcpTool(
  db: Db,
  args: { tenantId: number; extensionId: string; tool: string; arguments: unknown; keyMaterial: string },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const [row] = await db
    .select()
    .from(tenantMcpExtensions)
    .where(and(eq(tenantMcpExtensions.id, args.extensionId), eq(tenantMcpExtensions.tenantId, args.tenantId)))
    .limit(1);
  if (!row || !row.enabled) throw new Error('Unknown or disabled MCP extension');

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (row.secretEnc) {
    headers.Authorization = `Bearer ${await decryptSecretFromStorage(row.secretEnc, args.keyMaterial)}`;
  }
  const res = await fetchImpl(`${row.serverUrl.replace(/\/$/, '')}/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool: args.tool, arguments: args.arguments ?? {} }),
  });
  if (!res.ok) {
    throw new Error(`MCP extension returned ${res.status}`);
  }
  // Best-effort lastUsedAt bookkeeping is left to the caller via waitUntil.
  return res.json().catch(() => ({}));
}
