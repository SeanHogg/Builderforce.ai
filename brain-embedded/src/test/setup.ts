/**
 * Test setup for the brain core. jsdom provides window/document/navigator, but
 * under Node 26 jsdom 28 no longer installs `localStorage` (its Web Storage was
 * withdrawn; Node's own experimental global does not substitute inside the
 * jsdom global proxy). Every test that reads/writes `localStorage` — pendingWords,
 * pendingPrompt, continueStop, attachmentContent, useBrainConversation, the
 * replay/confirmation hooks — throws `localStorage is undefined` without this.
 * So setup installs a real jsdom `localStorage` (an opaque origin still exposes
 * a usable in-memory store) onto the global the tests see.
 *
 * jsdom ships no bundled types and the package has no `@types/jsdom`, so the
 * import is silenced with `@ts-expect-error` against a structural local type —
 * a `createRequire` dynamic load intermittently failed to unwrap the CJS
 * `{ JSDOM }` export under vitest's SSR runner ("Dom is not a constructor"),
 * which starved the whole suite of `localStorage`. A static ESM import resolves
 * reliably.
 */
// @ts-expect-error jsdom provides no type declarations.
import { JSDOM } from 'jsdom';

interface JsdomWindow {
  localStorage?: Storage;
}

const g = globalThis as Record<string, unknown>;
if (g.localStorage === undefined || typeof g.localStorage !== 'object') {
  const dom = new JSDOM('', { url: 'http://localhost/' });
  const storage = (dom.window as JsdomWindow).localStorage;
  if (storage) {
    Object.defineProperty(g, 'localStorage', {
      value: storage,
      writable: true,
      configurable: true,
    });
  }
}

export {};
