/**
 * Connectors → agent tools.
 *
 * The third and last source feeding `GET /v1/mcp/tools`, alongside the in-process
 * built-in catalog and external tenant MCP servers. Every client — the web Brain,
 * the VS Code extension, the cloud agent-runtime, an external MCP client — gets
 * connector actions through the SAME endpoint it already reads, so none of them
 * needed a change to gain 25 integrations.
 *
 * ── ONLY CONNECTED CONNECTORS ARE ADVERTISED ─────────────────────────────────
 * A connector with no enabled connection contributes NOTHING to the tool list.
 * This is deliberate and it is the difference between a usable catalog and an
 * unusable one: 25 built-ins × ~4 actions is ~100 tools, and advertising all of
 * them to every tenant would crowd the platform's own tools out of the model's
 * context to offer capabilities that would fail on the first call with "no
 * credentials". You get the tools for the systems you actually connected.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connectorConnections } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { McpToolEntry } from '../llm/mcpExtensionService';
import { actionInputSchema } from './connectorManifest';
import { listPublishedConnectors } from './connectorRegistry';
import { executeConnectorAction, type ConnectorCallResult } from './connectorRuntime';

/** Sentinel `extensionId` the gateway routes to the connector runtime. */
export const CONNECTOR_EXTENSION_ID = 'connector';

/** Separator inside the round-tripped `tool` value. Not `.` — some clients flatten dots. */
const TOOL_SEP = '::';

/**
 * The name a connector action is advertised to the MODEL under.
 *
 * Single source, for the reason documented in `llm/toolNaming.ts`: a prompt or a
 * client that hand-types a tool name the catalog never advertised produces a model
 * that describes the call instead of making it, with no failure signal anywhere.
 */
export function connectorToolName(connectorKey: string, actionKey: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_');
  return `conn_${safe(connectorKey)}_${safe(actionKey)}`;
}

/** The round-tripped `tool` value the client sends back on `/v1/mcp/call`. */
export function encodeConnectorTool(connectorKey: string, actionKey: string): string {
  return `${connectorKey}${TOOL_SEP}${actionKey}`;
}

/** Inverse of {@link encodeConnectorTool}. Returns null on a malformed value. */
export function decodeConnectorTool(tool: string): { connectorKey: string; actionKey: string } | null {
  const i = tool.indexOf(TOOL_SEP);
  if (i <= 0) return null;
  const connectorKey = tool.slice(0, i);
  const actionKey = tool.slice(i + TOOL_SEP.length);
  if (!connectorKey || !actionKey) return null;
  return { connectorKey, actionKey };
}

const connectedKeysCacheKey = (tenantId: number): string => `connectors:connected:${tenantId}`;

/** Drop the cached connected-key set. Call after any CONNECTION mutation. */
export async function invalidateConnectedConnectors(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, connectedKeysCacheKey(tenantId));
}

/** Connector keys this tenant has at least one enabled connection for. */
export async function connectedConnectorKeys(db: Db, tenantId: number, env?: Env): Promise<string[]> {
  const load = async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ key: connectorConnections.connectorKey })
      .from(connectorConnections)
      .where(and(eq(connectorConnections.tenantId, tenantId), eq(connectorConnections.enabled, true)));
    return rows.map((r) => r.key);
  };
  if (!env) return load();
  return getOrSetCached(env, connectedKeysCacheKey(tenantId), load, { kvTtlSeconds: 300, l1TtlMs: 60_000 });
}

/**
 * Advertise every action of every PUBLISHED connector the tenant has connected.
 */
export async function listConnectorTools(db: Db, tenantId: number, env?: Env): Promise<McpToolEntry[]> {
  const connected = new Set(await connectedConnectorKeys(db, tenantId, env));
  if (connected.size === 0) return [];

  const catalog = await listPublishedConnectors(db, tenantId, env);
  const tools: McpToolEntry[] = [];
  for (const entry of catalog) {
    if (!connected.has(entry.manifest.key)) continue;
    for (const action of entry.manifest.actions) {
      tools.push({
        extensionId: CONNECTOR_EXTENSION_ID,
        tool: encodeConnectorTool(entry.manifest.key, action.key),
        name: connectorToolName(entry.manifest.key, action.key),
        // The model picks tools by description alone, so name the SYSTEM in it —
        // "Post a message" is ambiguous across Slack, Discord and Teams.
        description: `${entry.manifest.name}: ${action.description || action.label}`,
        parameters: actionInputSchema(action),
        mutates: action.mutates,
      });
    }
  }
  return tools;
}

/**
 * Execute one advertised connector tool. Shaped for the gateway's tool loop: an
 * upstream error comes back as `{ ok: false, error }` for the model to read, not
 * as a thrown exception that aborts the run.
 */
export async function callConnectorTool(args: {
  db: Db;
  env: Env;
  tenantId: number;
  tool: string;
  arguments?: unknown;
  actorKind?: 'agent' | 'user' | 'test';
}): Promise<ConnectorCallResult> {
  const decoded = decodeConnectorTool(args.tool);
  if (!decoded) throw new Error(`Malformed connector tool name "${args.tool}"`);
  return executeConnectorAction({
    db: args.db,
    env: args.env,
    tenantId: args.tenantId,
    connectorKey: decoded.connectorKey,
    actionKey: decoded.actionKey,
    input: (args.arguments as Record<string, unknown> | undefined) ?? {},
    actorKind: args.actorKind ?? 'agent',
  });
}
