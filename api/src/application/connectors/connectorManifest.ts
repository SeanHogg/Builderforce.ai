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
import type { ConnectorSoap } from './soapEnvelope';
import {
  validateLinkHosts,
  validateSourceAliases,
  type ConnectorApplicantMapping,
  type ConnectorBoardJobMapping,
  type ConnectorUrlResolution,
} from './connectorApplicantManifest';
import { publicAuthFieldKeys } from './connectorMappingValidators';
import {
  TEMPLATE_RE,
  isPlainObject,
  validateAction,
  type ActionValidationOptions,
  type ConnectorMethod,
  type ConnectorParamLocation,
  type ConnectorParamType,
} from './connectorActionValidation';

export type { ConnectorSoap };
// The action vocabulary lives with the action validator; re-exported so importers of the
// manifest module keep one import site.
export {
  CONNECTOR_METHODS,
  CONNECTOR_PARAM_LOCATIONS,
  CONNECTOR_PARAM_TYPES,
} from './connectorActionValidation';
export type { ConnectorMethod, ConnectorParamLocation, ConnectorParamType } from './connectorActionValidation';

/** Broad grouping used by the catalog UI. Kept small on purpose. */
export const CONNECTOR_CATEGORIES = [
  'communication',
  'crm',
  'productivity',
  'devtools',
  // Cloud hosts the customer's app actually runs on. Its own category rather than
  // `devtools` (which is where GitHub/GitLab land) because connecting a cloud account
  // is an ops job, not a source-control job, and the catalog is browsed by category.
  'cloud',
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
  /**
   * `in: 'query'` only. The value is ALREADY in wire form (percent-encoded once, by the
   * caller) and is appended verbatim instead of being run through the query encoder a
   * second time — Rest.li batch keys (`List(urn%3Ali%3A…)`) keep their parentheses. A
   * value containing anything outside the URL-safe set is encoded normally instead, so a
   * raw param cannot inject another param or a fragment.
   */
  raw?: boolean;
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
   * A different HOST for this one action.
   *
   * Most vendors serve every operation from one origin, which is what `baseUrl` is for.
   * Some split a service across subdomains — Microsoft Advertising answers campaign
   * management on `campaign.api.bingads.microsoft.com` and reporting on
   * `reporting.api.bingads.microsoft.com`, with the same credentials, the same envelope
   * and the same account. Without this, that vendor needs a SECOND connector manifest:
   * a second connection for the operator to make, a second set of credentials to keep in
   * step, and an adapter that cannot reach half its own API because an `AdCall` is bound
   * to one connector.
   *
   * Validated exactly as {@link ConnectorManifest.baseUrl} is, at author time and again
   * against the resolved hostname before every call — this widens what a manifest may
   * SAY, never what the runtime will dial.
   *
   * A connection's own `baseUrlOverride` still wins: an operator pointing a connector at
   * a self-hosted instance is moving every service together, and having one action
   * silently keep dialling the vendor would defeat the override.
   */
  baseUrl?: string;
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
  /**
   * Speak SOAP instead of JSON on this action.
   *
   * A TRANSPORT, not a second subsystem: the same SSRF guard, the same sealed
   * credentials and the same audit-log row. Declaring it makes the runtime build an
   * envelope out of the `in: 'body'` params, set `SOAPAction`, and parse the XML answer
   * into the same object shape a REST action returns — so `resultPath`, `required` and
   * every caller above stay unchanged. It exists because Microsoft Advertising's
   * Campaign Management API has no REST surface, and "the vendor chose SOAP" is a
   * reason to add a transport, not a reason to have no Microsoft Ads.
   */
  soap?: ConnectorSoap;
  /**
   * How to read the RESPONSE.
   *
   * `json` (default) parses the body as JSON — or as a SOAP envelope when `soap` is set,
   * or falls back to `{ text }`. `binary` hands back an `ArrayBuffer` untouched, for the
   * actions whose answer is a file rather than a document: Microsoft Advertising returns
   * a report as a zipped CSV, and reading that with `res.text()` destroys it silently —
   * the bytes survive as replacement characters and the failure looks like an empty
   * report rather than a decoding mistake.
   *
   * It changes only how the body is DECODED. The same SSRF guard, the same size cap, the
   * same audit-log row, and `resultPath` simply does not apply.
   */
  responseFormat?: 'json' | 'binary';
  /** Dot path into the JSON response to return instead of the whole body. */
  resultPath?: string;
  /**
   * What a WRITE's answer means, read by generic code — the mirror of `params`.
   *
   * `params` says where each input goes on the request; this says where the facts a
   * caller has to record come back on the response. A job board answers "posting
   * created" with its id in `data.id` (Lever), `results.id` (Ashby), `elements.0.id`
   * (LinkedIn) or a header — and without a declaration, every consumer that needs
   * the id grows a `switch (connectorKey)`, which is exactly the per-vendor code a
   * manifest exists to replace. See {@link ConnectorResponseMapping}.
   */
  response?: ConnectorResponseMapping;
  /** For a list action that delivers applicants: how to read one. See
   *  {@link ConnectorApplicantMapping}. */
  applicants?: ConnectorApplicantMapping;
  /** For a list action that returns the board's jobs: how to read one. See
   *  {@link ConnectorBoardJobMapping}. */
  boardJobs?: ConnectorBoardJobMapping;
  /** On a `resolve_url` action: how to find a posting's public link in the answer. */
  resolve?: ConnectorUrlResolution;
  /**
   * The endpoint is PUBLIC: no credential is attached to the request. For a vendor's
   * unauthenticated read API on a different host (Greenhouse's Job Board API) — sending
   * the account's private key there would hand it to a host that never needs it.
   */
  public?: boolean;
}

/**
 * Field selectors into an action's response, each a list tried IN ORDER — the first
 * one that yields a non-empty scalar wins.
 *
 * A selector is either a dotted path into the parsed body (after `resultPath`), with
 * numeric segments indexing arrays (`elements.0.id`), or `header:<name>` for a
 * response header (LinkedIn answers some creates with an empty body and the new id in
 * `x-restli-id`). A list rather than one path because vendors drift between API
 * versions, and a fallback declared in data beats a fallback written in code.
 *
 * Every field is optional and NOTHING is inferred from an absent one: a mapping with
 * no `externalId` selector, or one whose selectors all come back empty, yields no id —
 * and a caller recording a publication must then record a failure, never a success it
 * cannot prove. `error` names where a vendor reports a refusal inside a 2xx body
 * (Ashby answers `200 { success: false, errors: [...] }`), so a refused write is read
 * as one rather than as a success with no id.
 */
export interface ConnectorResponseMapping {
  externalId?: string[];
  url?: string[];
  error?: string[];
  /**
   * A public URL BUILT from the answer, for boards whose create response carries an id
   * but no link. `{externalId}` is the id the `externalId` selectors found;
   * `{connection.<field>}` is a non-secret field of the connection's stored credentials
   * (Greenhouse's board token). It is tried only when no `url` selector yielded one, and
   * a template with any placeholder it cannot fill yields NO url — never a broken one.
   * Not a selector list, so it is outside {@link CONNECTOR_RESPONSE_FIELDS}.
   */
  urlTemplate?: string;
  /**
   * A regex the board's `externalId` must fully match for `urlTemplate` to fire. For a
   * board whose create answer can carry an id that is NOT the one its public page uses
   * (LinkedIn answers with a task URN; its job id is only available later): the link is
   * then withheld rather than built from the wrong id. Anchoring is added by the matcher.
   */
  externalIdPattern?: string;
  /**
   * Selectors for a SECOND id the public page is addressed by, available as `{postId}`
   * in `urlTemplate` (Greenhouse: the job-post id, distinct from the job id). No hit ⇒
   * the template does not fire.
   */
  postId?: string[];
}

// The mapping constants live with their validators; re-exported so importers of the
// manifest module keep one import site.
export {
  CONNECTOR_APPLICANT_FIELDS,
  CONNECTOR_BOARD_JOB_FIELDS,
  CONNECTOR_RESPONSE_FIELDS,
  URL_TEMPLATE_PLACEHOLDER_RE,
} from './connectorMappingValidators';

// The hiring-specific mapping types live in their own module; re-exported so importers of
// the manifest module keep one import site.
export type {
  ConnectorApplicantMapping,
  ConnectorBoardJobMapping,
  ConnectorUrlResolution,
} from './connectorApplicantManifest';
export { RESERVED_APPLICANT_SOURCES } from './connectorApplicantManifest';

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
  /**
   * Other spellings an applicant's free-text `source` may carry for THIS board
   * ("LinkedIn", "linkedin.com"). Read by `resolveApplicantSource`, which folds them onto
   * {@link ConnectorManifest.key}. Hiring boards only; case, whitespace and URL host are
   * normalised before comparing, so list the canonical lowercase form.
   */
  sourceAliases?: string[];
  /**
   * The registrable domains a link this board REPORTS (a `url` selector, `boardJobs.url`,
   * a `resolve_url` answer) may point at. Absent, the registrable domain of `baseUrl` is
   * used, and a manifest whose host is entirely per-tenant (`{{auth.x}}`) is not pinned.
   * Links a manifest BUILDS from a `urlTemplate` are authored, so they are not pinned.
   */
  linkHosts?: string[];
  /**
   * Set ONLY by a lenient read of a STORED manifest (`parseStoredConnectorManifest`): one
   * sentence per data mapping that no longer validates and was disabled, so the connector
   * stays in the catalog and the cause is visible. Never written back, never on authored input.
   */
  degraded?: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
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

/**
 * Whether this action's transport can carry a request body at all.
 *
 * A `GET` or `DELETE` never sends one, so `bodyFormat` is meaningless on those —
 * `release_phone_number` is a `DELETE` whose only argument is a path SID, and
 * demanding `bodyFormat: 'form'` of it would be recording an encoding for a body
 * that is never written. SOAP inverts the rule: an envelope IS the request, so an
 * operation with no mapped params still sends one.
 *
 * The runtime decides `hasBody` from this AND whether any param actually mapped;
 * this half is the part that is a property of the action alone, which is why it is
 * the half that can be asserted about a manifest without executing it.
 */
export function actionCarriesRequestBody(action: Pick<ConnectorAction, 'method' | 'soap'>): boolean {
  if (action.soap) return true;
  return action.method !== 'GET' && action.method !== 'DELETE';
}

/**
 * Validate an untrusted manifest. Throws {@link ConnectorManifestError} carrying
 * EVERY problem found, not just the first — a builder form shows them all at once.
 *
 * STRICT: this is the WRITE gate. A stored manifest is read through
 * {@link parseStoredConnectorManifest}, which tolerates a mapping that predates a rule.
 */
export function parseConnectorManifest(raw: unknown, opts: ActionValidationOptions = {}): ConnectorManifest {
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

  // `{connection.<field>}` in a URL template may name only these (declared secret:false).
  const publicFields = publicAuthFieldKeys(fields);
  const sourceAliases = validateSourceAliases(raw.sourceAliases, errors);
  const linkHosts = validateLinkHosts(raw.linkHosts, errors);

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  if (rawActions.length === 0) errors.push('actions: at least one action is required');
  if (rawActions.length > MAX_ACTIONS_PER_CONNECTOR) {
    errors.push(`actions: at most ${MAX_ACTIONS_PER_CONNECTOR} actions per connector`);
  }
  const actions: ConnectorAction[] = [];
  const seen = new Set<string>();
  for (const [i, a] of rawActions.slice(0, MAX_ACTIONS_PER_CONNECTOR).entries()) {
    const action = validateAction(a, i, publicFields, errors, opts);
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
    ...(sourceAliases.length ? { sourceAliases } : {}),
    ...(linkHosts.length ? { linkHosts } : {}),
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
