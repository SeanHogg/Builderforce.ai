import { fetchPublishedAsset } from '@/infrastructure/http/publishedAsset';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { DEFAULT_LOCALE, type Locale } from './config';
// `undefined` in the edge server build, which aliases this file to `./unbundledCatalog`.
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
 * default locale stays a static import in the BROWSER (and the Node build that
 * prerenders static routes): it is what the first client render uses, and putting
 * a network hop in front of the first paint to save a file that every render needs
 * anyway would be a bad trade.
 *
 * ── THE EDGE SERVER READS THE DEFAULT CATALOG TOO ───────────────────────────
 * On Cloudflare the import was ~0.5 MiB of the Worker's 10 MiB compressed ceiling
 * (the largest single module in it), so the edge server build aliases
 * `./messages/en.json` to an empty stand-in (`./unbundledCatalog`, wired in
 * `next.config.js`) and reads the
 * published `en.json` through the ASSETS binding instead — once per route per
 * isolate (next-on-pages gives every route its own `globalThis`), by
 * {@link primeDefaultCatalog}. The root layout awaits it, so everything rendered
 * inside the layout (client components' SSR, `LocaleProvider` first of all) can
 * read it synchronously through {@link defaultCatalog}, which answers from the
 * bundle where there is one and from the primed copy on the edge. A SERVER
 * component in a nested segment must not rely on that ordering — segments render
 * in parallel with the root layout, and alone on a client-side navigation — so it
 * awaits the prime itself (`serverDefaultCopy`, `getTranslations` via
 * `request.ts`). The copy is held on `globalThis` because the server-component
 * layer and the SSR layer each get their own instance of this module; both see the
 * same per-route global.
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
 *   - The default locale (`en`) never fetches in the browser: it is the bundled
 *     static import there (the edge server reads it once per isolate, above).
 *
 * Both the flat catalog and the chunks are versioned with
 * `NEXT_PUBLIC_APP_VERSION` and marked immutable in `public/_headers`, so the
 * HTTP cache holds them for a build and a deploy asks for different paths.
 */

export type Messages = Record<string, unknown>;

/**
 * The one catalog that stays in the bundle — `undefined` in the edge server build,
 * which never bundles it. Read it through {@link defaultCatalog}, which also covers
 * the edge.
 */
export const defaultMessages = enMessages as Messages | undefined;

/** Where the edge server keeps the default catalog it read (see the header comment). */
const PRIMED_DEFAULT = Symbol.for('builderforce.i18n.defaultCatalog');

interface PrimedDefault {
  messages?: Messages;
  loading?: Promise<Messages>;
}

function primedSlot(): PrimedDefault {
  const scope = globalThis as unknown as Record<symbol, PrimedDefault | undefined>;
  return (scope[PRIMED_DEFAULT] ??= {});
}

/**
 * The default-locale catalog, synchronously: the bundled one, or — on the edge
 * server — the copy {@link primeDefaultCatalog} read. Throws when the edge copy has
 * not been read yet, which means a render started without the root layout's prime.
 */
export function defaultCatalog(): Messages {
  if (defaultMessages) return defaultMessages;
  const primed = primedSlot().messages;
  if (!primed) throw new Error('[i18n] the default catalog was read before primeDefaultCatalog() resolved.');
  return primed;
}

/**
 * Make {@link defaultCatalog} answerable. Free wherever the catalog is bundled; on
 * the edge server it reads the published `en.json` (the ASSETS binding on the
 * deployed Worker; `origin` is the network fallback elsewhere) once per isolate and
 * shares one in-flight read. A failed read is not cached, so the next render retries.
 */
export function primeDefaultCatalog(origin = ''): Promise<Messages> {
  if (defaultMessages) return Promise.resolve(defaultMessages);
  const slot = primedSlot();
  if (slot.messages) return Promise.resolve(slot.messages);
  slot.loading ??= fetchPublishedAsset(catalogUrl(DEFAULT_LOCALE), origin)
    .then(async (response) => {
      if (!response.ok) throw new Error(`[i18n] default catalog: HTTP ${response.status}`);
      const messages = (await response.json()) as Messages;
      slot.messages = messages;
      return messages;
    })
    .finally(() => {
      slot.loading = undefined;
    });
  return slot.loading;
}

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
    return primeDefaultCatalog(origin);
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
  if (locale === DEFAULT_LOCALE) return primeDefaultCatalog(origin);
  const flat = await loadFlatCatalog(locale, origin);
  if (typeof window === 'undefined') return flat; // server: full catalog, unchanged

  // Client: overlay the per-route namespaces on top of the (streaming-in) flat
  // catalog. Failure to fetch a chunk leaves the flat copy in place — never a
  // missing label. `namespacesForPath('')` yields the conservative catch-all set.
  try {
    const manifest = await loadManifest(origin);
    const all = manifest[locale];
    if (!all?.length) return flat;
    // The route map loads with the chunks it names, off the root layout's first paint.
    const { namespacesForPath } = await import('./routeNamespaces.generated');
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
    const node = (await primeDefaultCatalog(origin))[namespace];
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
