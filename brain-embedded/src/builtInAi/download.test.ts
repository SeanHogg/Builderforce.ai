import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEngineProber, promptApiEngine } from '../browserEngine';
import { createLocalModelStore } from '../pageEngines/modelStore';
import { createBuiltInModels } from './builtInModels';
import { BUILT_IN_REQUIREMENT_KEY, downloadBuiltInModel } from './download';

/**
 * PRD 42 · A2. Load-bearing: download.ts is the ONLY path that calls `create()` on a
 * model that is not `available`; a chat turn on such a model is refused without touching
 * `create()`; progress is a 0..1 fraction; abort rejects; and the picker's store lists the
 * built-in model by its probe `state` and downloads it through the SAME `download` API.
 */

type Listener = (event: { loaded: number; total?: number }) => void;

function installLanguageModel(options: {
  availability: () => string;
  progress?: Array<{ loaded: number; total?: number }>;
  hang?: boolean;
}) {
  const destroy = vi.fn();
  const create = vi.fn(async (init?: { monitor?: (m: EventTarget) => void; signal?: AbortSignal }) => {
    const target = new EventTarget();
    init?.monitor?.(target);
    for (const p of options.progress ?? []) {
      const event = Object.assign(new Event('downloadprogress'), p);
      target.dispatchEvent(event);
    }
    if (options.hang) {
      await new Promise<never>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    return { destroy, inputQuota: 6_144, inputUsage: 0 };
  });
  const factory = { availability: vi.fn(async () => options.availability()), create };
  (globalThis as { LanguageModel?: unknown }).LanguageModel = factory;
  return { create, destroy, factory };
}

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});

describe('downloadBuiltInModel', () => {
  it('reports progress as 0..1 (current builds and loaded/total builds), then destroys the session', async () => {
    const { create, destroy } = installLanguageModel({
      availability: () => 'downloadable',
      progress: [{ loaded: 0.25 }, { loaded: 50, total: 100 }, { loaded: 7, total: 0 }],
    });
    const seen: number[] = [];
    const result = await downloadBuiltInModel({ onProgress: (f) => seen.push(f) });
    expect(result).toBe('available');
    expect(create).toHaveBeenCalledTimes(1);
    // One COMBINED fraction (mean over the chat model and every task model): in [0,1],
    // monotonic, never repeated, and finishing at exactly 1.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.at(-1)).toBe(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  describe('task-API models on the same click', () => {
    type Create = (init?: { monitor?: (m: EventTarget) => void; signal?: AbortSignal; sourceLanguage?: string; targetLanguage?: string }) => Promise<{ destroy(): void }>;
    const installTask = (name: 'Summarizer' | 'Translator' | 'LanguageDetector', create: Create) => {
      (globalThis as Record<string, unknown>)[name] = { availability: vi.fn(async () => 'downloadable'), create: vi.fn(create) };
      return (globalThis as unknown as Record<string, { create: ReturnType<typeof vi.fn> }>)[name]!.create;
    };
    afterEach(() => {
      for (const n of ['Summarizer', 'Translator', 'LanguageDetector']) delete (globalThis as Record<string, unknown>)[n];
    });

    it('starts every create() synchronously, with the viewer pair, and reports one combined fraction', async () => {
      const { create: promptCreate } = installLanguageModel({ availability: () => 'downloadable' });
      const emit = (init: Parameters<Create>[0], loaded: number) => {
        const target = new EventTarget();
        init?.monitor?.(target);
        target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
      };
      const summarizer = installTask('Summarizer', async (init) => { emit(init, 0.5); return { destroy() {} }; });
      const translator = installTask('Translator', async () => ({ destroy() {} }));
      const detector = installTask('LanguageDetector', async () => ({ destroy() {} }));

      const seen: number[] = [];
      const pending = downloadBuiltInModel({ onProgress: (f) => seen.push(f), locale: 'fr-CA' });
      // Before any await resolves: every create() has already been called.
      expect(promptCreate).toHaveBeenCalledTimes(1);
      expect(summarizer).toHaveBeenCalledTimes(1);
      expect(translator).toHaveBeenCalledTimes(1);
      expect(translator.mock.calls[0]![0]).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'fr' });
      expect(detector).toHaveBeenCalledTimes(1);

      expect(await pending).toBe('available');
      expect(seen[0]).toBeCloseTo(0.5 / 4);
      expect(seen[seen.length - 1]).toBe(1);
      expect(seen.every((f, i) => i === 0 || f >= seen[i - 1]!)).toBe(true);
    });

    it('skips the Translator for an English viewer, and a refused task model never fails the chat model', async () => {
      installLanguageModel({ availability: () => 'downloadable' });
      const translator = installTask('Translator', async () => ({ destroy() {} }));
      installTask('Summarizer', async () => { throw new Error('NotSupportedError'); });
      expect(await downloadBuiltInModel({ locale: 'en-US' })).toBe('available');
      expect(translator).not.toHaveBeenCalled();
    });
  });

  it('is unavailable without the API or when the browser refuses', async () => {
    expect(await downloadBuiltInModel()).toBe('unavailable');
    const { create } = installLanguageModel({ availability: () => 'unavailable' });
    create.mockRejectedValueOnce(new Error('NotSupportedError'));
    expect(await downloadBuiltInModel()).toBe('unavailable');
  });

  it('rejects when aborted, before or during the download', async () => {
    const pre = new AbortController();
    pre.abort();
    installLanguageModel({ availability: () => 'downloadable' });
    await expect(downloadBuiltInModel({ signal: pre.signal })).rejects.toBeDefined();

    installLanguageModel({ availability: () => 'downloading', hang: true });
    const controller = new AbortController();
    const pending = downloadBuiltInModel({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('names the hardware-requirement label key', () => {
    expect(BUILT_IN_REQUIREMENT_KEY).toBe('localBuiltInRequirement');
  });
});

describe('a chat turn never downloads', () => {
  it.each(['downloadable', 'downloading'])('refuses a %s model without calling create()', async (availability) => {
    const { create } = installLanguageModel({ availability: () => availability });
    await expect(
      promptApiEngine.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] } as never),
    ).rejects.toMatchObject({ status: 503 });
    expect(create).not.toHaveBeenCalled();
  });

  it('probing a non-ready model never calls create() either', async () => {
    const { create } = installLanguageModel({ availability: () => 'downloadable' });
    const probe = await createBrowserEngineProber().probe();
    expect(probe?.models[0]?.state).toBe('downloadable');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the picker store lists and downloads the built-in model', () => {
  const storeOver = (prober: ReturnType<typeof createBrowserEngineProber>) =>
    createLocalModelStore({ support: {}, catalog: [], engines: [prober], builtIn: createBuiltInModels(prober) });

  it('lists a downloadable row, downloads it through store.download with progress, then turns ready', async () => {
    let availability = 'downloadable';
    const { create } = installLanguageModel({ availability: () => availability, progress: [{ loaded: 0.5 }] });
    const prober = createBrowserEngineProber();
    const store = storeOver(prober);

    const [row] = await store.listLocalModels();
    expect(row).toMatchObject({ runtime: 'browser', state: 'absent', source: { kind: 'browser' } });
    expect(create).not.toHaveBeenCalled();

    const seen: number[] = [];
    const done = store.download(row!.ref, (f) => seen.push(f));
    availability = 'available';
    await done;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => f > 0 && f <= 1)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(1);
    expect(create).toHaveBeenCalledTimes(1); // the download only: no task APIs are installed here

    const [after] = await store.listLocalModels();
    expect(after).toMatchObject({ state: 'ready' });
    expect(create).toHaveBeenCalledTimes(2); // + the now-ready probe's quota read
  });

  it('shows a downloading row (no progress after a reload) and lists nothing without the API', async () => {
    installLanguageModel({ availability: () => 'downloading' });
    const [row] = await storeOver(createBrowserEngineProber()).listLocalModels();
    expect(row).toMatchObject({ state: 'downloading' });
    expect(row?.progress).toBeUndefined();

    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    expect(await storeOver(createBrowserEngineProber()).listLocalModels()).toEqual([]);
  });

  it('a built-in row cannot be removed from here', async () => {
    installLanguageModel({ availability: () => 'available' });
    const store = storeOver(createBrowserEngineProber());
    const [row] = await store.listLocalModels();
    await expect(store.remove(row!.ref)).resolves.toBeUndefined();
  });
});
