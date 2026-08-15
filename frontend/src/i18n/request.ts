import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { BRAND } from '@/lib/content';
import { loadCatalog } from './catalog';
import { DEFAULT_LOCALE, isLocale } from './config';
import { ignoreEnvironmentFallback } from './onError';

/**
 * Per-request locale + message resolution for next-intl (App Router, no i18n
 * routing). Reads the active locale from the `NEXT_LOCALE` cookie and loads ONLY
 * that locale's catalog, through the shared loader in `./catalog` — which fetches
 * it as a published static asset rather than importing it, so a server-rendering
 * route no longer carries 3.5 MB of catalogs it will never use. See that file for
 * why (it is the reason `/embedded` could not be built as an edge function).
 */

/**
 * Absolute origin to resolve the catalog asset against.
 *
 * A worker has no implicit base URL, and the deployed host differs per
 * environment (production, a Pages preview, `next dev`), so it comes from the
 * request. `BRAND.url` is the last resort rather than the default: a preview
 * deploy must read ITS OWN catalogs, not production's.
 */
async function requestOrigin(): Promise<string> {
  const head = await headers();
  const host = head.get('host');
  if (!host) return BRAND.url;
  const protocol = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get('NEXT_LOCALE')?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    // The default locale is served from the bundled catalog, so the common path
    // costs no request at all and `requestOrigin()` is never asked for.
    messages: locale === DEFAULT_LOCALE ? await loadCatalog(locale) : await loadCatalog(locale, await requestOrigin()),
    // We intentionally format in the viewer's local clock + time zone (see
    // ./onError). Swallow only the benign ENVIRONMENT_FALLBACK code so it does
    // not spam logs; every real i18n error still surfaces.
    onError: ignoreEnvironmentFallback,
  };
});
