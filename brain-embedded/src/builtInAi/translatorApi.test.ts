/**
 * PRD 42 · B2 — the Translator downloads the pair a translation actually runs
 * (`detected → locale`), not only `en → locale`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNeededTranslatorPairs, neededTranslatorPairs, translatorAdapter, translatorPairsToDownload,
} from './translatorApi';

function installTranslator(availability: (o: { sourceLanguage: string; targetLanguage: string }) => string) {
  const create = vi.fn(async (_o: { sourceLanguage: string; targetLanguage: string }) => ({
    translate: async () => 'translated',
    destroy: () => undefined,
  }));
  (globalThis as { Translator?: unknown }).Translator = {
    availability: vi.fn(async (o: { sourceLanguage: string; targetLanguage: string }) => availability(o)),
    create,
  };
  return { create };
}

afterEach(() => {
  delete (globalThis as { Translator?: unknown }).Translator;
  clearNeededTranslatorPairs();
});

describe('translatorAdapter download pairs', () => {
  it('regression: an English-locale reader gets the es → en pack a Spanish message needed (was: nothing)', async () => {
    const { create } = installTranslator(() => 'downloadable');
    // The translation finds its pack missing: it returns null and records the pair.
    expect(await translatorAdapter.translate!('hola', { from: 'es', to: 'en' })).toBeNull();
    expect(neededTranslatorPairs()).toEqual([{ from: 'es', to: 'en' }]);
    // The "get translator" Download click then fetches exactly that pair.
    await translatorAdapter.download!({ onProgress: () => undefined, locale: 'en-US' });
    expect(create.mock.calls.map((c) => [c[0].sourceLanguage, c[0].targetLanguage])).toEqual([['es', 'en']]);
  });

  it('still fetches en → <viewer> for a non-English viewer, alongside a needed pair and a host-named pair', () => {
    clearNeededTranslatorPairs();
    expect(translatorPairsToDownload({ locale: 'fr-CA', translatorPairs: [{ from: 'de', to: 'fr' }] })).toEqual([
      { from: 'de', to: 'fr' },
      { from: 'en', to: 'fr' },
    ]);
  });

  it('never asks for a same-language pair and dedupes', () => {
    expect(translatorPairsToDownload({ locale: 'en', translatorPairs: [{ from: 'EN', to: 'en' }, { from: 'ja', to: 'en' }, { from: 'ja', to: 'EN' }] })).toEqual([
      { from: 'ja', to: 'en' },
    ]);
  });

  it('forgets a pair once its pack is available', async () => {
    let state = 'downloadable';
    installTranslator(() => state);
    await translatorAdapter.translate!('hola', { from: 'es', to: 'en' });
    expect(neededTranslatorPairs()).toHaveLength(1);
    state = 'available';
    expect(await translatorAdapter.translate!('hola', { from: 'es', to: 'en' })).toBe('translated');
    expect(neededTranslatorPairs()).toEqual([]);
  });
});
