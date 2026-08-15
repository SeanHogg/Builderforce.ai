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
 * Cloudflare/Vercel Edge Runtime a function must carry every chunk it can reach,
 * so all thirty server-translating routes shipped a 3.5 MB catalog blob and
 * `/embedded` finally tipped the 4 MB edge-function ceiling:
 *
 *     Error: Can't build edge function /embedded/page:
 *     Exceeds maximum edge function size: 4 MB / 4 MB
 *
 * Catalogs are DATA, so they are published as static assets by
 * `scripts/publish-message-catalogs.mjs` (prebuild) and fetched on demand. The
 * default locale stays a static import: it is what SSR and the first client
 * render use, and putting a network hop in front of the first paint to save a
 * file that every render needs anyway would be a bad trade.
 *
 * Caching: an in-memory map per isolate/tab (a catalog is immutable for a build),
 * over a URL versioned by `NEXT_PUBLIC_APP_VERSION` so a deploy invalidates
 * browser and edge copies. `public/_headers` marks the path immutable.
 */

export type Messages = Record<string, unknown>;

/** L1: per-isolate (server) / per-tab (client). Seeded with the bundled default. */
const cache = new Map<Locale, Messages>([[DEFAULT_LOCALE, enMessages as Messages]]);

/**
 * Root-relative URL of a published catalog, versioned by the build.
 *
 * The version is what makes the asset safely immutable — without it a deploy
 * that changes a translation would keep serving the previous catalog for as long
 * as any cache held it.
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
 * @param origin Absolute origin to resolve the asset against. Required on the
 *   server (a worker has no implicit base URL); omitted on the client, where the
 *   root-relative URL resolves against the current document.
 */
export async function loadCatalog(locale: Locale, origin = ''): Promise<Messages> {
  const cached = cache.get(locale);
  if (cached) return cached;

  try {
    const response = await fetch(`${origin}${catalogUrl(locale)}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const messages = (await response.json()) as Messages;
    cache.set(locale, messages);
    return messages;
  } catch (error) {
    console.warn(`[i18n] catalog "${locale}" unavailable — rendering in ${DEFAULT_LOCALE}.`, error);
    return enMessages as Messages;
  }
}
