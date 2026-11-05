/**
 * The web's half of "pinpoint from a screenshot" (PRD 38, Option B+): the vision call and the
 * app's own i18n catalogs. The matching is the shared core in `@builderforce/knowledge-browser`.
 *
 *   describe     - the gateway's chat completion with the user's session (`llmChat`), sending
 *                  THE shared vision request (`pinpointVisionRequest`: no pinned model, the
 *                  gateway picks a vision-capable one, or answers `model_input_unsupported`,
 *                  which surfaces as the error);
 *   catalogKeys  - the catalogs are in the bundle: a screen string is looked up as a catalog
 *                  VALUE, in English and in the active locale, giving its key(s).
 */

import { keysOfValue, pinpointVisionRequest } from '@builderforce/agent-tools/knowledge';
import type { PinpointHost } from '@builderforce/knowledge-browser';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { llmChat } from '@/lib/builderforceApi';

const CATALOGS: Record<string, () => Promise<unknown>> = {
  en: () => import('@/i18n/messages/en.json').then((m) => m.default),
  es: () => import('@/i18n/messages/es.json').then((m) => m.default),
  fr: () => import('@/i18n/messages/fr.json').then((m) => m.default),
  de: () => import('@/i18n/messages/de.json').then((m) => m.default),
  zh: () => import('@/i18n/messages/zh.json').then((m) => m.default),
};

/** A catalog is session-lived: the read-through cache holds it (and shares one in-flight load). */
const catalog = (locale: string): Promise<unknown> => getOrSetClientCached(`knowledge-pinpoint:catalog:${locale}`, () => CATALOGS[locale]!());

/** English plus the page's active locale (when it is another catalog we ship). */
function activeLocales(): string[] {
  const lang = typeof document === 'undefined' ? 'en' : document.documentElement.lang.slice(0, 2).toLowerCase();
  return lang !== 'en' && lang in CATALOGS ? ['en', lang] : ['en'];
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
