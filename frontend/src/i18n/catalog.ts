import { fetchPublishedAsset } from '@/infrastructure/http/publishedAsset';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { DEFAULT_LOCALE, type Locale } from './config';
import { namespacesForPath } from './routeNamespaces.generated';
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
 *
 * ── CHUNKED LOADING (client) ────────────────────────────────────────────────
 * A non-default locale is NOT one ~1.2 MB (gzipped) file on the browser anymore.
 * `scripts/split-message-catalogs.mjs` (prebuild) emits one small JSON asset per
 * top-level namespace into `public/i18n/chunks/<locale>/<ns>.json` plus a
 * `public/i18n/manifest.json` listing each locale's namespaces. On the client,
 * `loadCatalog` fetches the WHOLE flat catalog once (as before — it is the
 * base every message resolves against) AND, in parallel, only the per-route
 * namespaces the current page reads, then overlays those chunks onto the flat
 * catalog. A cold non-English page therefore downloads the few KB of copy it
 * actually renders up front, while the full catalog streams in behind it.
 *
 * This is deliberately CORRECT-BEFORE-FAST:
 *
 *   - The SERVER always loads the FULL flat catalog — `loadCatalog` returns it
 *     unchanged on the server, so SSR and server components render every
 *     namespace exactly as before. Chunked loading never touches the server, so
 *     the next-intl contract is unchanged there.
 *   - Chunks are an OVERLAY, not the whole catalog: `loadClientCatalog` starts
 *     from the flat catalog and overwrites only the namespaces a chunk provides.
 *     A chunk that is missing, stale, or names a namespace the route map got
 *     wrong leaves the flat (server-rendered) copy in place — never a missing
 *     label, never a wrong-language render.
 *   - `loadNamespace` can still fetch a single namespace on demand for a client
 *     surface that swaps locale without a reload; its result is likewise merged
 *     into the live catalog, never a replacement of the whole thing.
 *   - The default locale (`en`) never fetches: it is the bundled static import.
 *
 * Both the flat catalog and the chunks are versioned with
 * `NEXT_PUBLIC_APP_VERSION` and marked immutable in `public/_headers`, so the
 * HTTP cache holds them for a build and a deploy asks for different paths.
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

/** Root-relative URL of the namespace→locale manifest, versioned the same way. */
export function manifestUrl(): string {
  return `/i18n/manifest.json?v=${process.env.NEXT_PUBLIC_APP_VERSION || 'dev'}`;
}

/** Root-relative URL of one namespace chunk for `locale`, versioned the same way. */
export function chunkUrl(locale: Locale, namespace: string): string {
  return `/i18n/chunks/${locale}/${namespace}.json?v=${process.env.NEXT_PUBLIC_APP_VERSION || 'dev'}`;
}

function loadManifest(origin: string): Promise<Record<string, string[]>> {
  // Cached through the shared read-through cache (no TTL — the manifest is
  // immutable per build). A failed fetch is dropped from that cache, so the
  // next caller retries it. No module-level variable on top: that would bypass
  // invalidation and leak across tests/locale switches.
  return getOrSetClientCached<Record<string, string[]>>(
    'i18n:manifest',
    async (signal) => {
      const response = await fetchPublishedAsset(manifestUrl(), origin, signal);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, string[]>;
    },
  );
}

/** Fetch and parse one namespace chunk, cached so a namespace is fetched once. */
function loadChunk(locale: Locale, namespace: string, origin: string): Promise<Messages> {
  return getOrSetClientCached<Messages>(
    `i18n:chunk:${locale}:${namespace}`,
    async (signal) => {
      const response = await fetchPublishedAsset(chunkUrl(locale, namespace), origin, signal);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Messages;
    },
  );
}

/** Merge namespace chunks onto a base catalog; later chunks overwrite same-named keys. */
function overlayChunks(base: Messages, chunks: Messages[]): Messages {
  const merged: Messages = { ...base };
  for (const chunk of chunks) Object.assign(merged, chunk);
  return merged;
}

/**
 * The full flat catalog for `locale` — the base every message resolves against.
 * Degrading to English (the bundled default) when the fetch fails is deliberate:
 * a page in the wrong language is a smaller failure than a page that does not
 * render.
 *
 * Cached through the shared read-through cache — no TTL, because a catalog is
 * immutable for a build and the URL carries the build version.
 */
async function loadFlatCatalog(locale: Locale, origin: string): Promise<Messages> {
  try {
    return await getOrSetClientCached<Messages>(`i18n:catalog:${locale}`, async (signal) => {
      const response = await fetchPublishedAsset(catalogUrl(locale), origin, signal);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Messages;
    });
  } catch (error) {
    console.warn(`[i18n] catalog "${locale}" unavailable — rendering in ${DEFAULT_LOCALE}.`, error);
    return defaultMessages;
  }
}

/**
 * Messages for `locale`.
 *
 * The SERVER always returns the FULL flat catalog (SSR + server components
 * render every namespace, exactly as before chunked loading existed — the
 * next-intl contract is unchanged there). The CLIENT returns the flat catalog
 * OVERLAID with the per-route namespaces the current page reads, so a cold
 * non-English page renders its own copy for the namespaces it actually uses
 * while the full catalog streams in behind it.
 *
 * Cached through the shared read-through cache; single-flight matters because a
 * cold start can begin several renders at once and they should share one fetch.
 *
 * @param origin Absolute origin to resolve the asset against. Required on the
 *   server (a worker has no implicit base URL); omitted on the client, where the
 *   root-relative URL resolves against the current document.
 */
export async function loadCatalog(locale: Locale, origin = ''): Promise<Messages> {
  if (locale === DEFAULT_LOCALE) return defaultMessages;
  const flat = await loadFlatCatalog(locale, origin);
  if (typeof window === 'undefined') return flat; // server: full catalog, unchanged

  // Client: overlay the per-route namespaces on top of the (streaming-in) flat
  // catalog. Failure to fetch a chunk leaves the flat copy in place — never a
  // missing label. `namespacesForPath('')` yields the conservative catch-all set.
  try {
    const manifest = await loadManifest(origin);
    const all = manifest[locale];
    if (!all?.length) return flat;
    const wanted = new Set(namespacesForPath(window.location.pathname));
    const namespaces = all.filter((ns) => wanted.has(ns));
    if (!namespaces.length) return flat;
    const chunks = await Promise.all(namespaces.map((ns) => loadChunk(locale, ns, origin)));
    return overlayChunks(flat, chunks);
  } catch {
    return flat;
  }
}

/**
 * Lazily load ONE namespace for a client surface that swaps locale without a
 * reload. Resolves to that single namespace's messages (to be merged into the
 * live catalog by the caller), or null when it can't be loaded — the caller
 * then leaves the existing copy in place.
 */
export async function loadNamespace(locale: Locale, namespace: string, origin = ''): Promise<Messages | null> {
  if (locale === DEFAULT_LOCALE) {
    const node = (defaultMessages as Messages)[namespace];
    return node === undefined ? null : { [namespace]: node };
  }
  try {
    const manifest = await loadManifest(origin);
    if (!manifest[locale]?.includes(namespace)) return null;
    return await loadChunk(locale, namespace, origin);
  } catch {
    return null;
  }
}
