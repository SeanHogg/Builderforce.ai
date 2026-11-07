/**
 * The browser's `Translator` API — the ONE detection of it (PRD 42 · B2). Stable in Chrome
 * 138; Edge exposes none. A language pair's pack may be `downloadable` — that reads as
 * "not here" (a task never downloads). There is NO generic-model fallback.
 */

import type { TranslateOptions } from '../onDevice/onDeviceTasks';
import {
  downloadTaskModel, withTaskSession,
  type BuiltInAdapter, type TaskApiFactory, type TaskApiSession,
} from './taskSession';

interface TranslatorSession extends TaskApiSession {
  translate(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

type TranslatorFactory = TaskApiFactory<TranslatorSession, TranslatorCreateOptions>;

function translatorFactory(): TranslatorFactory | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as unknown as { Translator?: TranslatorFactory }).Translator ?? null;
}

export const translatorAdapter: BuiltInAdapter = {
  id: 'translator',
  kinds: ['translate'],
  // The API's presence; whether a pair's pack is ready is asked per translate.
  ready: async () => translatorFactory() !== null,
  // The pack is per pair: English → the viewer's language (none when they read English).
  download: (o) => {
    const target = o.locale?.split('-')[0]?.toLowerCase();
    if (!target || target === 'en') return Promise.resolve();
    return downloadTaskModel(translatorFactory(), { sourceLanguage: 'en', targetLanguage: target }, o);
  },
  translate: (text, o: TranslateOptions) => {
    // The Translator needs a source; the caller detects it (LanguageDetector) when it can.
    if (!o.from) return Promise.resolve(null);
    return withTaskSession(
      translatorFactory(),
      { sourceLanguage: o.from, targetLanguage: o.to },
      o.signal,
      async (session) => {
        const out = await session.translate(text, o.signal ? { signal: o.signal } : undefined);
        return out.trim() ? out : null;
      },
    );
  },
};
