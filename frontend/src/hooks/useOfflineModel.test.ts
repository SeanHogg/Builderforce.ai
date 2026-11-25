import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const studio = vi.hoisted(() => ({
  getModelOfflineStatus: vi.fn(),
  prepareModelOffline: vi.fn(),
}));
const auth = vi.hoisted(() => ({ token: 'tok' as string | null }));

vi.mock('@/lib/studioLoader', () => ({ loadStudio: async () => studio }));
vi.mock('@/lib/auth', () => ({ getStoredTenantToken: () => auth.token }));
vi.mock('@/lib/apiClient', () => ({ getApiBaseUrl: () => 'https://api.test' }));
vi.mock('@/lib/canvasHost', () => ({ canvasWasmBaseUrl: () => null }));

import { useOfflineModel } from './useOfflineModel';

describe('useOfflineModel', () => {
  beforeEach(() => {
    auth.token = 'tok';
    studio.getModelOfflineStatus.mockReset().mockResolvedValue({ available: false, sizeBytes: null });
    studio.prepareModelOffline.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(1))));
  });

  it('starts idle when the model is not stored, and available when it is', async () => {
    const idle = renderHook(() => useOfflineModel('lcm-tiny-sd'));
    await waitFor(() => expect(idle.result.current.state).toBe('idle'));

    studio.getModelOfflineStatus.mockResolvedValue({ available: true, sizeBytes: 123 });
    const ready = renderHook(() => useOfflineModel('lcm-tiny-sd'));
    await waitFor(() => expect(ready.result.current.state).toBe('available'));
    expect(ready.result.current.sizeBytes).toBe(123);
  });

  it('downloads with the stored token, reports progress, then becomes available', async () => {
    studio.prepareModelOffline.mockImplementation(async (opts: { onProgress: (p: unknown) => void }) => {
      opts.onProgress({ loadedBytes: 50, totalBytes: 100, file: 'f', fileIndex: 1, fileCount: 2 });
      studio.getModelOfflineStatus.mockResolvedValue({ available: true, sizeBytes: 100 });
    });
    const { result } = renderHook(() => useOfflineModel('lcm-tiny-sd'));
    await waitFor(() => expect(result.current.state).toBe('idle'));
    await act(async () => { await result.current.start(); });

    expect(studio.prepareModelOffline).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'lcm-tiny-sd', authToken: 'tok', baseUrl: 'https://api.test' }),
    );
    expect(result.current.state).toBe('available');
    expect(result.current.sizeBytes).toBe(100);
  });

  it('surfaces a failure as an error state that can be retried', async () => {
    studio.prepareModelOffline.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useOfflineModel('lcm-tiny-sd'));
    await waitFor(() => expect(result.current.state).toBe('idle'));
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('boom');
  });

  it('returns to idle (no error) when cancelled', async () => {
    studio.prepareModelOffline.mockImplementation((opts: { signal: AbortSignal }) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')));
    }));
    const { result } = renderHook(() => useOfflineModel('lcm-tiny-sd'));
    await waitFor(() => expect(result.current.state).toBe('idle'));
    let run!: Promise<void>;
    act(() => { run = result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe('downloading'));
    await act(async () => { result.current.cancel(); await run; });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('does not download when signed out', async () => {
    auth.token = null;
    const { result } = renderHook(() => useOfflineModel('lcm-tiny-sd'));
    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(result.current.signedIn).toBe(false);
    await act(async () => { await result.current.start(); });
    expect(studio.prepareModelOffline).not.toHaveBeenCalled();
  });
});
