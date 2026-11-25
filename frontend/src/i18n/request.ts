import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { loadCatalog } from './catalog';
import { DEFAULT_LOCALE, isLocale } from './config';
import { ignoreEnvironmentFallback } from './onError';
import { requestOrigin } from './requestOrigin';

/**
 * Per-request locale + message resolution for next-intl (App Router, no i18n
 * routing). Reads the active locale from the `NEXT_LOCALE` cookie and loads ONLY
 * that locale's catalog, through the shared loader in `./catalog` — which fetches
 * it as a published static asset rather than importing it, so a server-rendering
 * route no longer carries 3.5 MB of catalogs it will never use. See that file for
 * why (it is the reason `/embedded` could not be built as an edge function).
 */

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get('NEXT_LOCALE')?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    // Every locale gets the origin: on the edge server even the default catalog is a
    // published-asset read (see `./catalog`), and the origin is its network fallback
    // where there is no ASSETS binding. Elsewhere the default is bundled and the
    // origin goes unused.
    messages: await loadCatalog(locale, await requestOrigin()),
    // We intentionally format in the viewer's local clock + time zone (see
    // ./onError). Swallow only the benign ENVIRONMENT_FALLBACK code so it does
    // not spam logs; every real i18n error still surfaces.
    onError: ignoreEnvironmentFallback,
  };
});
