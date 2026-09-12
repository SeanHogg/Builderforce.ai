import { createTranslator } from 'next-intl';
import { defaultMessages } from '@/i18n/catalog';
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
 */
export const defaultCopy = createTranslator({ locale: DEFAULT_LOCALE, messages: defaultMessages }) as unknown as CopyReader;
