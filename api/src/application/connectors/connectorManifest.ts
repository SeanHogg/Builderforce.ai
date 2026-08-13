/**
 * Connector manifest — the ONE declarative contract for "an external system
 * Builderforce can act on".
 *
 * ── WHY A MANIFEST AND NOT A CODED ADAPTER ───────────────────────────────────
 * The board-sync providers ({@link ../boardsync/providerCatalog}) are hand-written
 * TypeScript adapters. That is the right shape for the handful of systems whose
 * work items we MODEL (a Jira issue becomes a task). It is the wrong shape for
 * breadth: every new system costs a code change, a deploy, and a reviewer.
 *
 * A connector is the breadth answer. It is pure DATA — base URL, auth shape, and a
 * list of actions, each an HTTP call with a JSON-Schema input. That means:
 *   • a customer can author one in the UI (or by pasting an OpenAPI spec) with no
 *     code, no hosting, and no deploy — unlike {@link ../llm/mcpExtensionService},
 *     which requires them to STAND UP AND OPERATE an MCP server;
 *   • the platform can ship a default catalog as plain manifests (see `defaults/`);
 *   • one executor ({@link ./connectorRuntime}) runs all of them, so SSRF guarding,
 *     credential decryption, redaction, logging and rate limiting are written once.
 *
 * Every action becomes a tool the agents can call, advertised through the SAME
 * gateway endpoints as the built-in and MCP-extension tools — a connector is not a
 * second tool system, it is a third source feeding the one catalog.
 *
 * ── TRUST BOUNDARY ───────────────────────────────────────────────────────────
 * A manifest is UNTRUSTED INPUT: tenants author it. Everything reachable from a
 * manifest is validated here, at parse time, and the runtime consumes only the
 * validated shape. In particular `baseUrl` is SSRF-checked at both author time and
 * call time (DNS rebinding), and auth field values never appear in a manifest —
 * they live encrypted on the connection row.
 */

import { assertSafeUrl } from '../../infrastructure/net/ssrfGuard';

/** Broad grouping used by the catalog UI. Kept small on purpose. */
export const CONNECTOR_CATEGORIES = [
  'communication',
  'crm',
  'productivity',
  'devtools',
  'finance',
  'marketing',
  'support',
  'storage',
  'data',
  // Job boards, ATS feeds and HRMS systems. Its own category rather than `marketing`
  // (which is where an outbound-publishing connector would otherwise land) because the
  // Recruiter seat browses this catalog by category, and "publish a requisition" and
  // "publish a campaign" are done by different people for different reasons.
  'hiring',
  'other',
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

/** How the platform authenticates to the connector's API. */
export const CONNECTOR_AUTH_KINDS = ['none', 'api_key', 'bearer', 'basic', 'oauth2'] as const;
export type ConnectorAuthKind = (typeof CONNECTOR_AUTH_KINDS)[number];

export const CONNECTOR_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ConnectorMethod = (typeof CONNECTOR_METHODS)[number];

/** Where a validated input value is placed on the outbound HTTP request. */
export const CONNECTOR_PARAM_LOCATIONS = ['path', 'query', 'body', 'header'] as const;
export type ConnectorParamLocation = (typeof CONNECTOR_PARAM_LOCATIONS)[number];

export const CONNECTOR_PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;
export type ConnectorParamType = (typeof CONNECTOR_PARAM_TYPES)[number];

/**
 * One credential value the tenant supplies when they connect. Values are stored
 * encrypted on `connector_connections`, never in the manifest.
 */
export interface ConnectorAuthField {
  /** Key the runtime substitutes as `{{auth.<key>}}`. */
  key: string;
  label: string;
  /** Masked in the UI and redacted from every log. Non-secret fields (a subdomain,
   *  an account id) are shown in clear so the connection is identifiable. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface ConnectorAuth {
  kind: ConnectorAuthKind;
  /** api_key only — where the key rides. */
  in?: 'header' | 'query';
  /** api_key only — the header or query-param name (e.g. `X-Api-Key`). */
  name?: string;
  /** Value prefix, e.g. `Bearer ` or `Token `. Applied to api_key and bearer. */
  prefix?: string;
  /** oauth2 only — the authorization-code endpoints. */
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  /** Credential inputs shown on the connect form. Defaulted per `kind` when omitted. */
  fields?: ConnectorAuthField[];
}

export interface ConnectorParam {
  type: ConnectorParamType;
  description?: string;
  /** Where this value goes on the request. */
  in: ConnectorParamLocation;
  /** Wire name if it differs from the property key (e.g. `channel` → `channel_id`). */
  name?: string;
  enum?: string[];
  default?: unknown;
  /** Dot path for a nested body field, e.g. `fields.summary`. `in: 'body'` only. */
  bodyPath?: string;
}

export interface ConnectorAction {
  /** Stable key, `[a-z0-9_]`. Part of the advertised tool name. */
  key: string;
  label: string;
  description: string;
  method: ConnectorMethod;
  /** Path appended to baseUrl. `{placeholders}` are filled from `in: 'path'` params. */
  path: string;
  /**
   * Whether the action changes state in the external system. Drives the same
   * confirm gate every other tool source uses — see `McpToolEntry.mutates`.
   * Required (no default): "did I just let an agent delete a customer record?"
   * is not a question a manifest should leave to inference.
   */
  mutates: boolean;
  params: Record<string, ConnectorParam>;
  required?: string[];
  /** Static body merged UNDER the mapped params (params win on conflict). */
  bodyTemplate?: Record<string, unknown>;
  /** Static headers merged under mapped header params. */
  headers?: Record<string, string>;
  /**
   * Body encoding. `json` (default) sends `application/json`; `form` sends
   * `application/x-www-form-urlencoded` — required by Stripe and a long tail of
   * older APIs that reject a JSON body outright.
   */
  bodyFormat?: 'json' | 'form';
  /** Dot path into the JSON response to return instead of the whole body. */
  resultPath?: string;
}

export interface ConnectorManifest {
  /** Catalog key, `[a-z0-9-]`. Unique per tenant; built-in keys are reserved. */
  key: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  /** Emoji shown on the catalog card — no remote image, no CSP problem. */
  icon: string;
  /**
   * API root. May contain `{{auth.<field>}}` placeholders so per-tenant hosts
   * (`https://{{auth.subdomain}}.zendesk.com/api/v2`) work without a code branch.
   */
  baseUrl: string;
  docsUrl?: string;
  auth: ConnectorAuth;
  /**
   * Headers sent on EVERY action (API version pins like `Notion-Version`, `Accept`
   * negotiation). Per-action `headers` and header params override these — declaring
   * a version pin once beats repeating it on every action and drifting.
   */
  defaultHeaders?: Record<string, string>;
  actions: ConnectorAction[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ACTION_KEY_RE = /^[a-z0-9][a-z0-9_]{0,62}$/;
const AUTH_FIELD_RE = /^[a-zA-Z0-9_]{1,40}$/;

/** Max actions per connector — a manifest is advertised into the model's tool list,
 *  and an unbounded list would blow the prompt budget for every other tool. */
export const MAX_ACTIONS_PER_CONNECTOR = 40;

export class ConnectorManifestError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] ?? 'Invalid connector manifest');
    this.name = 'ConnectorManifestError';
  }
}

/** `{{auth.field}}` references in a template string. */
const TEMPLATE_RE = /\{\{\s*auth\.([a-zA-Z0-9_]+)\s*\}\}/g;

export function templateAuthKeys(input: string): string[] {
  return [...input.matchAll(TEMPLATE_RE)].map((m) => m[1]!);
}

/**
 * Substitute `{{auth.x}}` placeholders from a resolved credential blob.
 * Missing keys resolve to '' — the caller validates required fields separately, so
 * a half-configured connection fails on the HTTP call (visible, logged) rather
 * than silently sending the literal `{{auth.x}}` upstream.
 */
export function fillTemplate(input: string, auth: Record<string, string>): string {
  return input.replace(TEMPLATE_RE, (_m, key: string) => auth[key] ?? '');
}

/** Default credential fields for an auth kind, when the manifest doesn't name its own. */
export function defaultAuthFields(kind: ConnectorAuthKind): ConnectorAuthField[] {
  switch (kind) {
    case 'api_key':
      return [{ key: 'apiKey', label: 'API key', secret: true, required: true }];
    case 'bearer':
      return [{ key: 'token', label: 'Access token', secret: true, required: true }];
    case 'basic':
      return [
        { key: 'username', label: 'Username', secret: false, required: true },
        { key: 'password', label: 'Password or API token', secret: true, required: true },
      ];
    case 'oauth2':
      return [{ key: 'accessToken', label: 'Access token', secret: true, required: true }];
    case 'none':
    default:
      return [];
  }
}

/** Every credential field a connection for this manifest must collect. */
export function authFieldsFor(manifest: ConnectorManifest): ConnectorAuthField[] {
  const declared = manifest.auth.fields ?? [];
  if (declared.length > 0) return declared;
  return defaultAuthFields(manifest.auth.kind);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateAction(raw: unknown, index: number, errors: string[]): ConnectorAction | null {
  const where = `actions[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  const key = String(raw.key ?? '');
  if (!ACTION_KEY_RE.test(key)) {
    errors.push(`${where}.key: must match [a-z0-9][a-z0-9_]* (got "${key}")`);
    return null;
  }
  const method = String(raw.method ?? '').toUpperCase() as ConnectorMethod;
  if (!CONNECTOR_METHODS.includes(method)) {
    errors.push(`${where}.method: must be one of ${CONNECTOR_METHODS.join(', ')}`);
    return null;
  }
  const path = String(raw.path ?? '');
  if (!path.startsWith('/')) {
    errors.push(`${where}.path: must start with "/"`);
    return null;
  }
  if (typeof raw.mutates !== 'boolean') {
    errors.push(`${where}.mutates: required boolean — declare whether this action changes state`);
    return null;
  }

  const params: Record<string, ConnectorParam> = {};
  const rawParams = isPlainObject(raw.params) ? raw.params : {};
  for (const [name, p] of Object.entries(rawParams)) {
    if (!isPlainObject(p)) {
      errors.push(`${where}.params.${name}: must be an object`);
      continue;
    }
    const type = String(p.type ?? 'string') as ConnectorParamType;
    const loc = String(p.in ?? '') as ConnectorParamLocation;
    if (!CONNECTOR_PARAM_TYPES.includes(type)) {
      errors.push(`${where}.params.${name}.type: unsupported "${type}"`);
      continue;
    }
    if (!CONNECTOR_PARAM_LOCATIONS.includes(loc)) {
      errors.push(`${where}.params.${name}.in: must be one of ${CONNECTOR_PARAM_LOCATIONS.join(', ')}`);
      continue;
    }
    params[name] = {
      type,
      in: loc,
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
      ...(Array.isArray(p.enum) ? { enum: p.enum.map(String) } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(typeof p.bodyPath === 'string' ? { bodyPath: p.bodyPath } : {}),
    };
  }

  // Every {placeholder} in the path must have a path param behind it, or the
  // runtime would send a literal "{id}" upstream and get a confusing 404.
  for (const m of path.matchAll(/\{([^}]+)\}/g)) {
    const token = m[1]!;
    const hit = Object.entries(params).find(([n, p]) => p.in === 'path' && (p.name ?? n) === token);
    if (!hit) errors.push(`${where}.path: "{${token}}" has no matching path param`);
  }

  const required = Array.isArray(raw.required) ? raw.required.map(String) : [];
  for (const r of required) {
    if (!params[r]) errors.push(`${where}.required: "${r}" is not a declared param`);
  }

  return {
    key,
    label: String(raw.label ?? key),
    description: String(raw.description ?? ''),
    method,
    path,
    mutates: raw.mutates,
    params,
    ...(required.length ? { required } : {}),
    ...(isPlainObject(raw.bodyTemplate) ? { bodyTemplate: raw.bodyTemplate } : {}),
    ...(isPlainObject(raw.headers)
      ? { headers: Object.fromEntries(Object.entries(raw.headers).map(([k, v]) => [k, String(v)])) }
      : {}),
    ...(raw.bodyFormat === 'form' ? { bodyFormat: 'form' as const } : {}),
    ...(typeof raw.resultPath === 'string' ? { resultPath: raw.resultPath } : {}),
  };
}

/**
 * Validate an untrusted manifest. Throws {@link ConnectorManifestError} carrying
 * EVERY problem found, not just the first — a builder form shows them all at once.
 */
export function parseConnectorManifest(raw: unknown): ConnectorManifest {
  const errors: string[] = [];
  if (!isPlainObject(raw)) throw new ConnectorManifestError(['manifest must be a JSON object']);

  const key = String(raw.key ?? '').trim().toLowerCase();
  if (!KEY_RE.test(key)) errors.push('key: must match [a-z0-9][a-z0-9-]* and be ≤63 chars');

  const name = String(raw.name ?? '').trim();
  if (!name) errors.push('name: required');

  const category = String(raw.category ?? 'other') as ConnectorCategory;
  if (!CONNECTOR_CATEGORIES.includes(category)) errors.push(`category: must be one of ${CONNECTOR_CATEGORIES.join(', ')}`);

  const baseUrl = String(raw.baseUrl ?? '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    errors.push('baseUrl: required');
  } else if (baseUrl.trimStart().startsWith('{{')) {
    // The WHOLE base URL is supplied per connection (the generic HTTP connector).
    // There is no shape to check here — scheme, host and path all arrive later — so
    // validation is deferred wholesale to connectorRuntime, which guards the RESOLVED
    // url and re-resolves its hostname before every call. That is the authoritative
    // check in all cases; this one is only an early, friendlier failure.
  } else {
    // A templated HOST can't be URL-parsed until a connection supplies the value, so
    // substitute a label and check the surrounding shape now.
    const probe = baseUrl.replace(TEMPLATE_RE, 'placeholder');
    try {
      assertSafeUrl(probe, { allowHttp: false });
    } catch (e) {
      errors.push(`baseUrl: ${e instanceof Error ? e.message : 'invalid'}`);
    }
  }

  const rawAuth = isPlainObject(raw.auth) ? raw.auth : { kind: 'none' };
  const authKind = String(rawAuth.kind ?? 'none') as ConnectorAuthKind;
  if (!CONNECTOR_AUTH_KINDS.includes(authKind)) errors.push(`auth.kind: must be one of ${CONNECTOR_AUTH_KINDS.join(', ')}`);
  if (authKind === 'api_key') {
    const authIn = String(rawAuth.in ?? 'header');
    if (authIn !== 'header' && authIn !== 'query') errors.push('auth.in: must be "header" or "query" for api_key');
    if (!String(rawAuth.name ?? '').trim()) errors.push('auth.name: required for api_key (header or query-param name)');
  }
  const fields: ConnectorAuthField[] = [];
  for (const [i, f] of (Array.isArray(rawAuth.fields) ? rawAuth.fields : []).entries()) {
    if (!isPlainObject(f)) { errors.push(`auth.fields[${i}]: must be an object`); continue; }
    const fk = String(f.key ?? '');
    if (!AUTH_FIELD_RE.test(fk)) { errors.push(`auth.fields[${i}].key: must match [A-Za-z0-9_]`); continue; }
    fields.push({
      key: fk,
      label: String(f.label ?? fk),
      secret: f.secret !== false,
      required: f.required !== false,
      ...(typeof f.placeholder === 'string' ? { placeholder: f.placeholder } : {}),
      ...(typeof f.help === 'string' ? { help: f.help } : {}),
    });
  }

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  if (rawActions.length === 0) errors.push('actions: at least one action is required');
  if (rawActions.length > MAX_ACTIONS_PER_CONNECTOR) {
    errors.push(`actions: at most ${MAX_ACTIONS_PER_CONNECTOR} actions per connector`);
  }
  const actions: ConnectorAction[] = [];
  const seen = new Set<string>();
  for (const [i, a] of rawActions.slice(0, MAX_ACTIONS_PER_CONNECTOR).entries()) {
    const action = validateAction(a, i, errors);
    if (!action) continue;
    if (seen.has(action.key)) { errors.push(`actions[${i}].key: duplicate "${action.key}"`); continue; }
    seen.add(action.key);
    actions.push(action);
  }

  const auth: ConnectorAuth = {
    kind: authKind,
    ...(typeof rawAuth.in === 'string' ? { in: rawAuth.in as 'header' | 'query' } : {}),
    ...(typeof rawAuth.name === 'string' ? { name: rawAuth.name } : {}),
    ...(typeof rawAuth.prefix === 'string' ? { prefix: rawAuth.prefix } : {}),
    ...(typeof rawAuth.authorizeUrl === 'string' ? { authorizeUrl: rawAuth.authorizeUrl } : {}),
    ...(typeof rawAuth.tokenUrl === 'string' ? { tokenUrl: rawAuth.tokenUrl } : {}),
    ...(Array.isArray(rawAuth.scopes) ? { scopes: rawAuth.scopes.map(String) } : {}),
    ...(fields.length ? { fields } : {}),
  };

  // A `{{auth.x}}` in the base URL that no credential field supplies would silently
  // resolve to '' and produce a nonsense host — catch it while the author is looking.
  const declaredKeys = new Set((fields.length ? fields : defaultAuthFields(authKind)).map((f) => f.key));
  for (const ref of templateAuthKeys(baseUrl)) {
    if (!declaredKeys.has(ref)) errors.push(`baseUrl: references {{auth.${ref}}} but no auth field declares "${ref}"`);
  }

  if (errors.length) throw new ConnectorManifestError(errors);

  return {
    key,
    name,
    description: String(raw.description ?? ''),
    category,
    icon: String(raw.icon ?? '🔌').slice(0, 8),
    baseUrl,
    ...(typeof raw.docsUrl === 'string' ? { docsUrl: raw.docsUrl } : {}),
    auth,
    ...(isPlainObject(raw.defaultHeaders)
      ? { defaultHeaders: Object.fromEntries(Object.entries(raw.defaultHeaders).map(([k, v]) => [k, String(v)])) }
      : {}),
    actions,
  };
}

/** Non-throwing variant for callers that render an error list (the builder form). */
export function validateConnectorManifest(
  raw: unknown,
): { ok: true; manifest: ConnectorManifest } | { ok: false; errors: string[] } {
  try {
    return { ok: true, manifest: parseConnectorManifest(raw) };
  } catch (e) {
    if (e instanceof ConnectorManifestError) return { ok: false, errors: e.errors };
    return { ok: false, errors: [e instanceof Error ? e.message : 'Invalid manifest'] };
  }
}

/** JSON Schema for one action's input, as advertised to the model. */
export function actionInputSchema(action: ConnectorAction): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(action.params)) {
    properties[name] = {
      // JSON Schema has no 'integer' distinction problem here; pass it through.
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
      ...(p.enum ? { enum: p.enum } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
    };
  }
  return {
    type: 'object',
    properties,
    ...(action.required?.length ? { required: action.required } : {}),
  };
}
