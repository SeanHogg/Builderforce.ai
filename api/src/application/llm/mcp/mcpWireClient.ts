/** Guarded gateway adapter for Streamable HTTP MCP and registered legacy REST servers. */

import { createMcpHttpClient, McpAuthChallenge, isExpiredMcpSession, type McpHttpSession } from '@seanhogg/builderforce-mcp/client';
import { assertSafeUrl } from '../../../infrastructure/net/ssrfGuard';
import { fetchPublic } from '../../../infrastructure/net/fetchPublic';

/** How a server is addressed. `auto` = probe, then remember what answered. */
export type McpProtocol = 'auto' | 'mcp' | 'legacy';

const CLIENT_INFO = { name: 'builderforce-gateway', title: 'Builderforce', version: '1.0.0' } as const;

/** Wall-clock ceiling on one call to a customer server. */
const REQUEST_TIMEOUT_MS = 20_000;

/** One tool exactly as the far server advertises it, before we namespace it. */
export interface RemoteToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Spec `annotations.readOnlyHint`, when the server bothers to declare it. */
  readOnlyHint?: boolean;
}

/** Everything a call needs about ONE server. Deliberately not the DB row: this
 *  module knows nothing about tenants, sealing or storage. */
export interface McpServerConnection {
  serverUrl: string;
  /** Fully-formed `Authorization` header value, or null for an open server. */
  authorization: string | null;
  protocol: McpProtocol;
  fetchImpl?: typeof fetch;
  /** Tenant and extension identity. Omit to use a fresh connection. */
  sessionScope?: string;
}

export { McpAuthChallenge };

/** What a transport probe resolved to, so the caller can persist it. */
export interface McpListResult {
  tools: RemoteToolDescriptor[];
  /** The transport that actually answered — never `auto`. */
  protocol: Exclude<McpProtocol, 'auto'>;
}

const trimUrl = (url: string): string => url.replace(/\/+$/, '');

/** Re-validate the URL immediately before an authed call. The DNS-rebinding half is
 *  `fetchPublic`'s, which re-resolves the host during the request too — this stays a
 *  separate step because the call sites validate before building the request body. */
function assertLiveSafe(url: string): URL {
  return assertSafeUrl(url, { allowHttp: false });
}

function headersFor(conn: McpServerConnection, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept, 'Content-Type': 'application/json' };
  if (conn.authorization) headers.Authorization = conn.authorization;
  return headers;
}

// Cache session metadata only. Worker isolates cannot share promises or fetch streams between requests.
const sessions = new Map<string, { session: McpHttpSession; expires: number }>();
const SESSION_TTL_MS = 5 * 60_000;
const MAX_SESSIONS = 256;

async function sessionKey(conn: McpServerConnection): Promise<string | undefined> {
  if (!conn.sessionScope) return;
  const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(conn.authorization ?? ''));
  const digest = Array.from(new Uint8Array(fingerprint), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return JSON.stringify([conn.sessionScope, conn.serverUrl, digest]);
}

class McpNegotiationError extends Error {
  constructor(cause: unknown) {
    super('MCP session initialization failed', { cause });
  }
}

async function usingMcp<T>(
  conn: McpServerConnection,
  run: (client: ReturnType<typeof createMcpHttpClient>) => Promise<T>,
  recoverExpiredSession: boolean,
): Promise<T> {
  assertLiveSafe(conn.serverUrl);
  const key = await sessionKey(conn);
  const cached = key ? sessions.get(key) : undefined;
  const live = cached && cached.expires > Date.now() ? cached.session : undefined;

  async function runSession(session?: McpHttpSession): Promise<T> {
    const client = createMcpHttpClient({
      url: trimUrl(conn.serverUrl), authorization: conn.authorization, info: CLIENT_INFO,
      timeoutMs: REQUEST_TIMEOUT_MS, session,
      fetch: (url, options) => fetchPublic(url as string, options, { fetchImpl: conn.fetchImpl }),
    });
    await client.start();
    try {
      if (!session) {
        try {
          session = await client.initialize();
        } catch (error) {
          if (error instanceof McpAuthChallenge) throw error;
          throw new McpNegotiationError(error);
        }
        if (key) {
          sessions.delete(key);
          sessions.set(key, { session, expires: Date.now() + SESSION_TTL_MS });
          if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
        }
      }
      return await run(client);
    } finally {
      await client.close();
    }
  }

  try {
    return await runSession(live);
  } catch (error) {
    if (!live || !key || !isExpiredMcpSession(error)) throw error;
    if (sessions.get(key) === cached) sessions.delete(key);
    // Only replay discovery. A misbehaving upstream may return 404 after a write.
    if (!recoverExpiredSession) throw error;
    return runSession(sessions.get(key)?.session);
  }
}

function toDescriptor(raw: unknown): RemoteToolDescriptor | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== 'string' || !t.name) return null;
  const schema = (t.inputSchema ?? t.parameters) as Record<string, unknown> | undefined;
  const annotations = t.annotations as { readOnlyHint?: unknown } | undefined;
  return {
    name: t.name,
    description: typeof t.description === 'string' ? t.description : '',
    parameters: schema && typeof schema === 'object' ? schema : { type: 'object', properties: {} },
    ...(typeof annotations?.readOnlyHint === 'boolean' ? { readOnlyHint: annotations.readOnlyHint } : {}),
  };
}

async function listToolsOverMcp(conn: McpServerConnection): Promise<RemoteToolDescriptor[]> {
  const tools = await usingMcp(conn, (client) => client.listTools(), true);
  return tools.map(toDescriptor).filter((tool): tool is RemoteToolDescriptor => tool !== null);
}

/**
 * `tools/call`. An MCP result is content blocks plus an `isError` flag; a tool-level
 * failure is a RESULT, not a transport error, so it is surfaced as `{ error }` for
 * the model to read rather than thrown at the run loop.
 */
async function callToolOverMcp(
  conn: McpServerConnection,
  tool: string,
  args: unknown,
): Promise<unknown> {
  if (args != null && (typeof args !== 'object' || Array.isArray(args))) throw new Error('MCP tool arguments must be an object');
  const result = await usingMcp(conn, (client) => client.callTool(tool, (args ?? {}) as Record<string, unknown>), false);
  if (result.structuredContent !== undefined && !result.isError) return result.structuredContent;
  const content = (result.content as Array<Record<string, unknown>> | undefined) ?? [];
  const text = content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
  if (result.isError) return { error: text || 'Tool call failed' };
  return text || result;
}

// ---------------------------------------------------------------------------
// Legacy Builderforce REST shape — kept working for servers registered against it
// ---------------------------------------------------------------------------

async function listToolsOverLegacy(conn: McpServerConnection): Promise<RemoteToolDescriptor[]> {
  assertLiveSafe(conn.serverUrl);
  const res = await fetchPublic(`${trimUrl(conn.serverUrl)}/tools`, {
    headers: headersFor(conn, 'application/json'),
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, conn.fetchImpl ? { fetchImpl: conn.fetchImpl } : {});
  if (res.status === 401 || res.status === 403) {
    throw new McpAuthChallenge(res.status, res.headers.get('www-authenticate'));
  }
  if (!res.ok) throw new Error(`MCP server returned ${res.status} listing tools`);
  const body = (await res.json()) as { tools?: unknown[] };
  return (body.tools ?? []).map(toDescriptor).filter((t): t is RemoteToolDescriptor => t !== null);
}

async function callToolOverLegacy(conn: McpServerConnection, tool: string, args: unknown): Promise<unknown> {
  assertLiveSafe(conn.serverUrl);
  const res = await fetchPublic(`${trimUrl(conn.serverUrl)}/call`, {
    method: 'POST',
    headers: headersFor(conn, 'application/json'),
    redirect: 'manual',
    body: JSON.stringify({ tool, arguments: args ?? {} }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, conn.fetchImpl ? { fetchImpl: conn.fetchImpl } : {});
  if (res.status === 401 || res.status === 403) {
    throw new McpAuthChallenge(res.status, res.headers.get('www-authenticate'));
  }
  if (!res.ok) throw new Error(`MCP extension returned ${res.status}`);
  return res.json().catch(() => ({}));
}

// ---------------------------------------------------------------------------
// The one interface everything above the transport uses
// ---------------------------------------------------------------------------

/**
 * List a server's tools, resolving `auto` to whichever transport answers.
 *
 * The spec transport is tried FIRST and the legacy shape is the fallback, so a
 * genuine MCP server — the case that never worked — is the fast path, and a
 * Builderforce-shaped server pays one failed POST the first time and never again
 * (the caller persists `protocol`). An auth challenge is NOT a transport failure
 * and must not trigger the fallback: it means we reached the right server.
 */
export async function listRemoteTools(conn: McpServerConnection): Promise<McpListResult> {
  if (conn.protocol === 'legacy') {
    return { tools: await listToolsOverLegacy(conn), protocol: 'legacy' };
  }
  if (conn.protocol === 'mcp') {
    return { tools: await listToolsOverMcp(conn), protocol: 'mcp' };
  }
  try {
    return { tools: await listToolsOverMcp(conn), protocol: 'mcp' };
  } catch (err) {
    if (err instanceof McpAuthChallenge) throw err;
    return { tools: await listToolsOverLegacy(conn), protocol: 'legacy' };
  }
}

/** Invoke one tool over whichever transport this server speaks. */
export async function callRemoteTool(
  conn: McpServerConnection,
  tool: string,
  args: unknown,
): Promise<{ result: unknown; protocol: Exclude<McpProtocol, 'auto'> }> {
  if (conn.protocol === 'legacy') {
    return { result: await callToolOverLegacy(conn, tool, args), protocol: 'legacy' };
  }
  if (conn.protocol === 'mcp') {
    return { result: await callToolOverMcp(conn, tool, args), protocol: 'mcp' };
  }
  try {
    return { result: await callToolOverMcp(conn, tool, args), protocol: 'mcp' };
  } catch (err) {
    if (!(err instanceof McpNegotiationError)) throw err;
    return { result: await callToolOverLegacy(conn, tool, args), protocol: 'legacy' };
  }
}
