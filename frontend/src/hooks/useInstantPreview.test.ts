import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

/** The boot double: a plain swappable function, so a rejection is only ever created on call. */
let boot: () => Promise<unknown> = async () => undefined;
vi.mock('@/lib/browserRuntime/previewRuntime', () => ({ bootSharedPreviewRuntime: () => boot() }));
const bootsTo = (...runtimes: unknown[]) => {
  boot = async () => runtimes.length > 1 ? runtimes.shift() : runtimes[0];
};

import { useInstantPreview } from './useInstantPreview';

/** A runtime double with just the surface the hook touches. */
function fakeRuntime(profile: { supported: boolean; reason?: string }) {
  const files = new Map<string, string>();
  return {
    files,
    url: 'https://preview.builderforce.ai/__bfwc/abc/',
    fs: {
      rm: vi.fn(() => files.clear()),
      writeFile: vi.fn((path: string, contents: string) => files.set(path, contents)),
    },
    mount: vi.fn((flat: Record<string, string>) => { for (const [p, c] of Object.entries(flat)) files.set(p, c); }),
    profile: () => profile,
  };
}

describe('useInstantPreview', () => {

  it('serves a supported project and takes over live edits', async () => {
    const runtime = fakeRuntime({ supported: true });
    bootsTo(runtime);
    const { result } = renderHook(() => useInstantPreview());

    expect(await result.current.start({ 'index.html': '<div></div>' })).toEqual({ kind: 'ready', url: runtime.url });
    expect(result.current.write('src/App.tsx', 'x')).toBe(true);
    expect(runtime.fs.writeFile).toHaveBeenCalledWith('src/App.tsx', 'x');
  });

  it('clears the previous run before mounting, so deleted files do not linger', async () => {
    const runtime = fakeRuntime({ supported: true });
    runtime.files.set('/old.ts', 'stale');
    bootsTo(runtime);
    const { result } = renderHook(() => useInstantPreview());

    await result.current.start({ 'index.html': '' });
    expect([...runtime.files.keys()]).toEqual(['index.html']);
  });

  it('declines an unsupported project with the runtime reason, leaving edits to the WebContainer', async () => {
    bootsTo(fakeRuntime({ supported: false, reason: 'Next.js needs a Node server.' }));
    const { result } = renderHook(() => useInstantPreview());

    expect(await result.current.start({})).toEqual({ kind: 'declined', reason: 'Next.js needs a Node server.' });
    expect(result.current.write('a.ts', 'x')).toBe(false);
  });

  it('declines, rather than throws, when the runtime cannot boot', async () => {
    boot = async () => { throw new Error('The preview relay did not start.'); };
    const { result } = renderHook(() => useInstantPreview());

    expect(await result.current.start({})).toEqual({ kind: 'declined', reason: 'The preview relay did not start.' });
  });

  it('stops taking edits once a later run falls back', async () => {
    bootsTo(fakeRuntime({ supported: true }), fakeRuntime({ supported: false, reason: 'no' }));
    const { result } = renderHook(() => useInstantPreview());
    await result.current.start({});
    await result.current.start({});
    expect(result.current.write('a.ts', 'x')).toBe(false);
  });
});
