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
import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';
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
  /**
   * Whether the tool changes state. Lets every client (web Brain, VS Code
   * extension, external MCP clients) gate writes behind a confirm prompt off ONE
   * advertised flag instead of re-deriving it. First-party built-in tools always
   * set this; external tenant MCP servers don't expose it, so it's omitted there
   * and clients MUST treat `undefined` as mutating (fail safe — confirm).
   */
  mutates?: boolean;
}

/**
 * SSRF guard for a tenant-supplied MCP server URL [1402]. The gateway fetches
 * this URL server-side with the tenant's stored secret, so an internal target
 * must be rejected. Delegates to the shared {@link assertSafeUrl} guard
 * (https-only here), which blocks loopback/private/link-local/reserved IP
 * literals (incl. 169.254.169.254 metadata) and obvious internal hostnames.
 */
export function assertSafeServerUrl(serverUrl: string): void {
  try {
    assertSafeUrl(serverUrl, { allowHttp: false });
  } catch (e) {
    // Preserve this endpoint's "serverUrl …" wording (and its tests) while the
    // host/IP rules live once in the shared guard.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.replace(/^URL/, 'serverUrl'));
  }
}

/**
 * Re-validate a tenant's MCP server URL immediately BEFORE a runtime fetch.
 *
 * Registration-time validation ({@link assertSafeServerUrl}) only checks the
 * literal URL — a hostname that was public then can be re-pointed at a private
 * IP later (DNS rebinding), and the gateway would fetch it with the tenant's
 * decrypted Bearer secret. This re-runs the literal guard AND resolves the
 * hostname over DoH, rejecting a name that now maps to a private address. Callers
 * MUST also set `redirect: 'manual'` so a 302 can't bounce the authed request to
 * an internal target after this check passes.
 */
async function assertServerUrlLiveSafe(serverUrl: string): Promise<void> {
  const u = assertSafeUrl(serverUrl, { allowHttp: false });
  await resolveAndAssertPublic(u.hostname);
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
          // DNS-rebinding re-check just before the authed fetch (see helper doc).
          await assertServerUrlLiveSafe(row.serverUrl);
          const headers: Record<string, string> = { Accept: 'application/json' };
          if (row.secretEnc) {
            headers.Authorization = `Bearer ${await decryptSecretFromStorage(row.secretEnc, keyMaterial)}`;
          }
          const res = await fetchImpl(`${row.serverUrl.replace(/\/$/, '')}/tools`, { headers, redirect: 'manual' });
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

  // DNS-rebinding re-check just before the authed fetch (see helper doc).
  await assertServerUrlLiveSafe(row.serverUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (row.secretEnc) {
    headers.Authorization = `Bearer ${await decryptSecretFromStorage(row.secretEnc, args.keyMaterial)}`;
  }
  const res = await fetchImpl(`${row.serverUrl.replace(/\/$/, '')}/call`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({ tool: args.tool, arguments: args.arguments ?? {} }),
  });
  if (!res.ok) {
    throw new Error(`MCP extension returned ${res.status}`);
  }
  // Best-effort lastUsedAt bookkeeping is left to the caller via waitUntil.
  return res.json().catch(() => ({}));
}
