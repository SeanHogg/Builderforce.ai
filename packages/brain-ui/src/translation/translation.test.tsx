import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import type { OnDeviceTasks } from '@seanhogg/builderforce-brain-embedded';
import { TranslatableText } from './TranslatableText';
import { TranslationProvider, type CloudTranslate } from './context';
import { memoryTranslationCache } from './translationCache';
import { createTranslateBatcher } from './batcher';
import { createCloudTranslate, type CloudTranslateBody } from './cloudTranslate';
import { clearRecentOutcomes } from './useTranslatedText';
import { DEFAULT_TRANSLATION_LABELS, translationLabelsFrom } from './labels';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); clearRecentOutcomes(); });

function mount(ui: ReactElement): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root;
  act(() => { root = createRoot(el); root.render(ui); });
  mounted.push(() => { act(() => { root.unmount(); }); el.remove(); });
  return el;
}

const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

function tasksOf(over: { lang?: string; confidence?: number; translated?: string | null }): OnDeviceTasks {
  const { lang = 'es', confidence = 0.95, translated = 'Hello world' } = over;
  return {
    detectLanguage: vi.fn(async () => ({ lang, confidence })),
    translate: vi.fn(async () => translated),
  } as unknown as OnDeviceTasks;
}

const SOURCE = 'Hola mundo, esto es una prueba';

function view(p: { tasks: OnDeviceTasks | null; cloud?: CloudTranslate | null; cache?: ReturnType<typeof memoryTranslationCache>; openModelPicker?: () => void }) {
  return (
    <TranslationProvider tasks={p.tasks} cloud={p.cloud ?? null} locale="en" cache={p.cache ?? memoryTranslationCache()} openModelPicker={p.openModelPicker}>
      <TranslatableText text={SOURCE} contentId="m1" />
    </TranslationProvider>
  );
}

describe('TranslatableText', () => {
  it('renders plain text when the language matches the reader', async () => {
    const tasks = tasksOf({ lang: 'en-US' });
    const el = mount(view({ tasks }));
    await flush();
    expect(el.textContent).toBe(SOURCE);
    expect(tasks.translate).not.toHaveBeenCalled();
  });

  it('renders plain text when detection is unsure (< 0.6)', async () => {
    const tasks = tasksOf({ confidence: 0.59 });
    const el = mount(view({ tasks }));
    await flush();
    expect(el.textContent).toBe(SOURCE);
    expect(tasks.translate).not.toHaveBeenCalled();
  });

  it('shows the on-device translation with a toggle back to the original', async () => {
    const el = mount(view({ tasks: tasksOf({}) }));
    await flush();
    expect(el.textContent).toContain('Hello world');
    expect(el.textContent).toContain('Translated from Spanish');
    const toggle = el.querySelector('button.bf-tr__link') as HTMLButtonElement;
    expect(toggle.textContent).toBe(DEFAULT_TRANSLATION_LABELS.showOriginal);
    act(() => { toggle.click(); });
    expect(el.textContent).toContain(SOURCE);
    expect(el.textContent).not.toContain('Hello world');
    expect(el.querySelector('button.bf-tr__link')!.textContent).toBe(DEFAULT_TRANSLATION_LABELS.showTranslation);
  });

  it('falls back to the cloud when the device cannot translate', async () => {
    const cloud = vi.fn(async () => ['From the cloud']);
    const el = mount(view({ tasks: tasksOf({ translated: null }), cloud }));
    await flush();
    expect(cloud).toHaveBeenCalledWith([SOURCE], 'en', 'es');
    expect(el.textContent).toContain('From the cloud');
  });

  it('under Local only (no cloud) shows the original with a hint that opens the picker', async () => {
    const open = vi.fn();
    const el = mount(view({ tasks: tasksOf({ translated: null }), cloud: null, openModelPicker: open }));
    await flush();
    expect(el.textContent).toContain(SOURCE);
    expect(el.textContent).toContain(DEFAULT_TRANSLATION_LABELS.needsTranslator);
    act(() => { (el.querySelector('button.bf-tr__link') as HTMLButtonElement).click(); });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows the original quietly when the cloud refuses', async () => {
    const cloud = vi.fn(async () => { throw new Error('429'); });
    const el = mount(view({ tasks: tasksOf({ translated: null }), cloud }));
    await flush();
    expect(el.textContent).toBe(SOURCE);
  });

  it('a cache hit avoids both detection and translation', async () => {
    const cache = memoryTranslationCache();
    const first = tasksOf({});
    mount(view({ tasks: first, cache }));
    await flush();
    const second = tasksOf({});
    const cloud = vi.fn(async () => ['x']);
    const el = mount(view({ tasks: second, cloud, cache }));
    await flush();
    expect(second.detectLanguage).not.toHaveBeenCalled();
    expect(second.translate).not.toHaveBeenCalled();
    expect(cloud).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Hello world');
  });

  it('renders the text unchanged with no provider, and never changes the source', async () => {
    const el = mount(<TranslatableText text={SOURCE} contentId="m1" />);
    await flush();
    expect(el.textContent).toBe(SOURCE);
    const input = { text: SOURCE };
    mount(
      <TranslationProvider tasks={tasksOf({})} cloud={null} locale="en" cache={null}>
        <TranslatableText text={input.text} contentId="m2" />
      </TranslationProvider>,
    );
    await flush();
    expect(input.text).toBe(SOURCE);
  });

  it('does nothing when disabled', async () => {
    const tasks = tasksOf({});
    const el = mount(
      <TranslationProvider tasks={tasks} cloud={null} locale="en" cache={null}>
        <TranslatableText text={SOURCE} contentId="m3" enabled={false} />
      </TranslationProvider>,
    );
    await flush();
    expect(tasks.detectLanguage).not.toHaveBeenCalled();
    expect(el.textContent).toBe(SOURCE);
  });
});

describe('createTranslateBatcher', () => {
  it('sends the calls of one tick as one request of at most 20 texts', async () => {
    const send = vi.fn(async (texts: string[]) => texts.map((t) => t.toUpperCase()));
    const cloud = createTranslateBatcher(send);
    const texts = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const out = await Promise.all(texts.map((t) => cloud([t], 'en', 'es')));
    expect(out.map((o) => o[0])).toEqual(texts.map((t) => t.toUpperCase()));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toHaveLength(20);
  });

  it('rejects every caller of a failed request', async () => {
    const cloud = createTranslateBatcher(async () => { throw new Error('503'); });
    await expect(Promise.all([cloud(['a'], 'en'), cloud(['b'], 'en')])).rejects.toThrow('503');
  });
});

describe('translationLabelsFrom', () => {
  it('reads translation.* and keeps English where the catalog is silent', () => {
    const labels = translationLabelsFrom((key) => (key === 'translation.showOriginal' ? 'Original anzeigen' : undefined));
    expect(labels.showOriginal).toBe('Original anzeigen');
    expect(labels.translatedFrom).toBe(DEFAULT_TRANSLATION_LABELS.translatedFrom);
  });
});

describe('createCloudTranslate', () => {
  it('always sends the source language, batching only texts that share it', async () => {
    const request = vi.fn(async (body: CloudTranslateBody) => ({ translations: body.texts.map((t) => t.toUpperCase()) }));
    const cloud = createCloudTranslate(request);
    const [es, fr] = await Promise.all([cloud(['hola'], 'en', 'es'), cloud(['bonjour'], 'en', 'fr'), cloud(['adios'], 'en', 'es')]);
    expect(es).toEqual(['HOLA']);
    expect(fr).toEqual(['BONJOUR']);
    expect(request).toHaveBeenCalledTimes(2);
    for (const [body] of request.mock.calls) expect(typeof body.from).toBe('string');
    expect(request.mock.calls.find(([b]) => b.from === 'es')![0].texts).toEqual(['hola', 'adios']);
  });

  it('never calls the cloud without a detected language', async () => {
    const request = vi.fn(async () => ({ translations: [] as string[] }));
    await expect(createCloudTranslate(request)(['hola'], 'en')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('failed outcomes', () => {
  it('are remembered briefly, so a remount does not ask the cloud again', async () => {
    const cloud = vi.fn(async () => { throw new Error('429'); });
    const text = 'Hola mundo, un mensaje distinto para la prueba de fallos';
    const ui = (id: string) => (
      <TranslationProvider tasks={tasksOf({ translated: null })} cloud={cloud} locale="en" cache={null}>
        <TranslatableText text={text} contentId={id} />
      </TranslationProvider>
    );
    mount(ui('fail-1'));
    await flush();
    mount(ui('fail-1'));
    await flush();
    expect(cloud).toHaveBeenCalledTimes(1);
  });
});
