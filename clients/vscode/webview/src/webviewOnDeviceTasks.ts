/**
 * The webview's `OnDeviceTasks` (PRD 42 · Part B), beside `webviewPageEngines()` — the twin
 * of the web app's `browserOnDeviceTasks()`. The extension HOST's port answers `null` for
 * translate / detectLanguage (`modelRouting.ts`); the webview is a Chromium page with its own
 * built-in browser APIs and page engines, so language detection and translation can run
 * here without touching the network. Built once, on first use.
 */
import { pageEngineCompletion, pageEnginesReady, pageOnDeviceTasks, type OnDeviceTasks } from '@seanhogg/builderforce-brain-embedded';
import { webviewPageEngines } from './pageEngines';

let tasks: OnDeviceTasks | undefined;

export function webviewOnDeviceTasks(): OnDeviceTasks {
  return (tasks ??= pageOnDeviceTasks({
    pageCompletion: pageEngineCompletion({
      probe: () => webviewPageEngines().probe(),
      // No base: only a page engine's own route is answered, so nothing leaves the page.
      fetch: (input, init) => webviewPageEngines().fetch()(input, init),
    }),
    pageAvailable: () => pageEnginesReady(() => webviewPageEngines().probe()),
  }));
}
