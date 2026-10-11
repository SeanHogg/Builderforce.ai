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

import type { ConnectorResponseMapping } from './connectorManifest';
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
    for (const selector of selectors ?? []) {
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

function firstOf(result: Pick<ConnectorCallResult, 'data' | 'headers'>, selectors: readonly string[] | undefined): string | null {
  for (const selector of selectors ?? []) {
    const hit = scalarAt(result, selector);
    if (hit) return hit;
  }
  return null;
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
