/**
 * The MediaWiki (Wikipedia) API client — ONE client, two capabilities.
 *
 * Wikipedia backs two unrelated-looking things, and it backs them for the same reason:
 * it is the only general-subject source that is simultaneously free of an account, free
 * of a per-query meter, and licence-clean to quote with attribution. So it is the keyless
 * floor under BOTH halves of "research a subject, then plot it":
 *
 *  - `action=query&list=search` → the keyless web-search vendor
 *    (`runtime/webSearchVendors.ts`), so a workspace with no key can still research.
 *  - `action=query&prop=coordinates` → the keyless BULK geocoder
 *    (`web/geocode.ts`), which resolves 50 place names per REQUEST with no pacing, and
 *    is what lets a 200-row dataset be plotted in one call.
 *
 * They are separate ADAPTERS because they satisfy different ports and parse different
 * payloads. They are not separate CLIENTS: the endpoint, the request shape, the byte cap,
 * the timeout and the never-throw contract are one implementation here, so the two cannot
 * drift into two different stories about how we talk to this host.
 */

import { fetchVendorJson, type JsonFetchResult } from '../runtime/cloudWeb';

/** The single MediaWiki entry point. English Wikipedia specifically: the coordinate and
 *  article coverage the two adapters rely on is by far the deepest there, and a
 *  per-locale endpoint would change what a lookup RESOLVES TO, not merely its language. */
export const MEDIAWIKI_API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

/**
 * One `action=query` call. Callers pass only the parameters that describe their query;
 * `format`/`formatversion` are set here because they decide the PAYLOAD SHAPE both
 * parsers are written against, and letting a caller vary them would silently break the
 * parser rather than the request.
 */
export function mediaWikiQuery(params: Record<string, string>): Promise<JsonFetchResult> {
  const query = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params });
  return fetchVendorJson(`${MEDIAWIKI_API_ENDPOINT}?${query.toString()}`, {
    label: 'Wikipedia',
    // Wikipedia asks callers to identify themselves and rate-limits anonymous bursts; the
    // shared User-Agent already does that, so the only hint worth adding is the one an
    // operator would act on.
    statusHint: (status) => (status === 429 ? ' — Wikipedia rate-limited this deployment' : ''),
  });
}
