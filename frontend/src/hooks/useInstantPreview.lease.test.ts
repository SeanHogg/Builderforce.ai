import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const files = new Map<string, string>();
vi.mock('@seanhogg/builderforce-webcontainers', () => ({
  startPreviewRuntime: async () => ({
    url: 'https://preview.builderforce.ai/__bfwc/abc/',
    fs: {
      list: () => [...files.keys()],
      rm: (p: string) => files.delete(p),
      writeFile: vi.fn((p: string, c: string) => files.set(p, c)),
    },
    writeTree: (flat: Record<string, string>) => { for (const [p, c] of Object.entries(flat)) files.set(`/${p}`, c); },
    profile: () => ({ supported: true }),
    onError: () => () => undefined,
    onPreviewConsole: () => () => undefined,
    listProcesses: () => [],
  }),
}));

const { useInstantPreview } = await import('./useInstantPreview');
const { bootSharedPreviewRuntime } = await import('@/lib/browserRuntime/previewRuntime');

describe('useInstantPreview and the runtime lease', () => {
  it('stops writing once a browser run takes the runtime', async () => {
    const { result } = renderHook(() => useInstantPreview());
    await act(async () => { await result.current.start({ 'index.html': '<p/>' }); });
    expect(result.current.write('index.html', '<p>1</p>')).toBe(true);
    await act(async () => { await bootSharedPreviewRuntime({ id: 'run-target' }); });
    expect(result.current.write('index.html', '<p>2</p>')).toBe(false);
    expect(files.get('index.html')).toBe('<p>1</p>');
  });
});
