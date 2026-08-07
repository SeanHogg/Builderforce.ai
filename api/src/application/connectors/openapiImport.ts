/**
 * OpenAPI → connector manifest.
 *
 * ── WHY THIS IS THE WHOLE FEATURE ────────────────────────────────────────────
 * "Make it easy for companies to create a connector" has a floor: however good a
 * form is, hand-entering forty endpoints is a day of work nobody does. Almost every
 * modern API already publishes a machine-readable description of itself. Pasting
 * that URL and getting a working connector is the difference between a connector
 * platform people use and one they admire.
 *
 * Supports OpenAPI 3.x and Swagger 2.0 (still what a lot of internal enterprise
 * APIs emit). Local `$ref`s into `components`/`definitions` are resolved; remote
 * `$ref`s are NOT followed — that would be a second unguarded fetch per reference.
 *
 * The output is a DRAFT: import gets someone 90% of the way, and the last 10%
 * (which actions matter, what `mutates` really means for this API, better
 * descriptions for the model) is the part a human must confirm before an agent
 * can call it.
 */

import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';
import {
  MAX_ACTIONS_PER_CONNECTOR,
  parseConnectorManifest,
  type ConnectorAuth,
  type ConnectorAuthKind,
  type ConnectorManifest,
  type ConnectorMethod,
  type ConnectorParam,
  type ConnectorParamType,
} from './connectorManifest';

type Json = Record<string, unknown>;

/** A spec bigger than this is not an API description, it is a denial-of-service. */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;

/** A spec fetch that failed for a reason the caller should show verbatim. */
export class SpecFetchError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'SpecFetchError';
  }
}

/**
 * Fetch a tenant-supplied OpenAPI spec by URL, server-side.
 *
 * This lives here rather than in the route because it is the same class of
 * request a connector action makes — an outbound fetch to a URL a customer
 * chose, issued by our worker from inside our network — and so it gets the
 * identical guard: literal check, DNS re-resolution against the public ranges,
 * and `redirect: 'manual'` so a 302 cannot bounce it to an internal target
 * after the check has passed.
 */
export async function fetchOpenApiSpec(specUrl: string): Promise<{ spec: unknown; baseUrl: string }> {
  let safe: URL;
  try {
    safe = assertSafeUrl(specUrl, { allowHttp: false });
    await resolveAndAssertPublic(safe.hostname);
  } catch (e) {
    throw new SpecFetchError(e instanceof Error ? e.message : 'Blocked spec URL');
  }

  let text: string;
  try {
    const res = await fetch(safe.toString(), {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new SpecFetchError(`Could not fetch the spec (${res.status})`);
    text = await res.text();
  } catch (e) {
    if (e instanceof SpecFetchError) throw e;
    throw new SpecFetchError(e instanceof Error ? e.message : 'Could not read the spec');
  }
  if (text.length > MAX_SPEC_BYTES) {
    throw new SpecFetchError(`The spec is larger than ${MAX_SPEC_BYTES / 1024 / 1024}MB`, 413);
  }

  try {
    return { spec: JSON.parse(text), baseUrl: safe.origin };
  } catch {
    throw new SpecFetchError('The spec URL did not return JSON (YAML is not supported — paste the JSON form)');
  }
}

const METHODS: ConnectorMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** HTTP verbs that change state — the default for `mutates` on an imported action. */
const MUTATING = new Set<ConnectorMethod>(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface OpenApiImportResult {
  manifest: ConnectorManifest;
  /** Everything the import could not carry over, surfaced in the builder. */
  warnings: string[];
  /** Actions found before the per-connector cap was applied. */
  totalOperations: number;
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Resolve a local `#/a/b/c` ref. Returns null for remote or unresolvable refs. */
function deref(spec: Json, node: unknown, depth = 0): unknown {
  if (depth > 8 || !isObj(node)) return node;
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  if (!ref.startsWith('#/')) return null;
  const resolved = ref
    .slice(2)
    .split('/')
    .reduce<unknown>((acc, seg) => (isObj(acc) ? acc[seg.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec);
  return deref(spec, resolved, depth + 1);
}

function schemaType(schema: unknown): ConnectorParamType {
  if (!isObj(schema)) return 'string';
  const t = schema.type;
  if (t === 'integer') return 'integer';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'array') return 'array';
  if (t === 'object') return 'object';
  return 'string';
}

/** `[a-z0-9_]` key derived from operationId, or from method+path when absent. */
function actionKeyFor(operationId: unknown, method: string, path: string, taken: Set<string>): string {
  const fromId = typeof operationId === 'string' && operationId.trim() ? operationId : '';
  const raw = fromId || `${method}_${path}`;
  let key = raw
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  if (!key || !/^[a-z0-9]/.test(key)) key = `op_${key}`.slice(0, 60);
  let candidate = key;
  let n = 2;
  while (taken.has(candidate)) candidate = `${key.slice(0, 56)}_${n++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Derive the base URL. OpenAPI 3 puts it in `servers[0].url`; Swagger 2 splits it
 * across `schemes`/`host`/`basePath`. A server-relative URL (`/api/v2`) can't be
 * called on its own, so the caller's `fallbackBaseUrl` (the spec's own origin)
 * fills in the host — which is almost always right and always editable after.
 */
function deriveBaseUrl(spec: Json, fallbackBaseUrl: string | undefined, warnings: string[]): string {
  const servers = spec.servers;
  if (Array.isArray(servers) && isObj(servers[0]) && typeof servers[0].url === 'string') {
    const url = servers[0].url;
    if (/^https?:\/\//i.test(url)) return url.replace(/\/$/, '');
    if (fallbackBaseUrl) return `${fallbackBaseUrl.replace(/\/$/, '')}${url}`.replace(/\/$/, '');
    warnings.push(`servers[0].url "${url}" is relative and no spec origin was available — set the base URL manually.`);
    return '';
  }
  // Swagger 2.0
  if (typeof spec.host === 'string' && spec.host) {
    const scheme = Array.isArray(spec.schemes) && spec.schemes.includes('http') && !spec.schemes.includes('https') ? 'http' : 'https';
    const basePath = typeof spec.basePath === 'string' ? spec.basePath : '';
    return `${scheme}://${spec.host}${basePath}`.replace(/\/$/, '');
  }
  if (fallbackBaseUrl) return fallbackBaseUrl.replace(/\/$/, '');
  warnings.push('The spec declares no server URL — set the base URL manually.');
  return '';
}

/**
 * Map the spec's declared security to our auth model.
 *
 * We intentionally do NOT attempt an OAuth2 authorization-code dance from an
 * imported spec: that needs a registered redirect URI and a client secret the
 * spec cannot supply. An oauth2 scheme therefore imports as "paste an access
 * token", which works today, and the flow URLs are carried over so a proper
 * connection can be added later without re-importing.
 */
function deriveAuth(spec: Json, warnings: string[]): ConnectorAuth {
  const components = isObj(spec.components) ? spec.components : {};
  const schemes = isObj(components.securitySchemes)
    ? components.securitySchemes
    : isObj(spec.securityDefinitions)
      ? spec.securityDefinitions // Swagger 2.0
      : {};

  const first = Object.values(schemes).map((s) => deref(spec, s)).find(isObj);
  if (!first) return { kind: 'none' };

  const type = String(first.type ?? '').toLowerCase();

  if (type === 'http') {
    const scheme = String(first.scheme ?? '').toLowerCase();
    if (scheme === 'basic') return { kind: 'basic' };
    return { kind: 'bearer' };
  }
  if (type === 'apikey') {
    const location = String(first.in ?? 'header').toLowerCase();
    if (location !== 'header' && location !== 'query') {
      warnings.push(`API key in "${location}" is not supported (cookie auth); imported as a header instead.`);
    }
    return {
      kind: 'api_key',
      in: location === 'query' ? 'query' : 'header',
      name: String(first.name ?? 'X-Api-Key'),
    };
  }
  if (type === 'oauth2') {
    const flows = isObj(first.flows) ? first.flows : {};
    const flow = Object.values(flows).find(isObj) ?? {};
    warnings.push('OAuth2 detected — imported as "paste an access token". Add a client id/secret later to enable the full flow.');
    return {
      kind: 'oauth2',
      ...(typeof flow.authorizationUrl === 'string' ? { authorizeUrl: flow.authorizationUrl } : {}),
      ...(typeof flow.tokenUrl === 'string' ? { tokenUrl: flow.tokenUrl } : {}),
      ...(isObj(flow.scopes) ? { scopes: Object.keys(flow.scopes) } : {}),
    };
  }
  warnings.push(`Security scheme "${type}" is not supported; the connector imported with no authentication.`);
  return { kind: 'none' };
}

/** Flatten a request-body schema's top-level properties into body params. */
function bodyParams(spec: Json, operation: Json, warnings: string[], where: string): {
  params: Record<string, ConnectorParam>;
  required: string[];
} {
  const params: Record<string, ConnectorParam> = {};
  const required: string[] = [];

  const rb = deref(spec, operation.requestBody);
  const content = isObj(rb) && isObj(rb.content) ? rb.content : null;
  // Swagger 2.0 puts the body in `parameters` with `in: body` — handled by the caller.
  if (!content) return { params, required };

  const jsonMedia = content['application/json'] ?? content['application/vnd.api+json'] ?? Object.values(content)[0];
  const schema = deref(spec, isObj(jsonMedia) ? jsonMedia.schema : undefined);
  if (!isObj(schema)) return { params, required };

  if (schema.type && schema.type !== 'object') {
    warnings.push(`${where}: request body is a bare ${String(schema.type)}, not an object — import it as a custom action.`);
    return { params, required };
  }

  const props = isObj(schema.properties) ? schema.properties : {};
  const requiredSet = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  for (const [name, rawProp] of Object.entries(props)) {
    const prop = deref(spec, rawProp);
    params[name] = {
      type: schemaType(prop),
      in: 'body',
      ...(isObj(prop) && typeof prop.description === 'string' ? { description: prop.description } : {}),
      ...(isObj(prop) && Array.isArray(prop.enum) ? { enum: prop.enum.map(String) } : {}),
    };
    if (requiredSet.has(name)) required.push(name);
  }
  return { params, required };
}

/**
 * Convert a parsed OpenAPI/Swagger document into a draft connector manifest.
 *
 * `key`, `name` and `fallbackBaseUrl` come from the importer UI; everything else
 * is derived. Throws only if the result cannot be validated at all — individual
 * operations that can't be mapped are dropped with a warning, because one
 * unsupported endpoint must not cost the other thirty-nine.
 */
export function manifestFromOpenApi(
  spec: unknown,
  opts: { key: string; name?: string; icon?: string; category?: string; fallbackBaseUrl?: string },
): OpenApiImportResult {
  if (!isObj(spec)) throw new Error('The OpenAPI document is not a JSON object');
  const warnings: string[] = [];

  const info = isObj(spec.info) ? spec.info : {};
  const paths = isObj(spec.paths) ? spec.paths : {};
  if (Object.keys(paths).length === 0) throw new Error('The OpenAPI document declares no paths');

  const baseUrl = deriveBaseUrl(spec, opts.fallbackBaseUrl, warnings);
  const auth = deriveAuth(spec, warnings);

  const taken = new Set<string>();
  const actions: ConnectorManifest['actions'] = [];
  let totalOperations = 0;

  for (const [rawPath, rawItem] of Object.entries(paths)) {
    const item = deref(spec, rawItem);
    if (!isObj(item)) continue;
    // Path-level parameters apply to every operation under it.
    const sharedParams = Array.isArray(item.parameters) ? item.parameters : [];

    for (const method of METHODS) {
      const operation = item[method.toLowerCase()];
      if (!isObj(operation)) continue;
      totalOperations++;
      if (actions.length >= MAX_ACTIONS_PER_CONNECTOR) continue;

      const where = `${method} ${rawPath}`;
      const params: Record<string, ConnectorParam> = {};
      const required: string[] = [];

      const allParams = [...sharedParams, ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
      let swaggerBodyHandled = false;

      for (const rawParam of allParams) {
        const param = deref(spec, rawParam);
        if (!isObj(param)) continue;
        const name = String(param.name ?? '');
        if (!name) continue;
        const location = String(param.in ?? 'query').toLowerCase();

        // Swagger 2.0 body parameter — flatten its schema like an OpenAPI 3 body.
        if (location === 'body') {
          const schema = deref(spec, param.schema);
          const props = isObj(schema) && isObj(schema.properties) ? schema.properties : {};
          const requiredSet = new Set(isObj(schema) && Array.isArray(schema.required) ? schema.required.map(String) : []);
          for (const [pn, rawProp] of Object.entries(props)) {
            const prop = deref(spec, rawProp);
            params[pn] = {
              type: schemaType(prop),
              in: 'body',
              ...(isObj(prop) && typeof prop.description === 'string' ? { description: prop.description } : {}),
            };
            if (requiredSet.has(pn)) required.push(pn);
          }
          swaggerBodyHandled = true;
          continue;
        }

        if (location !== 'path' && location !== 'query' && location !== 'header') {
          warnings.push(`${where}: parameter "${name}" in "${location}" is not supported and was dropped.`);
          continue;
        }

        // A JS-unsafe wire name (`filter[status]`) still works: the property key is
        // sanitised for the model, and `name` carries the real wire name.
        const propertyKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : name.replace(/[^A-Za-z0-9_]+/g, '_');
        const schema = deref(spec, param.schema);
        params[propertyKey] = {
          type: schemaType(schema ?? param),
          in: location,
          ...(propertyKey !== name ? { name } : {}),
          ...(typeof param.description === 'string' ? { description: param.description } : {}),
          ...(isObj(schema) && Array.isArray(schema.enum) ? { enum: schema.enum.map(String) } : {}),
        };
        if (param.required === true || location === 'path') required.push(propertyKey);
      }

      if (!swaggerBodyHandled) {
        const body = bodyParams(spec, operation, warnings, where);
        Object.assign(params, body.params);
        required.push(...body.required);
      }

      // Real specs routinely put `{id}` in the path and forget to declare it as a
      // parameter. Synthesising the missing path param is strictly better than
      // dropping the operation: the placeholder is unambiguous, and the alternative
      // is a manifest the validator rejects — losing the whole import over someone
      // else's omission.
      for (const m of rawPath.matchAll(/\{([^}]+)\}/g)) {
        const token = m[1]!;
        const declared = Object.entries(params).some(([n, prm]) => prm.in === 'path' && (prm.name ?? n) === token);
        if (declared) continue;
        const propertyKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(token) ? token : token.replace(/[^A-Za-z0-9_]+/g, '_');
        params[propertyKey] = {
          type: 'string',
          in: 'path',
          ...(propertyKey !== token ? { name: token } : {}),
          description: `Path parameter "${token}"`,
        };
        required.push(propertyKey);
        warnings.push(`${where}: path parameter "${token}" was not declared in the spec and was added as a required string.`);
      }

      const summary = typeof operation.summary === 'string' ? operation.summary : '';
      const description = typeof operation.description === 'string' ? operation.description : '';
      actions.push({
        key: actionKeyFor(operation.operationId, method, rawPath, taken),
        label: summary || `${method} ${rawPath}`,
        // The model reads this to decide whether to call the action, so prefer the
        // longer text and fall back to the path rather than shipping an empty string.
        description: description || summary || `${method} ${rawPath}`,
        method,
        path: rawPath.startsWith('/') ? rawPath : `/${rawPath}`,
        mutates: MUTATING.has(method),
        params,
        ...(required.length ? { required: [...new Set(required)] } : {}),
      });
    }
  }

  if (actions.length === 0) throw new Error('No importable operations were found in the document');
  if (totalOperations > actions.length) {
    warnings.push(
      `The spec declares ${totalOperations} operations; the first ${actions.length} were imported (a connector is capped at ${MAX_ACTIONS_PER_CONNECTOR} actions so it does not crowd out every other tool in the model's context).`,
    );
  }

  // Validate through the SAME parser tenant JSON goes through — an importer that
  // can emit a manifest the runtime rejects is a bug that surfaces at call time.
  const manifest = parseConnectorManifest({
    key: opts.key,
    name: opts.name || (typeof info.title === 'string' ? info.title : opts.key),
    description: typeof info.description === 'string' ? info.description.slice(0, 500) : '',
    category: opts.category ?? 'other',
    icon: opts.icon ?? '🔌',
    baseUrl,
    auth: auth as unknown as Json,
    actions,
  });

  return { manifest, warnings, totalOperations };
}

/** Auth kinds an imported spec can produce — used by the builder to label the result. */
export const IMPORTABLE_AUTH_KINDS: readonly ConnectorAuthKind[] = ['none', 'api_key', 'bearer', 'basic', 'oauth2'];
