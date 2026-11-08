/**
 * Reading a connector WRITE's answer through its manifest's `response` mapping.
 *
 * The other half of `params`. A manifest already says, as data, where every input goes
 * on the request; this reads, as data, where the facts a caller must RECORD come back —
 * the vendor's id for what was created, its public URL, and a refusal hidden inside a
 * 2xx body. One function for every vendor, so recording "Lever accepted the posting"
 * and "Ashby accepted the posting" is the same code reading two declarations rather
 * than two branches on a connector key.
 *
 * Pure: a {@link ConnectorCallResult} in, three nullable strings out. It never decides
 * whether a publication SUCCEEDED — it only reports what the response says. The
 * caller (`hiring/distributePosting.ts`) owns that rule, and its rule is that no id
 * means no confirmed row.
 */

import type { ConnectorManifest, ConnectorResponseMapping } from './connectorManifest';
import { URL_TEMPLATE_PLACEHOLDER_RE, matchesPattern } from './connectorMappingValidators';
import { getDeep, type ConnectorCallResult } from './connectorRuntime';

const HEADER_PREFIX = 'header:';

/** What one response says, per the mapping. `null` wherever it says nothing. */
export interface MappedConnectorResponse {
  externalId: string | null;
  url: string | null;
  /** A vendor refusal reported inside a successful HTTP status. */
  error: string | null;
}

/**
 * The response headers a mapping reads, lowercased — handed to
 * `executeConnectorAction` as `captureHeaders`, so the runtime returns exactly those
 * and nothing else (a response carries `set-cookie` and vendor auth echoes, and the
 * result goes to model tool loops).
 */
export function responseHeaderNames(mapping: ConnectorResponseMapping | undefined): string[] {
  if (!mapping) return [];
  const names = new Set<string>();
  for (const selectors of Object.values(mapping)) {
    // `urlTemplate` is a string, not a selector list — iterating it would read characters.
    if (!Array.isArray(selectors)) continue;
    for (const selector of selectors) {
      if (selector.startsWith(HEADER_PREFIX)) names.add(selector.slice(HEADER_PREFIX.length).toLowerCase());
    }
  }
  return [...names];
}

/**
 * One selector's value as text, or null.
 *
 * Only a SCALAR counts. A selector that lands on an object or an array is a manifest
 * pointing at the wrong level, and stringifying it would record `[object Object]` as a
 * vendor id — a confirmed row that names nothing.
 */
function scalarAt(result: Pick<ConnectorCallResult, 'data' | 'headers'>, selector: string): string | null {
  const value = selector.startsWith(HEADER_PREFIX)
    ? result.headers?.[selector.slice(HEADER_PREFIX.length).toLowerCase()]
    : getDeep(result.data, selector);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** The first selector that yields a non-empty scalar, or null. Also reads one list item
 *  (`{ data: item }`) for the applicant mapping. */
export function firstOf(result: Pick<ConnectorCallResult, 'data' | 'headers'>, selectors: readonly string[] | undefined): string | null {
  for (const selector of selectors ?? []) {
    const hit = scalarAt(result, selector);
    if (hit) return hit;
  }
  return null;
}

/** Every node a path reaches, where a `*` segment fans out over an array's elements. */
function nodesAt(node: unknown, segments: readonly string[]): unknown[] {
  if (segments.length === 0) return [node];
  if (node === null || typeof node !== 'object') return [];
  const [head, ...rest] = segments as [string, ...string[]];
  if (head === '*') return (Array.isArray(node) ? node : Object.values(node)).flatMap((child) => nodesAt(child, rest));
  const child = Array.isArray(node) ? node[Number(head)] : (node as Record<string, unknown>)[head];
  return nodesAt(child, rest);
}

/**
 * The scalars (as text) the FIRST selector that reaches any yields, where a `*` segment
 * means "any element". The membership sibling of {@link firstOf}: `postingIdField`
 * asks "is this posting among the item's jobs", which a single location cannot say.
 */
export function allOf(item: unknown, selectors: readonly string[] | undefined): string[] {
  for (const selector of selectors ?? []) {
    const hits = nodesAt(item, selector.split('.')).flatMap((node) => {
      if (typeof node === 'string') return node.trim() ? [node.trim()] : [];
      if (typeof node === 'number' && Number.isFinite(node)) return [String(node)];
      return [];
    });
    if (hits.length) return hits;
  }
  return [];
}

/**
 * Render a mapping's `urlTemplate`, or null.
 *
 * Null when the template is absent, when `{externalId}` has no id, or when ANY
 * `{connection.<field>}` is missing or empty on the connection — a URL with a hole in
 * it is a link to the wrong page, which is worse than no link. Values are
 * percent-encoded so a connection field cannot inject path or query structure.
 * Pure: the caller supplies the connection's non-secret fields and still passes the
 * result through its own absolute-http(s) check.
 */
export function renderUrlTemplate(
  template: string | undefined,
  values: {
    externalId: string | null;
    /** The second id (`response.postId`), for `{postId}`. */
    postId?: string | null;
    /** `response.externalIdPattern`: the id must fully match it or nothing fires. */
    externalIdPattern?: string;
    connection: Readonly<Record<string, string>>;
  },
): string | null {
  if (!template) return null;
  if (values.externalIdPattern && (!values.externalId || !matchesPattern(values.externalIdPattern, values.externalId))) return null;
  let missing = false;
  const rendered = template.replace(URL_TEMPLATE_PLACEHOLDER_RE, (_m, name: string) => {
    const value = name === 'externalId' ? values.externalId
      : name === 'postId' ? values.postId
      : values.connection[name.slice('connection.'.length)];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) { missing = true; return ''; }
    return encodeURIComponent(trimmed);
  });
  return missing ? null : rendered;
}

/** Whether a mapping can ever produce a public link for a posting. */
export function mappingYieldsUrl(mapping: ConnectorResponseMapping | undefined): boolean {
  return Boolean(mapping?.url?.length || mapping?.urlTemplate);
}

/**
 * Whether a board can EVER give a posting a public link, by any route its manifest
 * declares: a `url` selector or `urlTemplate` on its publish action, a `resolve_url`
 * action, or a link on the jobs it lists (`boardJobs.url` / the list action's own
 * `urlTemplate`, which is how a job linked from Workable gets one). Indeed declares none.
 */
export function manifestYieldsPublicLink(manifest: Pick<ConnectorManifest, 'actions'>, publishKey: string): boolean {
  return manifest.actions.some((action) => {
    if (action.key === publishKey) return mappingYieldsUrl(action.response);
    if (action.key === 'resolve_url') return Boolean(action.resolve);
    return Boolean(action.boardJobs?.url?.length || action.response?.urlTemplate);
  });
}

/** Apply a mapping to a response. An absent mapping maps nothing. */
export function mapConnectorResponse(
  mapping: ConnectorResponseMapping | undefined,
  result: Pick<ConnectorCallResult, 'data' | 'headers'>,
): MappedConnectorResponse {
  return {
    externalId: firstOf(result, mapping?.externalId),
    url: firstOf(result, mapping?.url),
    error: firstOf(result, mapping?.error),
  };
}
