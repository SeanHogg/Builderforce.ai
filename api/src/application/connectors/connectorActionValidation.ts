/**
 * Validation of ONE action of a connector manifest — split from `connectorManifest.ts`
 * (the types, the auth block, the manifest gate), which had grown to the size where a
 * change to a mapping's rules meant scrolling past the SOAP envelope rules to find them.
 *
 * This module also owns the small vocabulary an action is made of (methods, param
 * locations and types, the action-key and `{{auth.x}}` patterns), so the manifest module
 * can import the validator without a cycle: the manifest re-exports every name below.
 *
 * ── STRICT ON WRITE, LENIENT ON READ ─────────────────────────────────────────────
 * Authoring (the builder, an import, a marketplace submission) is strict: one fault
 * anywhere rejects the manifest with every error found. A STORED manifest was valid when
 * it was written and can outlive a tightening of the rules (the pattern grammar, a cursor
 * that now needs an `order`). Re-parsing it strictly on every read would make the whole
 * connector vanish from the catalog over one data-mapping field, so the READ path passes
 * `lenient`: a mapping that no longer validates (`applicants`, `boardJobs`, `resolve`,
 * or a field of `response`) is DISABLED and the reason recorded in `degraded`, while the
 * rest of the action — and every other action — keeps working. A cursor with no `order`
 * defaults to `desc`, the safe reading: a descending walk never moves the cursor past
 * people it has not reached, so it can re-read but cannot skip.
 */

import { assertSafeUrl } from '../../infrastructure/net/ssrfGuard';
import type { ConnectorSoap } from './soapEnvelope';
import type { ConnectorAction, ConnectorParam } from './connectorManifest';
import {
  ACTION_KEY_RE,
  isPlainObject,
  validateApplicantMapping,
  validateBoardJobMapping,
  validateResponseMapping,
  validateUrlResolution,
} from './connectorMappingValidators';

export const CONNECTOR_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ConnectorMethod = (typeof CONNECTOR_METHODS)[number];

/**
 * Where a value goes on the request.
 *
 * `url` is the odd one and deliberately narrow: the value IS the whole request URL,
 * because the VENDOR supplied it at runtime. Microsoft Advertising answers a report poll
 * with a storage URL on a host it picks; Google and Meta hand back media and export links
 * the same way. A `path` param cannot carry one — path values are percent-encoded and
 * appended to a base, which turns an absolute URL into nonsense — and the alternative,
 * letting an adapter reach past the connector runtime and call `fetch` itself, would step
 * around the SSRF guard, the sealed credentials and the audit-log row that every other
 * call in this system goes through. So the URL comes in as a declared parameter and is
 * guarded exactly like any other: `connectorRuntime` runs `assertSafeUrl` and re-resolves
 * the hostname on the RESOLVED url, whoever chose it.
 */
export const CONNECTOR_PARAM_LOCATIONS = ['path', 'query', 'body', 'header', 'url'] as const;
export type ConnectorParamLocation = (typeof CONNECTOR_PARAM_LOCATIONS)[number];

export const CONNECTOR_PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;
export type ConnectorParamType = (typeof CONNECTOR_PARAM_TYPES)[number];

/** `{{auth.field}}` references in a template string. */
export const TEMPLATE_RE = /\{\{\s*auth\.([a-zA-Z0-9_]+)\s*\}\}/g;

/** How strictly a stored manifest is read — see the header. */
export interface ActionValidationOptions {
  lenient?: boolean;
  /** Receives one sentence per mapping a lenient read disabled. */
  degraded?: string[];
}

export function validateAction(
  raw: unknown,
  index: number,
  publicFields: ReadonlySet<string>,
  errors: string[],
  opts: ActionValidationOptions = {},
): ConnectorAction | null {
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
  // An action whose URL arrives whole at runtime (`in: 'url'`) has no path to join, and
  // an empty string is how it says so — see CONNECTOR_PARAM_LOCATIONS. Every other action
  // must name a rooted path, because the alternative silently concatenates onto the host.
  const urlSupplied = isPlainObject(raw.params)
    && Object.values(raw.params).some((param) => isPlainObject(param) && param.in === 'url');
  if (urlSupplied ? path !== '' : !path.startsWith('/')) {
    errors.push(urlSupplied
      ? `${where}.path: must be empty when a param declares in: 'url'`
      : `${where}.path: must start with "/"`);
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
    if (p.raw === true && loc !== 'query') errors.push(`${where}.params.${name}.raw: only a query param can be raw`);
    params[name] = {
      type,
      in: loc,
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
      ...(Array.isArray(p.enum) ? { enum: p.enum.map(String) } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(typeof p.bodyPath === 'string' ? { bodyPath: p.bodyPath } : {}),
      ...(p.raw === true && loc === 'query' ? { raw: true } : {}),
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

  // The same shape check `baseUrl` gets on the manifest — see ConnectorAction.baseUrl.
  // The runtime's SSRF guard on the RESOLVED url is still the authoritative one; this is
  // the early, friendlier failure, and it refuses a per-action host that is not https.
  const actionBaseUrl = raw.baseUrl == null ? null : String(raw.baseUrl).trim().replace(/\/$/, '');
  if (actionBaseUrl) {
    try {
      assertSafeUrl(actionBaseUrl.replace(TEMPLATE_RE, 'placeholder'), { allowHttp: false });
    } catch (e) {
      errors.push(`${where}.baseUrl: ${e instanceof Error ? e.message : 'invalid'}`);
    }
  } else if (raw.baseUrl != null) {
    errors.push(`${where}.baseUrl: must be a non-empty URL when present`);
  }

  const responseFormat = raw.responseFormat == null ? null : String(raw.responseFormat);
  if (responseFormat && responseFormat !== 'json' && responseFormat !== 'binary') {
    errors.push(`${where}.responseFormat: must be "json" or "binary"`);
  }
  if (responseFormat === 'binary' && raw.resultPath) {
    // A dot path into bytes is meaningless, and letting it be declared would leave a
    // manifest that reads as if it selects something.
    errors.push(`${where}.resultPath: cannot be used with responseFormat "binary"`);
  }

  /**
   * Run one data-mapping validator. Strict: its faults are the manifest's faults.
   * Lenient: its faults DISABLE that mapping (`keepPartial` keeps what did validate, for
   * a mapping whose fields are independent) and are recorded, nothing else changes.
   */
  const mapped = <T>(label: string, run: (into: string[]) => T | null, keepPartial = false): T | null => {
    const local: string[] = [];
    const value = run(local);
    if (!local.length) return value;
    if (!opts.lenient) { errors.push(...local); return value; }
    opts.degraded?.push(...local.map((fault) => `${where} (${key}): ${label} disabled — ${fault}`));
    return keepPartial ? value : null;
  };
  const response = mapped('response mapping', (into) => validateResponseMapping(raw.response, publicFields, where, into), true);
  const applicants = mapped('applicants mapping', (into) => validateApplicantMapping(raw.applicants, params, where, into, { lenient: opts.lenient }));
  const boardJobs = mapped('boardJobs mapping', (into) => validateBoardJobMapping(raw.boardJobs, where, into));
  const resolve = mapped('resolve mapping', (into) => validateUrlResolution(raw.resolve, params, publicFields, where, into));

  const soap = validateSoap(raw.soap, where, errors);
  // A SOAP operation is a POST of a document. Declaring it on a GET would produce a
  // request with an envelope no service ever sees, which fails as an unhelpful 404.
  if (soap && method !== 'POST') errors.push(`${where}.soap: SOAP actions must use POST`);

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
    ...(actionBaseUrl ? { baseUrl: actionBaseUrl } : {}),
    ...(responseFormat === 'binary' ? { responseFormat } : {}),
    ...(soap ? { soap } : {}),
    ...(typeof raw.resultPath === 'string' ? { resultPath: raw.resultPath } : {}),
    ...(response ? { response } : {}),
    ...(applicants ? { applicants } : {}),
    ...(boardJobs ? { boardJobs } : {}),
    ...(resolve ? { resolve } : {}),
    ...(raw.public === true ? { public: true } : {}),
  };
}

/**
 * Validate a SOAP declaration on an untrusted action.
 *
 * The namespace is the only field that reaches the wire as markup rather than as a
 * text node, so it is the one that must be constrained — everything else is escaped by
 * `buildSoapEnvelope`. Returning `null` on a malformed declaration would silently
 * DOWNGRADE the action to JSON and send a JSON body to a SOAP endpoint, so a broken
 * declaration is an error the author sees, not a fallback.
 */
function validateSoap(raw: unknown, where: string, errors: string[]): ConnectorSoap | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) { errors.push(`${where}.soap: must be an object`); return null; }

  const action = String(raw.action ?? '').trim();
  const namespace = String(raw.namespace ?? '').trim();
  const operation = String(raw.operation ?? '').trim();
  if (!operation) errors.push(`${where}.soap.operation: required`);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(operation || '_')) {
    errors.push(`${where}.soap.operation: must be an XML element name`);
  }
  // A namespace is a URI in an xmlns attribute; a quote or an angle bracket in it would
  // escape the attribute and rewrite the document.
  if (!namespace || /["'<>&\s]/.test(namespace)) {
    errors.push(`${where}.soap.namespace: required, and must be a URI with no quotes, angle brackets or spaces`);
  }
  const version = raw.version === '1.2' ? '1.2' as const : '1.1' as const;

  const header: Record<string, string> = {};
  if (raw.header !== undefined) {
    if (!isPlainObject(raw.header)) errors.push(`${where}.soap.header: must be an object of element names to values`);
    else {
      for (const [key, value] of Object.entries(raw.header)) {
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key)) {
          errors.push(`${where}.soap.header: "${key}" is not an XML element name`);
          continue;
        }
        header[key] = String(value);
      }
    }
  }

  return {
    action,
    namespace,
    operation,
    version,
    ...(Object.keys(header).length ? { header } : {}),
  };
}
