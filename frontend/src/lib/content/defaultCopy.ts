import { createTranslator } from 'next-intl';
import { defaultCatalog, primeDefaultCatalog } from '@/i18n/catalog';
import { DEFAULT_LOCALE } from '@/i18n/config';
import type { CopyReader } from './copy';

/**
 * A {@link CopyReader} bound to the DEFAULT locale's catalog, for STATICALLY
 * rendered routes (`/`, `/login`, `/register`, the `/projects` layout).
 *
 * Why not `getTranslations()`: it reads the locale cookie, which turns a static
 * route into a per-request function — and next-on-pages then refuses to build it
 * without the Edge Runtime (`scripts/check-edge-runtime.mjs`). A static route has
 * no request locale to honour in the first place: its HTML is rendered once, in
 * the default locale, so its JSON-LD is too. Routes that are already dynamic
 * (`/product`, `/compare`, `/evermind`, `/integrations/*`) resolve the request's
 * locale and never use this.
 *
 * The translator is built on first READ, not at import, and a server component that
 * may render on an EDGE route reads it through {@link serverDefaultCopy} instead:
 * there the default catalog is not bundled, and a nested segment renders in parallel
 * with the root layout (or alone, on a client-side navigation), so it cannot count on
 * the layout having primed it (`primeDefaultCatalog` in `@/i18n/catalog`). The sync
 * reader is for the statically prerendered routes, whose Node build bundles it.
 */
let translator: CopyReader | null = null;
function reader(): CopyReader {
  translator ??= createTranslator({ locale: DEFAULT_LOCALE, messages: defaultCatalog() }) as unknown as CopyReader;
  return translator;
}

export const defaultCopy: CopyReader = Object.assign(
  (key: string, values?: Record<string, string | number>) => reader()(key, values),
  { raw: (key: string) => reader().raw(key) },
);

/** {@link defaultCopy}, once the default catalog is in hand — for server components on edge routes. */
export async function serverDefaultCopy(): Promise<CopyReader> {
  // Edge only (a compile-time constant): the Node build bundles the catalog, and reading
  // request headers there would turn a statically prerendered route dynamic. The origin
  // is the network fallback where there is no ASSETS binding, as in the root layout.
  if (process.env.NEXT_RUNTIME === 'edge') {
    const { requestOrigin } = await import('@/i18n/requestOrigin');
    await primeDefaultCatalog(await requestOrigin());
  }
  return defaultCopy;
}
