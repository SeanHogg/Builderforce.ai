import { legacyExtensionToolName, type RelayToolEntry as McpToolEntry } from "@seanhogg/builderforce-mcp";
import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Tenant MCP extension service — REGISTRATION of a tenant's external MCP servers.
 *
 * A tenant registers a server (URL, plus either a static bearer secret or a
 * three-legged OAuth grant); the gateway advertises its tools to every Brain
 * surface ({@link listToolsForTenant}) and relays calls to it SERVER-TO-SERVER
 * ({@link callMcpTool}), so the credential never reaches a browser.
 *
 * This module owns the ROW: create, list, update, delete, and the merge of every
 * enabled server's tools. The three things that used to be tangled into it now
 * live beside it, each with one reason to change:
 *
 *   `mcp/mcpWireClient`     — how a server is spoken to (real MCP JSON-RPC, with
 *                             the legacy Builderforce REST pair as a fallback)
 *   `mcp/mcpExtensionAuth`  — what credential is sent, sealed at rest
 *   `mcp/mcpToolConsent`    — which of a server's tools the tenant approved
 *
 * Static secrets are still encrypted at rest with JWT_SECRET (AES-GCM, the MFA
 * helpers); OAuth grants are sealed with the tenant's derived key through the
 * shared token vault, exactly as mailbox/drive/calendar grants are.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenantMcpExtensions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { assertSafeUrl } from '../../infrastructure/net/ssrfGuard';
import { encryptSecretForStorage } from '../../infrastructure/auth/MfaService';
import { authKindOf, resolveAuthorization, type McpAuthKind } from './mcp/mcpExtensionAuth';
import { assertToolConsented, filterConsentedTools } from './mcp/mcpToolConsent';
import { callRemoteTool, listRemoteTools, type McpProtocol } from './mcp/mcpWireClient';

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
  /** Registered extensions run through the remote HTTPS relay. */
  transport: 'http';
  /** Protocol this server speaks: `auto` until a probe settles it (mig 1116). */
  protocol: string;
  /** Tool names the tenant approved; null = every tool the server advertises. */
  allowedTools: string[] | null;
  /** How its requests are authenticated right now — `oauth` once a grant exists. */
  authKind: McpAuthKind;
  /** When a human completed the OAuth consent, if this server uses one. */
  oauthConnectedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export type { RelayToolEntry as McpToolEntry } from "@seanhogg/builderforce-mcp";

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

function toView(row: typeof tenantMcpExtensions.$inferSelect): McpExtensionView {
  return {
    id: row.id,
    name: row.name,
    serverUrl: row.serverUrl,
    enabled: row.enabled,
    hasSecret: row.secretEnc != null,
    transport: 'http',
    protocol: row.protocol,
    allowedTools: row.allowedTools ?? null,
    authKind: authKindOf(row),
    oauthConnectedAt: row.oauthConnectedAt ? row.oauthConnectedAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createMcpExtension(
  db: Db,
  args: {
    tenantId: number;
    name: string;
    serverUrl: string;
    secret?: string | null;
    allowedTools?: string[] | null;
    createdByUserId: string;
    keyMaterial: string;
  },
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
      allowedTools: args.allowedTools,
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
    /** Consented tool names; `null` restores "every tool". */
    allowedTools?: string[] | null;
    /** Pin the transport, or `auto` to re-probe (e.g. after a server upgrade). */
    protocol?: McpProtocol;
    keyMaterial: string;
  },
): Promise<McpExtensionView | null> {
  const patch: Partial<typeof tenantMcpExtensions.$inferInsert> = {};
  const scope = and(eq(tenantMcpExtensions.id, args.id), eq(tenantMcpExtensions.tenantId, args.tenantId));
  let currentUrl: string | undefined;
  if (args.name !== undefined) patch.name = args.name;
  if (args.serverUrl !== undefined) {
    assertSafeServerUrl(args.serverUrl);
    const [current] = await db.select({ serverUrl: tenantMcpExtensions.serverUrl })
      .from(tenantMcpExtensions).where(scope).limit(1);
    if (!current) return null;
    currentUrl = current.serverUrl;
    patch.serverUrl = args.serverUrl;
    if (args.serverUrl !== currentUrl) {
      // Credentials, grants, and consent were issued to the old endpoint.
      Object.assign(patch, {
        protocol: 'auto',
        secretEnc: null,
        oauthEnc: null,
        oauthIv: null,
        tokenEnc: null,
        tokenIv: null,
        oauthConnectedAt: null,
        allowedTools: [],
      });
    }
  }
  if (args.enabled !== undefined) patch.enabled = args.enabled;
  if (args.allowedTools !== undefined) patch.allowedTools = args.allowedTools;
  if (args.protocol !== undefined) patch.protocol = args.protocol;
  if (args.secret !== undefined) {
    // `secret: null` clears it; a string re-encrypts.
    patch.secretEnc = args.secret ? await encryptSecretForStorage(args.secret, args.keyMaterial) : null;
  }
  if (Object.keys(patch).length === 0) return null;

  const [row] = await db
    .update(tenantMcpExtensions)
    .set(patch)
    .where(currentUrl === undefined ? scope : and(scope, eq(tenantMcpExtensions.serverUrl, currentUrl)))
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

/**
 * Fetch + merge the tools of every ENABLED extension for a tenant.
 *
 * Each server is spoken to through {@link ./mcp/mcpWireClient}, which speaks REAL
 * MCP (JSON-RPC `tools/list`) and falls back to the legacy Builderforce REST shape,
 * so a third-party server and one written against our old docs both work. Whichever
 * transport answered is REMEMBERED on the row, so the probe is paid once per server
 * rather than on every catalog load.
 *
 * Two filters ride along, both of which used to be absent:
 *   • per-tool CONSENT — a server's tools are advertised only if the tenant approved
 *     them ({@link ./mcp/mcpToolConsent});
 *   • the advertised `mutates` flag, taken from the spec's `readOnlyHint` when the
 *     server declares one — otherwise left undefined, which every client already
 *     treats as mutating (confirm-before-write).
 *
 * An extension that errors, times out or needs an authorization we do not hold is
 * SKIPPED rather than thrown, so one bad server cannot empty the Brain's catalog.
 */
export async function listToolsForTenant(
  db: Db,
  tenantId: number,
  keyMaterial: string,
  fetchImpl: typeof fetch = fetch,
  /** When provided, the merged tool list is served through the read-through cache
   *  (L1 + AUTH_CACHE_KV, 60s) so opening the Brain doesn't hit every customer MCP
   *  server's tool listing on each mount [1406]. Invalidated by extension mutations
   *  via {@link invalidateMcpToolsCache}. Omit (e.g. unit tests) to always fetch live. */
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
          const authorization = await resolveAuthorization(db, env, row, keyMaterial);
          const listed = await listRemoteTools({
            serverUrl: row.serverUrl,
            sessionScope: `${row.tenantId}:${row.id}`,
            authorization,
            protocol: row.protocol as McpProtocol,
            fetchImpl,
          });
          await rememberProtocol(db, row, listed.protocol);
          const seen = new Set<string>();
          for (const tool of filterConsentedTools(row.allowedTools, listed.tools)) {
            if (seen.has(tool.name)) continue;
            seen.add(tool.name);
            all.push({
              extensionId: row.id,
              tool: tool.name,
              name: legacyExtensionToolName(row.id, tool.name),
              description: tool.description,
              parameters: tool.parameters,
              // Only an explicit read-only hint may claim non-mutating; a server
              // that says nothing stays undefined, which clients read as "confirm".
              ...(tool.readOnlyHint === true ? { mutates: false } : {}),
            });
          }
        } catch (error) {
          /* skip unreachable / unauthorized / malformed extension */
          reportCaughtError(error, { source: "application/llm/mcpExtensionService.ts", operation: "load" });
        }
      }),
    );
    return all;
  };

  if (!env) return load();
  return getOrSetCached(env, mcpToolsCacheKey(tenantId), load, { kvTtlSeconds: 60, l1TtlMs: 30_000 });
}

/** Persist the transport that actually answered, so `auto` probes only once. */
async function rememberProtocol(
  db: Db,
  row: typeof tenantMcpExtensions.$inferSelect,
  resolved: 'mcp' | 'legacy',
): Promise<void> {
  if (row.protocol === resolved) return;
  await db
    .update(tenantMcpExtensions)
    .set({ protocol: resolved })
    .where(scopedToTenant(tenantMcpExtensions, row.tenantId, and(
      eq(tenantMcpExtensions.id, row.id),
      eq(tenantMcpExtensions.serverUrl, row.serverUrl),
      eq(tenantMcpExtensions.protocol, row.protocol),
    )));
}

/**
 * Relay a single tool call to the owning extension's MCP server, server-to-server.
 *
 * Consent is re-checked HERE and not only on the advertise path: a model that
 * remembers a tool name from an earlier turn, or any caller reaching the relay
 * directly, must not be able to drive a tool the tenant withheld.
 */
export async function callMcpTool(
  db: Db,
  args: {
    tenantId: number;
    extensionId: string;
    tool: string;
    arguments: unknown;
    keyMaterial: string;
    /** Needed to open a sealed OAuth grant; without it only the static bearer works. */
    env?: Env;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const [row] = await db
    .select()
    .from(tenantMcpExtensions)
    .where(and(eq(tenantMcpExtensions.id, args.extensionId), eq(tenantMcpExtensions.tenantId, args.tenantId)))
    .limit(1);
  if (!row || !row.enabled) throw new Error('Unknown or disabled MCP extension');

  assertToolConsented(row.allowedTools, args.tool);

  const authorization = await resolveAuthorization(db, args.env, row, args.keyMaterial);
  const { protocol, result } = await callRemoteTool(
    {
      serverUrl: row.serverUrl,
      sessionScope: `${row.tenantId}:${row.id}`,
      authorization,
      protocol: row.protocol as McpProtocol,
      fetchImpl,
    },
    args.tool,
    args.arguments,
  );
  await rememberProtocol(db, row, protocol);
  return result;
}
