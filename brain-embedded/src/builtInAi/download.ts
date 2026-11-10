/**
 * The ONE place the browser's built-in model is downloaded (PRD 42 · A2).
 *
 * A download starts only when `create()` is called on a model that is not yet
 * `available`, and the browser requires that call to happen inside a USER ACTIVATION
 * (a click). So this function is reached from exactly one place: the "On this device"
 * picker's Download button, through the ONE model store (`pageEngines/modelStore.ts`,
 * whose `browser` backend delegates here). It is never called from routing, from a chat
 * turn or from a probe — those only ask `availability()`, which never downloads.
 *
 * Call it synchronously from the click handler's task (no long awaits first): the
 * activation is transient. This function itself issues `create()` before any await.
 */

import { languageDetectorAdapter } from './languageDetectorApi';
import { promptApiFactory } from './promptApi';
import { summarizerAdapter } from './summarizerApi';
import { progressFraction, type BuiltInAdapter, type TranslatorPair } from './taskSession';
import { translatorAdapter } from './translatorApi';

/**
 * The label field (brain-ui `LocalModelLabels`) that states the browser's hardware
 * requirement for its built-in model — a KEY, not text, so each host renders its own
 * localized copy.
 */
export const BUILT_IN_REQUIREMENT_KEY = 'localBuiltInRequirement' as const;

export interface BuiltInDownloadOptions {
  /** Called with 0..1 as bytes arrive. */
  onProgress?: (fraction: number) => void;
  /** Aborts the download; the promise rejects with the abort reason. */
  signal?: AbortSignal;
  /** The viewer's locale for the Translator pair; defaults to `navigator.language`. */
  locale?: string;
  /** Translator pairs (source → target) the host knows a message needs; the Translator also
   *  fetches every pair a translation already found missing on this device. */
  translatorPairs?: readonly TranslatorPair[];
}

/** The task-API models fetched on the same click as the chat model (PRD 42 · A2). */
const TASK_DOWNLOADERS: readonly BuiltInAdapter[] = [summarizerAdapter, translatorAdapter, languageDetectorAdapter];

const defaultLocale = (): string | undefined =>
  typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : undefined;

/**
 * Download the built-in model — and the task-API models (Summarizer, Translator for the
 * viewer's pair, LanguageDetector) — reporting ONE combined progress, and resolve
 * `'available'` once the chat model is ready, or `'unavailable'` when this browser has no
 * such model or refuses to fetch it. A task model the browser refuses is skipped; it never
 * fails the chat model. An aborted download REJECTS (a cancel is not a refusal).
 *
 * Every `create()` starts synchronously (before any await) so each is inside the click's
 * activation; the awaiting happens together afterwards.
 */
export async function downloadBuiltInModel(options: BuiltInDownloadOptions = {}): Promise<'available' | 'unavailable'> {
  const { onProgress, signal } = options;
  const factory = promptApiFactory();
  if (!factory) return 'unavailable';
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const locale = options.locale ?? defaultLocale();
  const downloaders = TASK_DOWNLOADERS.filter((a) => a.download);
  const fractions = new Array<number>(1 + downloaders.length).fill(0);
  let lastReported = -1;
  const report = (slot: number, fraction: number): void => {
    fractions[slot] = Math.max(fractions[slot] ?? 0, fraction);
    const combined = fractions.reduce((a, b) => a + b, 0) / fractions.length;
    if (combined === lastReported) return; // a repeated value tells the viewer nothing
    lastReported = combined;
    onProgress?.(combined);
  };

  // Started in one synchronous run: the chat model first, then each task model.
  const main = factory.create({
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        const fraction = progressFraction(event);
        if (fraction !== undefined) report(0, fraction);
      });
    },
    ...(signal ? { signal } : {}),
  });
  const tasks = downloaders.map((adapter, i) =>
    adapter.download!({
      onProgress: (f) => report(i + 1, f),
      ...(signal ? { signal } : {}),
      ...(locale ? { locale } : {}),
      ...(options.translatorPairs ? { translatorPairs: options.translatorPairs } : {}),
    }).then(() => report(i + 1, 1)),
  );

  const [mainResult, ...taskResults] = await Promise.allSettled([main, ...tasks]);
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  for (const r of taskResults) if (r.status === 'rejected') throw r.reason;
  if (mainResult?.status !== 'fulfilled') return 'unavailable';
  mainResult.value.destroy();
  report(0, 1);
  return 'available';
}
