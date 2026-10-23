import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEBGPU_ADAPTER_TIMEOUT_MS, webGpuSupport } from './webgpu';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('webGpuSupport', () => {
  it('reads a hung adapter request as no WebGPU after the bound, with the reason reported', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hung = { requestAdapter: () => new Promise<never>(() => undefined) };
    const pending = webGpuSupport(hung);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(WEBGPU_ADAPTER_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ supported: false, reason: 'adapter_timeout' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not settle'));
  });

  it('reads an adapter that answers in time', async () => {
    const gpu = {
      requestAdapter: async () => ({ features: { has: (name: string) => name === 'shader-f16' }, limits: { maxBufferSize: 64, maxStorageBufferBindingSize: 32 } }),
    };
    await expect(webGpuSupport(gpu)).resolves.toMatchObject({ supported: true, f16: true, maxBufferSizeBytes: 64, maxStorageBufferBindingSizeBytes: 32 });
  });

  it('no adapter and no WebGPU read as unsupported', async () => {
    await expect(webGpuSupport({ requestAdapter: async () => null })).resolves.toMatchObject({ supported: false, reason: 'no_adapter' });
    await expect(webGpuSupport(undefined)).resolves.toMatchObject({ supported: false, reason: 'webgpu_missing' });
  });
});
