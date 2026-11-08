/**
 * Finding a posting's public link (and real id) in a `resolve_url` action's answer, per
 * the manifest's {@link ConnectorUrlResolution}. Pure and vendor-blind: the match rule
 * and selectors are data.
 *
 * Nothing is guessed. No matching entry ⇒ nothing; a template with a hole ⇒ nothing.
 */

import type { ConnectorUrlResolution } from './connectorManifest';
import { matchesPattern } from './connectorMappingValidators';
import { firstOf, renderUrlTemplate } from './connectorResponseMapping';
import { getDeep } from './connectorRuntime';

export interface ResolvedUrl {
  url: string | null;
  /** The board's real id when the entry yielded one (it replaces the stored reference). */
  resolvedId: string | null;
}

/** Entries searched: a board with more jobs than this is paged by the vendor, not by us. */
const MAX_ENTRIES = 5000;

const NOTHING: ResolvedUrl = { url: null, resolvedId: null };

/**
 * The stored id as the `resolve_url` call must carry it in `idParam`: Rest.li 2.0 batch
 * keys are `List(<url-encoded id>)` (LinkedIn's task URN contains `:`), everything else
 * goes as is.
 *
 * The result is ALREADY the wire form of the value: the param that carries it must be
 * declared `raw: true`, so the runtime appends it verbatim. Run through URLSearchParams
 * the key would be encoded twice (`List%28urn%253A…`), which Rest.li would decode once
 * and read as a different key.
 *
 * UNVERIFIED against the live LinkedIn API: no credentials were available here. The
 * encoding follows the Rest.li 2.0 protocol document and is asserted only as the exact
 * URL string the runtime builds (`connectorUrlResolution.test.ts`).
 */
export function encodeResolveId(resolve: ConnectorUrlResolution, externalId: string): string {
  return resolve.idEncoding === 'restli-list' ? `List(${encodeURIComponent(externalId)})` : externalId;
}

const scalar = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

/** The entries `listPath` names: an array, or the values of an object. */
function entriesOf(data: unknown, listPath: string | undefined): unknown[] {
  if (!listPath) return [data];
  const at = getDeep(data, listPath);
  if (Array.isArray(at)) return at.slice(0, MAX_ENTRIES);
  if (at && typeof at === 'object') return Object.values(at as Record<string, unknown>).slice(0, MAX_ENTRIES);
  return [];
}

export function extractResolvedUrl(
  resolve: ConnectorUrlResolution,
  data: unknown,
  externalId: string,
  connection: Readonly<Record<string, string>> = {},
  /** Filters a link the board REPORTS (not one the manifest builds): null rejects it. */
  pinReported: (url: string) => string | null = (url) => url,
): ResolvedUrl {
  const wanted = resolve.equals?.split('{externalId}').join(externalId);
  const entries = entriesOf(data, resolve.listPath);
  const entry = resolve.matchField
    ? entries.find((candidate) => scalar(getDeep(candidate, resolve.matchField!)) === wanted)
    : entries[0];
  if (entry === undefined || entry === null) return NOTHING;

  const view = { data: entry };
  let resolvedId = firstOf(view, resolve.resolvedId);
  if (resolvedId && resolve.resolvedIdPattern) {
    // Anchored and length-bounded (see `matchesPattern`): the pattern must describe the
    // WHOLE value, with a capture group when the id is only part of it.
    const hit = matchesPattern(resolve.resolvedIdPattern, resolvedId);
    resolvedId = hit ? (hit[1] ?? hit[0]) : null;
  }
  // A declared id that could not be read means the entry is not the finished job yet
  // (LinkedIn's task has no `jobPosting` until it succeeds): no id, and no link built on
  // the stale reference.
  if (resolve.resolvedId && !resolvedId) return NOTHING;

  const reported = firstOf(view, resolve.url);
  const own = reported === null ? null : pinReported(reported);
  const url = own ?? renderUrlTemplate(resolve.urlTemplate, { externalId: resolvedId ?? externalId, connection });
  return { url, resolvedId };
}
