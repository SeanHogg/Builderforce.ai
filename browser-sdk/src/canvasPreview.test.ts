import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANVAS_PREVIEW_MESSAGE, installCanvasPreviewReporter } from './canvasPreview';

/** A `window` stand-in with the two things the reporter branches on: a `parent` that is
 *  either itself (unframed) or a separate object (framed), and a console it may patch. */
function fakeWindow(framed: boolean) {
  const posted: unknown[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const logged: string[] = [];
  const view = {
    console: {
      log: (...args: unknown[]) => logged.push(`log ${args.join(' ')}`),
      warn: (...args: unknown[]) => logged.push(`warn ${args.join(' ')}`),
      error: (...args: unknown[]) => logged.push(`error ${args.join(' ')}`),
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn); },
    fetch: vi.fn(async () => ({ status: 200 })),
    parent: null as unknown,
  };
  view.parent = framed ? { postMessage: (message: unknown) => posted.push(message) } : view;
  const fire = (type: string, event: unknown) => { for (const fn of listeners.get(type) ?? []) fn(event); };
  return { view: view as unknown as Window & typeof globalThis, posted, logged, fire, listeners };
}

describe('installCanvasPreviewReporter', () => {
  /**
   * The unframed page is the overwhelmingly common one. Costing it a patched console and
   * two listeners for a parent that will never exist is the reason this guard is first.
   */
  it('does nothing at all on a page that is not framed', () => {
    const { view, posted, listeners } = fakeWindow(false);
    const original = view.console.log;
    const detach = installCanvasPreviewReporter({ target: view });
    expect(view.console.log).toBe(original);
    expect(listeners.size).toBe(0);
    expect(posted).toEqual([]);
    detach();
  });

  it('posts console output to the framing document and still logs it', () => {
    const { view, posted, logged } = fakeWindow(true);
    installCanvasPreviewReporter({ target: view });
    view.console.error('boom', { code: 500 });
    expect(posted).toEqual([expect.objectContaining({
      tag: CANVAS_PREVIEW_MESSAGE, level: 'error', text: 'boom {"code":500}',
    })]);
    // Patching a console that then swallows the line would be worse than not patching it.
    expect(logged).toEqual(['error boom [object Object]']);
  });

  /** A script or stylesheet that 404s fires on the element and never reaches `window`
   *  by bubbling — the single most common way a preview is silently broken. */
  it('reports a subresource that failed to load, not just a thrown error', () => {
    const { view, posted, fire } = fakeWindow(true);
    installCanvasPreviewReporter({ target: view });
    fire('error', { target: { src: 'https://example.test/app.js' } });
    fire('error', { target: view, message: 'x is not a function' });
    expect(posted.map((m) => (m as { text: string }).text)).toEqual([
      'failed to load https://example.test/app.js',
      'x is not a function',
    ]);
  });

  it('reports a call the page made and the status it came back with', async () => {
    const { view, posted } = fakeWindow(true);
    (view.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 503 });
    installCanvasPreviewReporter({ target: view });
    await view.fetch('/api/orders', { method: 'post' });
    expect(posted.map((m) => (m as { level: string; text: string }))).toEqual([
      { tag: CANVAS_PREVIEW_MESSAGE, level: 'request', text: 'POST /api/orders', at: expect.any(Number) },
      { tag: CANVAS_PREVIEW_MESSAGE, level: 'error', text: 'POST /api/orders — 503', at: expect.any(Number) },
    ]);
  });

  it('restores the console and the listeners it took over', () => {
    const { view, listeners } = fakeWindow(true);
    const original = view.console.warn;
    const nativeFetch = view.fetch;
    const detach = installCanvasPreviewReporter({ target: view });
    expect(view.console.warn).not.toBe(original);
    detach();
    expect(view.console.warn).toBe(original);
    expect(view.fetch).toBe(nativeFetch);
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  /**
   * The tag is a literal in two repos-worth of code that cannot import each other: this
   * package is published standalone, and the canvas reader lives in the frontend. A
   * mismatch is silent — the preview simply never hears anything — so it is guarded.
   */
  it('uses the same tag the canvas reader matches on', () => {
    const reader = readFileSync(
      new URL('../../frontend/src/lib/canvasPreviewReport.ts', import.meta.url),
      'utf-8',
    );
    expect(reader).toContain(`export const CANVAS_PREVIEW_MESSAGE = '${CANVAS_PREVIEW_MESSAGE}'`);
  });
});
