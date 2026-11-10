import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import type { OnDeviceTasks } from '@seanhogg/builderforce-brain-embedded';
import { TranslatableText } from './TranslatableText';
import { TranslationProvider, type CloudTranslate } from './context';
import {
  TRANSLATION_CACHE_TTL_MS,
  memoryTranslationCache,
  retirableTranslationCache,
  selectEvictions,
  translationCacheKey,
  type TranslationCache,
} from './translationCache';
import { clearRecentOutcomes } from './useTranslatedText';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); clearRecentOutcomes(); });

function host(): { render: (ui: ReactElement) => void; el: HTMLDivElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root!: Root;
  act(() => { root = createRoot(el); });
  cleanups.push(() => { act(() => { root.unmount(); }); el.remove(); });
  return { el, render: (ui) => act(() => { root.render(ui); }) };
}

const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

const SOURCE = 'Hola mundo, esto es una prueba de identidad';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function spyCache(): TranslationCache & { writes: string[] } {
  const inner = memoryTranslationCache();
  const writes: string[] = [];
  return {
    writes,
    get: (k) => inner.get(k),
    set: async (k, e) => { if (e.kind === 'translated') writes.push(e.text); await inner.set(k, e); },
    clear: () => inner.clear(),
  };
}

const ui = (p: { identity: string; cache: TranslationCache; tasks: OnDeviceTasks; cloud?: CloudTranslate | null }) => (
  <TranslationProvider tasks={p.tasks} cloud={p.cloud ?? null} locale="en" cache={p.cache} identity={p.identity}>
    <TranslatableText text={SOURCE} contentId="id-1" />
  </TranslationProvider>
);

describe('identity change', () => {
  it('regression: an in-flight translation for the previous identity is not written into the cleared cache', async () => {
    const pending = [deferred<string | null>(), deferred<string | null>()];
    let call = 0;
    const tasks = {
      detectLanguage: vi.fn(async () => ({ lang: 'es', confidence: 0.95 })),
      translate: vi.fn(() => pending[call++]!.promise),
    } as unknown as OnDeviceTasks;
    const cache = spyCache();
    const { render } = host();
    render(ui({ identity: 'alice', cache, tasks }));
    await flush();
    expect(tasks.translate).toHaveBeenCalledTimes(1);
    render(ui({ identity: 'bob', cache, tasks }));
    await flush();
    pending[0]!.resolve('Translated for alice');
    await flush();
    expect(cache.writes).not.toContain('Translated for alice');
    expect(await cache.get(translationCacheKey('id-1', 'en', SOURCE))).toBeUndefined();
    pending[1]!.resolve('Translated for bob');
    await flush();
    expect(cache.writes).toEqual(['Translated for bob']);
  });

  it('regression: remembered failures are forgotten on sign-out, so the next identity asks again', async () => {
    const cloud = vi.fn(async () => { throw new Error('429'); });
    const tasks = {
      detectLanguage: vi.fn(async () => ({ lang: 'es', confidence: 0.95 })),
      translate: vi.fn(async () => null),
    } as unknown as OnDeviceTasks;
    const cache = memoryTranslationCache();
    const { render } = host();
    render(ui({ identity: 'alice', cache, tasks, cloud }));
    await flush();
    expect(cloud).toHaveBeenCalledTimes(1);
    render(ui({ identity: 'bob', cache, tasks, cloud }));
    await flush();
    expect(cloud).toHaveBeenCalledTimes(2);
  });

  it('regression: user A → signed out (null) → user B clears the cache, and nothing of A\'s survives for B', async () => {
    const tasks = { detectLanguage: vi.fn(async () => ({ lang: 'en', confidence: 0.95 })), translate: vi.fn(async () => null) } as unknown as OnDeviceTasks;
    const inner = memoryTranslationCache();
    const clear = vi.spyOn(inner, 'clear');
    await inner.set('a-entry', { kind: 'translated', from: 'es', text: 'for alice' });
    const { render } = host();
    const at = (identity: string | null) => (
      <TranslationProvider tasks={tasks} cloud={null} locale="en" cache={inner} identity={identity}>
        <TranslatableText text={SOURCE} contentId="id-2" />
      </TranslationProvider>
    );
    render(at('alice'));
    await flush();
    expect(clear).not.toHaveBeenCalled();
    render(at(null));
    await flush();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(await inner.get('a-entry')).toBeUndefined();
    render(at('bob'));
    await flush();
    // Signing in after a sign-out has nothing left to clear: the cache was emptied at sign-out.
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('a retired cache view drops writes but still reads and clears', async () => {
    const inner = memoryTranslationCache();
    const view = retirableTranslationCache(inner);
    await view.set('a', { kind: 'plain' });
    view.retire();
    await view.set('b', { kind: 'plain' });
    expect(await view.get('a')).toEqual({ kind: 'plain' });
    expect(await inner.get('b')).toBeUndefined();
    await view.clear();
    expect(await inner.get('a')).toBeUndefined();
  });
});

describe('selectEvictions', () => {
  const now = 10 * TRANSLATION_CACHE_TTL_MS;
  it('regression: evicts by each row\'s own timestamp — expired first, then the least recently used beyond the bound', () => {
    const rows = [
      { key: 'fresh', at: now - 1 },
      { key: 'old', at: now - TRANSLATION_CACHE_TTL_MS - 1 },
      { key: 'older-live', at: now - 100 },
      { key: 'mid', at: now - 50 },
    ];
    expect(selectEvictions(rows, now, 2)).toEqual(['old', 'older-live']);
  });

  it('evicts nothing within the bound and TTL, and does not reorder its input', () => {
    const rows = [{ key: 'b', at: now - 2 }, { key: 'a', at: now - 1 }];
    expect(selectEvictions(rows, now, 5)).toEqual([]);
    expect(rows.map((r) => r.key)).toEqual(['b', 'a']);
  });
});
