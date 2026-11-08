/**
 * The small pieces of `connectorRuntime.ts` that shape what goes onto the wire and what
 * is read back off it: form bodies, query params whose value is already in wire form
 * (`ConnectorParam.raw`), and the scalar fields of a response body a caller asked to keep
 * (`captureBodyPaths`, for a paged list call). Split out so the runtime stays the one
 * executor and these stay asserted on their own.
 */

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
 * Whether a value may be appended to the query string AS IS (`ConnectorParam.raw`): URL
 * unreserved characters, the sub-delims Rest.li keys use (`( ) , : ! * '`), and
 * percent-escapes that are well formed. Anything else — `&`, `#`, `=`, `+`, a space, a
 * stray `%` — could end the value or start another param, so such a value is encoded
 * normally by the caller instead.
 */
export const isWireSafe = (value: string): boolean => /^[A-Za-z0-9._~()!*',:%-]*$/.test(value) && !/%(?![0-9A-Fa-f]{2})/.test(value);

/** The `name=value` pair for a `raw` query param, or null when the value is not wire-safe
 *  (the caller then encodes it normally). Appended AFTER the encoded params, never re-encoded. */
export function rawQueryPair(wireName: string, value: unknown): string | null {
  const text = String(value);
  return isWireSafe(text) ? `${encodeURIComponent(wireName)}=${text}` : null;
}

/** The query string: the encoded params, then the raw pairs. */
export const joinQuery = (query: URLSearchParams, rawPairs: readonly string[]): string =>
  [query.toString(), ...rawPairs].filter(Boolean).join('&');

/**
 * Scalars (string, finite number or boolean, at most 2000 chars) at `paths` in a parsed
 * body, as text. A boolean is kept so an end-of-list flag (`hasNext: false`) can be read.
 * `pick` reads one dotted path (the runtime's `getDeep`).
 */
export function readBodyFields(
  body: unknown,
  paths: readonly string[],
  pick: (source: unknown, path: string) => unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const value = pick(body, path);
    if (typeof value === 'string' && value.trim()) out[path] = value.trim().slice(0, 2000);
    else if (typeof value === 'number' && Number.isFinite(value)) out[path] = String(value);
    else if (typeof value === 'boolean') out[path] = String(value);
  }
  return out;
}
