/**
 * The OUTBOUND MCP client — how Builderforce talks to somebody else's MCP server.
 *
 * `presentation/routes/mcpServerRoutes.ts` is the mirror of this file: there we ARE
 * a spec MCP server. Here we are a spec MCP CLIENT, which until now we were not —
 * the gateway spoke a Builderforce-shaped REST pair (`GET {url}/tools`, `POST
 * {url}/call`) that no third-party server implements, so "register your MCP server"
 * only worked for a server somebody had written against our docs.
 *
 * Two transports live here behind ONE interface, because the choice is a property
 * of the far end and nothing above should branch on it:
 *
 *   `mcp`    — JSON-RPC 2.0 over Streamable HTTP: `initialize` → (notification)
 *              `notifications/initialized` → `tools/list` / `tools/call`. Answers
 *              arrive as `application/json` or as an SSE stream carrying one
 *              message, and both are accepted because both are spec-legal.
 *   `legacy` — the original Builderforce REST pair, kept working for every server
 *              already registered against it.
 *
 * `auto` probes the spec transport first and falls back. The caller remembers what
 * answered (`tenant_mcp_extensions.protocol`) so the probe is paid once per server.
 *
 * SECURITY. Every request out of this module is made by the gateway, from our
 * network, carrying the tenant's credential — which is the whole reason the
 * roadmap entry asked for this to be built deliberately. So: the URL is re-checked
 * against the SSRF guard immediately before each fetch (a hostname that was public
 * at registration can be re-pointed at a private address later), redirects are
 * `manual` so a 302 cannot bounce an authed request inward, and a 401 is turned
 * into a typed {@link McpAuthChallenge} rather than being retried with anything.
 */

import { assertSafeUrl, resolveAndAssertPublic } from '../../../infrastructure/net/ssrfGuard';

/** How a server is addressed. `auto` = probe, then remember what answered. */
export type McpProtocol = 'auto' | 'mcp' | 'legacy';

/** The revision we announce on `initialize`. */
const CLIENT_PROTOCOL_VERSION = '2025-06-18';
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
}

/**
 * The far server demanded authorization. Carries the `WWW-Authenticate` challenge
 * so the OAuth layer can discover where to send the human, WITHOUT this module
 * knowing anything about OAuth.
 */
export class McpAuthChallenge extends Error {
  constructor(
    readonly status: number,
    /** Raw `WWW-Authenticate` header, if the server sent one. */
    readonly challenge: string | null,
  ) {
    super(`MCP server requires authorization (HTTP ${status})`);
    this.name = 'McpAuthChallenge';
  }
}

/** What a transport probe resolved to, so the caller can persist it. */
export interface McpListResult {
  tools: RemoteToolDescriptor[];
  /** The transport that actually answered — never `auto`. */
  protocol: Exclude<McpProtocol, 'auto'>;
}

const trimUrl = (url: string): string => url.replace(/\/+$/, '');

/** Re-validate + resolve immediately before an authed fetch (DNS rebinding). */
async function assertLiveSafe(url: string): Promise<URL> {
  const parsed = assertSafeUrl(url, { allowHttp: false });
  await resolveAndAssertPublic(parsed.hostname);
  return parsed;
}

function headersFor(conn: McpServerConnection, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept, 'Content-Type': 'application/json' };
  if (conn.authorization) headers.Authorization = conn.authorization;
  return headers;
}

/** A JSON-RPC response can arrive as one JSON object or as an SSE stream whose
 *  `data:` lines carry it. Accept both — the spec permits either per request. */
async function readJsonRpcBody(res: Response): Promise<Record<string, unknown> | null> {
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!text) return null;
  if (!contentType.includes('text/event-stream')) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  // Last `data:` payload that parses as a JSON-RPC response wins; a server may
  // send progress notifications ahead of the result on the same stream.
  let latest: Record<string, unknown> | null = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      if ('result' in parsed || 'error' in parsed) latest = parsed;
    } catch {
      // A partial or non-JSON frame is not a result — skip it and keep scanning.
      continue;
    }
  }
  return latest;
}

interface RpcOptions {
  /** Session id from `initialize`, echoed on every later request. */
  sessionId?: string | null;
  /** A notification carries no id and expects no answer. */
  notification?: boolean;
}

/** One JSON-RPC request against the server's single endpoint. */
async function rpc(
  conn: McpServerConnection,
  method: string,
  params: Record<string, unknown>,
  options: RpcOptions = {},
): Promise<{ result: Record<string, unknown> | null; sessionId: string | null }> {
  await assertLiveSafe(conn.serverUrl);
  const doFetch = conn.fetchImpl ?? fetch;
  const headers = headersFor(conn, 'application/json, text/event-stream');
  headers['MCP-Protocol-Version'] = CLIENT_PROTOCOL_VERSION;
  if (options.sessionId) headers['Mcp-Session-Id'] = options.sessionId;

  const body = options.notification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: `bf-${method}`, method, params };

  const res = await doFetch(trimUrl(conn.serverUrl), {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    throw new McpAuthChallenge(res.status, res.headers.get('www-authenticate'));
  }
  if (!res.ok) throw new Error(`MCP server returned ${res.status} for ${method}`);

  const sessionId = res.headers.get('mcp-session-id');
  if (options.notification) return { result: null, sessionId };

  const parsed = await readJsonRpcBody(res);
  if (!parsed) throw new Error(`MCP server sent no JSON-RPC response for ${method}`);
  if (parsed.error) {
    const err = parsed.error as { message?: string; code?: number };
    throw new Error(err.message ? `MCP error: ${err.message}` : `MCP error ${err.code ?? ''}`.trim());
  }
  return { result: (parsed.result ?? {}) as Record<string, unknown>, sessionId };
}

/** Open a session: `initialize`, then the `initialized` notification the spec
 *  requires before any other request. Returns the session id when one is issued
 *  (a stateless server issues none, and that is legal). */
async function initialize(conn: McpServerConnection): Promise<string | null> {
  const { sessionId } = await rpc(conn, 'initialize', {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });
  // Best-effort: a server that rejects the notification is still usable.
  await rpc(conn, 'notifications/initialized', {}, { sessionId, notification: true }).catch(() => undefined);
  return sessionId;
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

/** `tools/list`, following the spec's `nextCursor` pagination to the end. */
async function listToolsOverMcp(conn: McpServerConnection): Promise<RemoteToolDescriptor[]> {
  const sessionId = await initialize(conn);
  const tools: RemoteToolDescriptor[] = [];
  let cursor: string | undefined;
  // Bounded: a server that keeps handing back a cursor must not spin the gateway.
  for (let page = 0; page < 20; page++) {
    const { result } = await rpc(conn, 'tools/list', cursor ? { cursor } : {}, { sessionId });
    for (const raw of (result?.tools as unknown[] | undefined) ?? []) {
      const tool = toDescriptor(raw);
      if (tool) tools.push(tool);
    }
    const next = result?.nextCursor;
    if (typeof next !== 'string' || !next) break;
    cursor = next;
  }
  return tools;
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
  const sessionId = await initialize(conn);
  const { result } = await rpc(conn, 'tools/call', { name: tool, arguments: args ?? {} }, { sessionId });
  if (!result) return {};
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
  await assertLiveSafe(conn.serverUrl);
  const doFetch = conn.fetchImpl ?? fetch;
  const res = await doFetch(`${trimUrl(conn.serverUrl)}/tools`, {
    headers: headersFor(conn, 'application/json'),
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new McpAuthChallenge(res.status, res.headers.get('www-authenticate'));
  }
  if (!res.ok) throw new Error(`MCP server returned ${res.status} listing tools`);
  const body = (await res.json()) as { tools?: unknown[] };
  return (body.tools ?? []).map(toDescriptor).filter((t): t is RemoteToolDescriptor => t !== null);
}

async function callToolOverLegacy(conn: McpServerConnection, tool: string, args: unknown): Promise<unknown> {
  await assertLiveSafe(conn.serverUrl);
  const doFetch = conn.fetchImpl ?? fetch;
  const res = await doFetch(`${trimUrl(conn.serverUrl)}/call`, {
    method: 'POST',
    headers: headersFor(conn, 'application/json'),
    redirect: 'manual',
    body: JSON.stringify({ tool, arguments: args ?? {} }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
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
    if (err instanceof McpAuthChallenge) throw err;
    return { result: await callToolOverLegacy(conn, tool, args), protocol: 'legacy' };
  }
}
