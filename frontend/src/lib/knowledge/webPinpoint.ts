/**
 * The web's half of "pinpoint from a screenshot" (PRD 38, Option B+): the vision call and the
 * app's own i18n catalogs. The matching is the shared core in `@builderforce/knowledge-browser`.
 *
 *   describe     - the gateway's chat completion with the user's session (`llmChat`), sending
 *                  THE shared vision request (`pinpointVisionRequest`: no pinned model, the
 *                  gateway picks a vision-capable one, or answers `model_input_unsupported`,
 *                  which surfaces as the error);
 *   catalogKeys  - the app's own catalogs (through `@/i18n/catalog`): a screen string is looked
 *                  up as a catalog VALUE, in English and in the active locale, giving its key(s).
 */

import { keysOfValue, pinpointVisionRequest } from '@builderforce/agent-tools/knowledge';
import type { PinpointHost } from '@builderforce/knowledge-browser';
import { loadCatalog } from '@/i18n/catalog';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/config';
import { llmChat } from '@/lib/builderforceApi';

/**
 * A catalog through THE one loader (`@/i18n/catalog`): the bundled default, or a
 * published catalog read once and held by its read-through cache. Never an `import()`
 * of the JSON — that put all five catalogs (~8 MB) into the build as chunks.
 */
const catalog = (locale: Locale): Promise<unknown> => loadCatalog(locale);

/** English plus the page's active locale (when it is another catalog we ship). */
function activeLocales(): Locale[] {
  const lang = typeof document === 'undefined' ? DEFAULT_LOCALE : document.documentElement.lang.slice(0, 2).toLowerCase();
  return lang !== DEFAULT_LOCALE && isLocale(lang) ? [DEFAULT_LOCALE, lang] : [DEFAULT_LOCALE];
}

export const webPinpointHost: PinpointHost = {
  async describe(imageDataUrl) {
    const request = pinpointVisionRequest(imageDataUrl);
    const { content } = await llmChat(request.messages, { temperature: request.temperature, maxTokens: request.max_tokens, model: null });
    return content;
  },
  async catalogKeys(text) {
    const keys = new Set<string>();
    for (const locale of activeLocales()) for (const key of keysOfValue(await catalog(locale), text)) keys.add(key);
    return [...keys];
  },
};
