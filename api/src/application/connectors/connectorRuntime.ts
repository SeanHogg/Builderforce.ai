/**
 * Connector runtime — the ONE executor for every connector action.
 *
 * Built-in Slack, a customer's OpenAPI-imported ERP and the generic HTTP escape
 * hatch all run through this function. That is the point: SSRF guarding,
 * credential decryption, redirect handling, timeouts, response-size caps, result
 * unwrapping and audit logging are written once and cannot be skipped by a new
 * connector, because a new connector is data and never brings its own code.
 *
 * ── SECURITY POSTURE ─────────────────────────────────────────────────────────
 * A connector call is an authenticated, server-side fetch to a URL a TENANT
 * chose, carrying a secret the platform holds. Three controls, all mandatory:
 *   1. the resolved URL is re-validated immediately before the fetch, and its
 *      hostname re-resolved over DoH — registration-time validation alone loses
 *      to DNS rebinding, and the request carries the decrypted credential;
 *   2. `redirect: 'manual'` — a 302 must not bounce the authed request to an
 *      internal target after the guard has passed;
 *   3. credential values never enter a log, an error message, or the returned
 *      result; {@link redactSecrets} scrubs them from upstream error text, which
 *      routinely echoes the offending header back.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connectorConnections, connectorCallLogs } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';
import { credentialSecret, decryptCredentials } from '../integrations/credentialCrypto';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  authFieldsFor,
  fillTemplate,
  type ConnectorAction,
  type ConnectorManifest,
} from './connectorManifest';
import { findAction, resolveConnector, type ResolvedConnector } from './connectorRegistry';

/** Upstream calls are cut off here — an agent loop must not block on a hung API. */
const CALL_TIMEOUT_MS = 20_000;
/** Response bodies larger than this are truncated: they are heading for a model's
 *  context window, and a 20 MB JSON dump would evict everything else in it. */
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface ConnectorCallResult {
  ok: boolean;
  status: number;
  /** Parsed JSON (or `{ text }` for a non-JSON response), after `resultPath`. */
  data: unknown;
  error?: string;
  durationMs: number;
  truncated?: boolean;
  /**
   * Response headers the caller NAMED, and only those. Present only when
   * `captureHeaders` was passed.
   *
   * Deliberately opt-in and allowlisted rather than "all headers": a connector
   * response carries `set-cookie` and vendor auth echoes, and this result is
   * handed to model tool loops. LinkedIn is why it exists at all — it answers a
   * created post with 201, an EMPTY body and the new post's id in `x-restli-id`,
   * so without this the publisher could never record what it published.
   */
  headers?: Record<string, string>;
}

export class ConnectorCallError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'ConnectorCallError';
  }
}

// ---------------------------------------------------------------------------
// Body shaping
// ---------------------------------------------------------------------------

/**
 * Write `value` at a dotted path, creating containers as it goes. A NUMERIC
 * segment creates or indexes an array, so `content.0.value` produces
 * `{ content: [{ value: … }] }` — which is exactly the shape SendGrid, Jira and
 * Zendesk demand, and the reason manifests can stay flat while the wire format
 * is deeply nested.
 */
export function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const nextIsIndex = /^\d+$/.test(parts[i + 1]!);
    if (Array.isArray(cursor)) {
      const idx = Number(key);
      if (cursor[idx] == null) cursor[idx] = nextIsIndex ? [] : {};
      cursor = cursor[idx] as Record<string, unknown> | unknown[];
    } else {
      if (cursor[key] == null) cursor[key] = nextIsIndex ? [] : {};
      cursor = cursor[key] as Record<string, unknown> | unknown[];
    }
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(cursor)) cursor[Number(last)] = value;
  else cursor[last] = value;
}

/** Read a dotted path out of a parsed response, for `resultPath`. */
export function getDeep(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

/** Flatten a JSON value into `application/x-www-form-urlencoded` (Stripe-style
 *  bracket notation for nested objects and arrays). */
export function toFormBody(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const walk = (prefix: string, value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${prefix}[${k}]`, v);
    } else {
      params.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    if (typeof v === 'object') walk(k, v);
    else params.append(k, String(v));
  }
  return params.toString();
}

/**
 * Remove credential values from any string heading for a log, an error, or the
 * caller. Upstream 401 bodies very often quote the rejected header back verbatim.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('«redacted»');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Request assembly
// ---------------------------------------------------------------------------

interface BuiltRequest {
  url: string;
  init: RequestInit;
}

/**
 * Turn (manifest, action, args, credentials) into a concrete HTTP request.
 *
 * Exported for tests: this is where a wrong param location or a missing auth
 * header silently becomes an upstream 4xx, so it is asserted directly rather
 * than through a mocked fetch.
 */
export function buildConnectorRequest(args: {
  manifest: ConnectorManifest;
  action: ConnectorAction;
  input: Record<string, unknown>;
  auth: Record<string, string>;
  baseUrlOverride?: string | null;
}): BuiltRequest {
  const { manifest, action, input, auth } = args;

  const base = (args.baseUrlOverride?.trim() || manifest.baseUrl).replace(/\/$/, '');
  let path = action.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { Accept: 'application/json', ...(manifest.defaultHeaders ?? {}), ...(action.headers ?? {}) };
  let body: Record<string, unknown> = action.bodyTemplate
    ? (JSON.parse(JSON.stringify(action.bodyTemplate)) as Record<string, unknown>)
    : {};
  /** Set when a param declares `bodyPath: '$'` — the body IS that value. */
  let bodyOverride: unknown;

  for (const [name, param] of Object.entries(action.params)) {
    // A default may itself be a `{{auth.x}}` template (Trello's api key rides as a
    // query param alongside the token), so defaults are filled, not passed through.
    const supplied = input[name];
    const fallback = typeof param.default === 'string' ? fillTemplate(param.default, auth) : param.default;
    const value = supplied === undefined || supplied === '' ? fallback : supplied;
    if (value === undefined || value === null) continue;

    const wire = param.name ?? name;
    switch (param.in) {
      case 'path':
        path = path.split(`{${wire}}`).join(encodeURIComponent(String(value)));
        break;
      case 'query':
        // An object-typed query param SPREADS — the generic HTTP connector's
        // `query: { limit: 10 }` must become `?limit=10`, not `?query=[object]`.
        if (param.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v != null) query.append(k, String(v));
          }
        } else {
          query.append(wire, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
        break;
      case 'header':
        headers[wire] = String(value);
        break;
      case 'body':
      default:
        if (param.bodyPath === '$') bodyOverride = value;
        else if (param.bodyPath) setDeep(body, param.bodyPath, value);
        else body[wire] = value;
        break;
    }
  }

  if (bodyOverride !== undefined && typeof bodyOverride === 'object' && bodyOverride !== null) {
    body = { ...body, ...(bodyOverride as Record<string, unknown>) };
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const { kind, in: authIn, name: authName, prefix } = manifest.auth;
  if (kind === 'bearer' || kind === 'oauth2') {
    const token = auth.token ?? auth.accessToken ?? '';
    if (token) headers.Authorization = `${prefix ?? 'Bearer '}${token}`;
  } else if (kind === 'api_key') {
    const key = auth.apiKey ?? auth.token ?? '';
    const value = `${prefix ?? ''}${key}`;
    if (key) {
      if (authIn === 'query') query.set(authName || 'api_key', value);
      else headers[authName || 'Authorization'] = value;
    }
  } else if (kind === 'basic') {
    const user = auth.username ?? '';
    const pass = auth.password ?? '';
    if (user || pass) headers.Authorization = `Basic ${btoa(`${user}:${pass}`)}`;
  }

  const hasBody = action.method !== 'GET' && action.method !== 'DELETE' && Object.keys(body).length > 0;
  if (hasBody) {
    if (action.bodyFormat === 'form') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    else headers['Content-Type'] = 'application/json';
  }

  const qs = query.toString();
  const url = `${fillTemplate(base, auth)}${fillTemplate(path, auth)}${qs ? `?${qs}` : ''}`;

  return {
    url,
    init: {
      method: action.method,
      headers,
      redirect: 'manual',
      ...(hasBody ? { body: action.bodyFormat === 'form' ? toFormBody(body) : JSON.stringify(body) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ConnectionContext {
  id: string;
  connectorKey: string;
  name: string;
  auth: Record<string, string>;
  baseUrlOverride: string | null;
}

/** Load + decrypt one connection. Throws if it is missing, disabled, or foreign. */
export async function loadConnection(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: string,
): Promise<ConnectionContext> {
  const [row] = await db
    .select()
    .from(connectorConnections)
    .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new ConnectorCallError('Connection not found', 404);
  if (!row.enabled) throw new ConnectorCallError('Connection is disabled', 409);

  const blob = await decryptCredentials(row.credentialsEnc, row.iv, credentialSecret(env), tenantId);
  if (!blob) throw new ConnectorCallError('Stored credentials could not be decrypted', 500);

  return {
    id: row.id,
    connectorKey: row.connectorKey,
    name: row.name,
    auth: Object.fromEntries(Object.entries(blob).map(([k, v]) => [k, String(v ?? '')])),
    baseUrlOverride: row.baseUrlOverride,
  };
}

/**
 * Pick the connection an action should run through when the caller named a
 * connector but not a connection.
 *
 * Agents call tools by connector key; humans pick a specific connection in the UI.
 * Resolving to the OLDEST enabled connection (rather than the newest) keeps the
 * default stable as connections are added — a second, experimental Slack workspace
 * must not silently capture the traffic of the production one.
 */
export async function defaultConnectionFor(
  db: Db,
  env: Env,
  tenantId: number,
  connectorKey: string,
): Promise<ConnectionContext> {
  const rows = await db
    .select({ id: connectorConnections.id })
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.tenantId, tenantId),
        eq(connectorConnections.connectorKey, connectorKey),
        eq(connectorConnections.enabled, true),
      ),
    )
    .orderBy(connectorConnections.createdAt)
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new ConnectorCallError(`No enabled connection for connector "${connectorKey}"`, 409);
  return loadConnection(db, env, tenantId, id);
}

async function recordCall(
  db: Db,
  row: typeof connectorCallLogs.$inferInsert,
): Promise<void> {
  try {
    await db.insert(connectorCallLogs).values(row);
  } catch (error) {
    // Never let audit-write failure mask the call's own result.
    reportCaughtError(error, { source: 'application/connectors/connectorRuntime.ts', operation: 'recordCall' });
  }
}

/**
 * Execute one connector action end to end.
 *
 * Returns a RESULT rather than throwing on an upstream error: the caller is
 * usually a model's tool loop, and a 404 from Slack is information the model
 * should see and react to, not an exception that aborts the run. Genuine
 * misconfiguration (unknown connector, missing credential, blocked URL) still
 * throws {@link ConnectorCallError}, because no amount of retrying fixes it.
 */
export async function executeConnectorAction(args: {
  db: Db;
  env: Env;
  tenantId: number;
  connectorKey: string;
  actionKey: string;
  input?: Record<string, unknown>;
  /** Explicit connection; omitted callers get {@link defaultConnectionFor}. */
  connectionId?: string | null;
  actorKind?: 'agent' | 'user' | 'test';
  /** Test runs from the builder may call a DRAFT connector; agents may not. */
  allowDraft?: boolean;
  fetchImpl?: typeof fetch;
  resolvedOverride?: ResolvedConnector | null;
  /** Response headers to return, by lowercase name. See {@link ConnectorCallResult.headers}. */
  captureHeaders?: readonly string[];
}): Promise<ConnectorCallResult> {
  const {
    db, env, tenantId, connectorKey, actionKey,
    input = {}, actorKind = 'agent', allowDraft = false, fetchImpl = fetch,
  } = args;

  const resolved = args.resolvedOverride ?? (await resolveConnector(db, tenantId, connectorKey, env));
  if (!resolved) throw new ConnectorCallError(`Unknown connector "${connectorKey}"`, 404);
  if (resolved.status !== 'published' && !allowDraft) {
    throw new ConnectorCallError(`Connector "${connectorKey}" is a draft and is not callable`, 409);
  }
  const action = findAction(resolved, actionKey);
  if (!action) throw new ConnectorCallError(`Unknown action "${actionKey}" on connector "${connectorKey}"`, 404);

  const connection = args.connectionId
    ? await loadConnection(db, env, tenantId, args.connectionId)
    : await defaultConnectionFor(db, env, tenantId, connectorKey);

  // Required credentials are checked HERE, not at the fetch: "Zendesk subdomain is
  // missing" is actionable, and the alternative is a request to `https://.zendesk.com`.
  const missing = authFieldsFor(resolved.manifest)
    .filter((f) => f.required && !connection.auth[f.key])
    .map((f) => f.label);
  if (missing.length) {
    throw new ConnectorCallError(`Connection "${connection.name}" is missing: ${missing.join(', ')}`, 409);
  }

  const missingRequired = (action.required ?? []).filter(
    (r) => input[r] === undefined || input[r] === null || input[r] === '',
  );
  if (missingRequired.length) {
    throw new ConnectorCallError(`Missing required argument(s): ${missingRequired.join(', ')}`, 400);
  }

  const secrets = authFieldsFor(resolved.manifest)
    .filter((f) => f.secret)
    .map((f) => connection.auth[f.key] ?? '')
    .filter(Boolean);

  const { url, init } = buildConnectorRequest({
    manifest: resolved.manifest,
    action,
    input,
    auth: connection.auth,
    baseUrlOverride: connection.baseUrlOverride,
  });

  // Guard the RESOLVED url (templates filled, override applied) and re-resolve its
  // hostname — see the security note at the top of this file.
  let safeUrl: URL;
  try {
    safeUrl = assertSafeUrl(url, { allowHttp: false });
    await resolveAndAssertPublic(safeUrl.hostname);
  } catch (e) {
    throw new ConnectorCallError(
      redactSecrets(e instanceof Error ? e.message : 'Blocked URL', secrets),
      400,
    );
  }

  const started = Date.now();
  let status = 0;
  let ok = false;
  let data: unknown = null;
  let errorText: string | undefined;
  let truncated = false;
  let captured: Record<string, string> | undefined;

  try {
    const res = await fetchImpl(safeUrl.toString(), {
      ...init,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    status = res.status;

    if (args.captureHeaders?.length) {
      captured = {};
      for (const name of args.captureHeaders) {
        const value = res.headers?.get(name);
        if (value) captured[name.toLowerCase()] = value;
      }
    }

    // `redirect: 'manual'` surfaces a 3xx as a real response — report it rather
    // than following it to who-knows-where.
    if (status >= 300 && status < 400) {
      ok = false;
      errorText = `Upstream redirected (${status}); connector calls do not follow redirects`;
    } else {
      const raw = await res.text();
      if (raw.length > MAX_RESPONSE_BYTES) truncated = true;
      const clipped = truncated ? raw.slice(0, MAX_RESPONSE_BYTES) : raw;
      let parsed: unknown;
      try {
        parsed = clipped ? JSON.parse(clipped) : null;
      } catch {
        parsed = { text: clipped };
      }
      ok = res.ok;
      if (ok) {
        data = action.resultPath ? getDeep(parsed, action.resultPath) ?? parsed : parsed;
      } else {
        data = parsed;
        errorText = redactSecrets(
          typeof clipped === 'string' && clipped ? clipped.slice(0, 600) : `Upstream returned ${status}`,
          secrets,
        );
      }
    }
  } catch (e) {
    ok = false;
    const raw = e instanceof Error ? e.message : 'Connector request failed';
    errorText = redactSecrets(raw.includes('aborted') || raw.includes('timed out')
      ? `Upstream did not respond within ${CALL_TIMEOUT_MS / 1000}s`
      : raw, secrets);
    reportCaughtError(e, { source: 'application/connectors/connectorRuntime.ts', operation: `call:${connectorKey}.${actionKey}` });
  }

  const durationMs = Date.now() - started;

  await recordCall(db, {
    tenantId,
    connectionId: connection.id,
    connectorKey,
    actionKey,
    ok,
    statusCode: status || null,
    durationMs,
    error: errorText ? errorText.slice(0, 1000) : null,
    actorKind,
  });

  // Best-effort freshness marker for the connections list; never blocks the result.
  if (ok) {
    await db
      .update(connectorConnections)
      .set({ lastUsedAt: sql`NOW()` })
      .where(scopedToTenant(connectorConnections, tenantId, eq(connectorConnections.id, connection.id)))
      .catch(() => undefined);
  }

  return {
    ok, status, data, durationMs,
    ...(errorText ? { error: errorText } : {}),
    ...(truncated ? { truncated } : {}),
    ...(captured && Object.keys(captured).length ? { headers: captured } : {}),
  };
}
