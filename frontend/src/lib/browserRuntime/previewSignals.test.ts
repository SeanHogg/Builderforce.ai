import { describe, expect, it, vi } from 'vitest';
import type { PreviewConsoleMessage, PreviewError } from '@seanhogg/builderforce-webcontainers';
import type { PreviewSignalSource } from './previewSignals';

const BASE = 'https://preview.builderforce.ai/__bfwc/abc/';

/** Just the listener surface: the test plays the preview by calling `emitError` / `emitConsole`. */
function fakeRuntime() {
  const errors = new Set<(error: PreviewError) => void>();
  const consoles = new Set<(message: PreviewConsoleMessage) => void>();
  const runtime: PreviewSignalSource = {
    url: BASE,
    onError: (listener) => { errors.add(listener); return () => { errors.delete(listener); }; },
    onPreviewConsole: (listener) => { consoles.add(listener); return () => { consoles.delete(listener); }; },
  };
  return {
    runtime,
    emitError: (error: PreviewError) => errors.forEach((listener) => listener(error)),
    emitConsole: (message: PreviewConsoleMessage) => consoles.forEach((listener) => listener(message)),
    listeners: () => errors.size + consoles.size,
  };
}

/**
 * A fresh module graph per test: the "current workspace" is module state. The stores are
 * imported from the SAME fresh graph, so the test reads what the module under test wrote.
 */
async function load() {
  vi.resetModules();
  const stores = { diagnostics: await import('@/lib/buildDiagnostics'), console: await import('@/lib/previewConsole') };
  const signals = await import('./previewSignals');
  return { ...signals, stores };
}

const WS = 9101;
const NEXT = 9102;

describe('previewSignals', () => {
  it('drops what the preview reports before any run has claimed it', async () => {
    const { attachPreviewSignals, previewWorkspace, stores } = await load();
    const fake = fakeRuntime();
    attachPreviewSignals(fake.runtime);
    fake.emitConsole({ level: 'log', text: 'orphan', href: BASE });
    expect(previewWorkspace()).toBeNull();
    expect(stores.console.readConsoleEntries(WS)).toEqual([]);
  });

  it('routes errors into the failure store and console output into the console store', async () => {
    const { attachPreviewSignals, setPreviewWorkspace, stores } = await load();
    const fake = fakeRuntime();
    attachPreviewSignals(fake.runtime);
    setPreviewWorkspace(WS);

    fake.emitError({ message: 'x is not a function', stack: 'TypeError: x is not a function\n  at App', href: `${BASE}about` });
    fake.emitConsole({ level: 'warn', text: 'Each child needs a key', href: BASE });

    expect(stores.diagnostics.readBuildFailures(WS)).toEqual([expect.objectContaining({
      source: 'runtime',
      message: 'x is not a function',
      detail: 'TypeError: x is not a function\n  at App',
      at: 'page /about',
    })]);
    expect(stores.console.readConsoleEntries(WS).map((entry) => [entry.level, entry.text])).toEqual([['warn', 'Each child needs a key']]);
  });

  it('starts each run clean and sends later output to the new workspace', async () => {
    const { attachPreviewSignals, setPreviewWorkspace, stores } = await load();
    const fake = fakeRuntime();
    attachPreviewSignals(fake.runtime);
    setPreviewWorkspace(WS);
    stores.diagnostics.recordBuildFailure(WS, { source: 'build', message: 'old failure' });
    stores.console.recordConsoleMessage(WS, { level: 'log', text: 'old line' });

    setPreviewWorkspace(WS);
    expect(stores.console.readConsoleEntries(WS)).toEqual([]);
    expect(stores.diagnostics.readBuildFailures(WS)).toEqual([]);

    setPreviewWorkspace(NEXT);
    fake.emitConsole({ level: 'info', text: 'new run', href: BASE });
    expect(stores.console.readConsoleEntries(NEXT).map((entry) => entry.text)).toEqual(['new run']);
    expect(stores.console.readConsoleEntries(WS)).toEqual([]);
  });

  it('attaches once per runtime, and detaches', async () => {
    const { attachPreviewSignals, setPreviewWorkspace, stores } = await load();
    const fake = fakeRuntime();
    const detach = attachPreviewSignals(fake.runtime);
    attachPreviewSignals(fake.runtime);
    expect(fake.listeners()).toBe(2);
    setPreviewWorkspace(WS);
    fake.emitConsole({ level: 'log', text: 'once', href: BASE });
    expect(stores.console.readConsoleEntries(WS)[0]!.count).toBe(1);
    detach();
    expect(fake.listeners()).toBe(0);
  });
});
