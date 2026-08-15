import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { DEFAULT_LOCALE, type Locale } from './config';
import enMessages from './messages/en.json';

/**
 * The ONE place a message catalog is loaded, on the server and on the client.
 *
 * WHY this is a fetch and not an import: the five catalogs are ~4.7 MB of JSON.
 * Every module that reached them pulled all five into its bundle — `request.ts`
 * used a template-literal `import('./messages/${locale}.json')`, which webpack
 * compiles to an EAGER context module (all five inlined into the parent chunk),
 * and `LocaleProvider`'s lazy loaders resolved to those same modules. On the
 * Edge Runtime a function must carry every chunk it can reach, so all fifteen
 * server-translating routes shipped a 1.23 MB (gzipped) catalog blob, sat within
 * 1% of the 4 MB edge-function ceiling, and `/embedded` finally tipped it:
 *
 *     Error: Can't build edge function /embedded/page:
 *     Exceeds maximum edge function size: 4 MB / 4 MB
 *
 * Catalogs are DATA, so they are published as static assets by
 * `scripts/publish-message-catalogs.mjs` (prebuild) and fetched on demand. The
 * default locale stays a static import: it is what SSR and the first client
 * render use, and putting a network hop in front of the first paint to save a
 * file that every render needs anyway would be a bad trade.
 */

export type Messages = Record<string, unknown>;

/**
 * The one catalog that stays in the bundle, and the only one the first render
 * can use. Exported so `LocaleProvider` seeds its state from the same import
 * rather than reaching for the JSON a second time.
 */
export const defaultMessages = enMessages as Messages;

/**
 * Root-relative URL of a published catalog, versioned by the build.
 *
 * The version is what lets `public/_headers` mark the path immutable — without it
 * a deploy that changes a translation would keep serving the previous catalog for
 * as long as any cache held it.
 */
export function catalogUrl(locale: Locale): string {
  return `/i18n/${locale}.json?v=${process.env.NEXT_PUBLIC_APP_VERSION || 'dev'}`;
}

/**
 * Messages for `locale`, or the default-locale catalog if the published asset
 * cannot be read.
 *
 * Degrading to English is deliberate: a page rendering in the wrong language is
 * a much smaller failure than a page that does not render, and it matches what
 * `LocaleProvider` already did when a catalog chunk failed to load.
 *
 * Cached through the shared read-through cache — no TTL, because a catalog is
 * immutable for a build and the URL carries the build version. Its single-flight
 * behaviour matters here: a cold edge isolate can start several renders at once,
 * and they should share one fetch of a ~800 KB file rather than race for it.
 *
 * @param origin Absolute origin to resolve the asset against. Required on the
 *   server (a worker has no implicit base URL); omitted on the client, where the
 *   root-relative URL resolves against the current document.
 */
export async function loadCatalog(locale: Locale, origin = ''): Promise<Messages> {
  if (locale === DEFAULT_LOCALE) return defaultMessages;
  try {
    return await getOrSetClientCached<Messages>(`i18n:catalog:${locale}`, async (signal) => {
      const response = await fetch(`${origin}${catalogUrl(locale)}`, { cache: 'force-cache', signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Messages;
    });
  } catch (error) {
    console.warn(`[i18n] catalog "${locale}" unavailable — rendering in ${DEFAULT_LOCALE}.`, error);
    return defaultMessages;
  }
}
