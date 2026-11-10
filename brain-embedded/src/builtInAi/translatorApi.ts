/**
 * The browser's `Translator` API — the ONE detection of it (PRD 42 · B2). Stable in Chrome
 * 138; Edge exposes none. A language pair's pack may be `downloadable` — that reads as
 * "not here" (a task never downloads). There is NO generic-model fallback.
 *
 * The pack is per (source, target) pair, and a translation runs `detected → locale`. So the
 * pair a DOWNLOAD fetches is the pair a translation needed: every translate whose pack is
 * not on this device yet (`downloadable` / `downloading`) records its pair here, and the
 * next Download click (a user activation — `download.ts`) fetches exactly those pairs, plus
 * any the host names (`translatorPairs`) and the `en → <viewer>` default. An English-locale
 * reader of a Spanish message therefore gets the `es → en` pack, not nothing.
 */

import type { TranslateOptions } from '../onDevice/onDeviceTasks';
import {
  downloadTaskModel, withTaskSession,
  type AdapterDownloadOptions, type BuiltInAdapter, type TaskApiFactory, type TaskApiSession, type TranslatorPair,
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

/** The most pairs remembered for the next download — a reader meets a handful of languages. */
const MAX_NEEDED_PAIRS = 8;

/** Pairs a translation needed whose pack is not on this device yet, oldest first. */
const neededPairs = new Map<string, TranslatorPair>();

const pairKey = (p: TranslatorPair): string => `${p.from.toLowerCase()}>${p.to.toLowerCase()}`;

/** Remember a pair the next download must fetch (bounded; the newest wins). */
export function noteTranslatorPairNeeded(pair: TranslatorPair): void {
  const key = pairKey(pair);
  neededPairs.delete(key);
  neededPairs.set(key, pair);
  while (neededPairs.size > MAX_NEEDED_PAIRS) neededPairs.delete(neededPairs.keys().next().value as string);
}

/** The pairs translations needed and could not run on this device (for a host and tests). */
export function neededTranslatorPairs(): TranslatorPair[] {
  return [...neededPairs.values()];
}

/** Forget every remembered pair (tests). */
export function clearNeededTranslatorPairs(): void {
  neededPairs.clear();
}

/** The pairs one download fetches: the needed ones, the host's, then `en → <viewer>`; deduped, never `x → x`. */
export function translatorPairsToDownload(o: Pick<AdapterDownloadOptions, 'locale' | 'translatorPairs'>): TranslatorPair[] {
  const viewer = o.locale?.split('-')[0]?.toLowerCase();
  const candidates: TranslatorPair[] = [
    ...neededTranslatorPairs(),
    ...(o.translatorPairs ?? []),
    ...(viewer ? [{ from: 'en', to: viewer }] : []),
  ];
  const out = new Map<string, TranslatorPair>();
  for (const p of candidates) {
    if (!p.from || !p.to || p.from.toLowerCase() === p.to.toLowerCase()) continue;
    if (!out.has(pairKey(p))) out.set(pairKey(p), p);
  }
  return [...out.values()];
}

/**
 * The factory a translate reads through: its availability answer records the pair when the
 * pack is not here yet (so the Download click fetches it) and forgets it once it is.
 */
function recordingFactory(factory: TranslatorFactory | null, pair: TranslatorPair): TranslatorFactory | null {
  if (!factory) return null;
  return {
    availability: async (options) => {
      const state = await factory.availability(options);
      if (state === 'downloadable' || state === 'downloading') noteTranslatorPairNeeded(pair);
      else neededPairs.delete(pairKey(pair));
      return state;
    },
    create: (options) => factory.create(options),
  };
}

export const translatorAdapter: BuiltInAdapter = {
  id: 'translator',
  kinds: ['translate'],
  // The API's presence; whether a pair's pack is ready is asked per translate.
  ready: async () => translatorFactory() !== null,
  // One pack per pair a translation needs; every `create()` starts in this synchronous run
  // (inside the click's activation). Combined progress is the mean over the pairs.
  download: (o) => {
    const factory = translatorFactory();
    const pairs = translatorPairsToDownload(o);
    if (!factory || pairs.length === 0) return Promise.resolve();
    const fractions = new Array<number>(pairs.length).fill(0);
    const report = (i: number, f: number): void => {
      fractions[i] = Math.max(fractions[i] ?? 0, f);
      o.onProgress(fractions.reduce((a, b) => a + b, 0) / fractions.length);
    };
    const downloads = pairs.map((p, i) =>
      downloadTaskModel(factory, { sourceLanguage: p.from, targetLanguage: p.to }, { ...o, onProgress: (f) => report(i, f) }),
    );
    return Promise.all(downloads).then(() => undefined);
  },
  translate: (text, o: TranslateOptions) => {
    // The Translator needs a source; the caller detects it (LanguageDetector) when it can.
    if (!o.from) return Promise.resolve(null);
    return withTaskSession(
      recordingFactory(translatorFactory(), { from: o.from, to: o.to }),
      { sourceLanguage: o.from, targetLanguage: o.to },
      o.signal,
      async (session) => {
        const out = await session.translate(text, o.signal ? { signal: o.signal } : undefined);
        return out.trim() ? out : null;
      },
    );
  },
};
