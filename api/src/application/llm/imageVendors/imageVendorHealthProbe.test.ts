import { describe, expect, it, vi, afterEach } from 'vitest';
import { VendorRetryableError } from './types';
import * as registry from './registry';
import {
  IMAGE_PROBE_VENDOR_IDS,
  imageProbeVendorLabel,
  probeAllImageVendors,
  probeImageVendor,
} from './imageVendorHealthProbe';
import type { ImageVendorModule } from './types';

afterEach(() => vi.restoreAllMocks());

function fakeModule(over: Partial<ImageVendorModule>): ImageVendorModule {
  return {
    id: 'together',
    catalog: [{ id: 'model-a', label: 'A', brand: 'X', tier: 'FREE' }],
    tierFor: () => 'FREE',
    apiKeyFrom: () => 'k',
    generate: async () => ({ created: 1, model: 'model-a', data: [{ url: 'https://img/x.png' }] }),
    ...over,
  };
}

describe('imageProbeVendorLabel', () => {
  it('namespaces image vendor health rows so they never collide with chat vendors', () => {
    expect(imageProbeVendorLabel('together')).toBe('image:together');
    expect(imageProbeVendorLabel('fluxapi')).toBe('image:fluxapi');
  });
});

describe('probeImageVendor', () => {
  it('reports "unconfigured" when the vendor key is unbound', async () => {
    vi.spyOn(registry, 'getImageModule').mockReturnValue(fakeModule({ apiKeyFrom: () => null }));
    const r = await probeImageVendor({}, 'together');
    expect(r.status).toBe('unconfigured');
    expect(r.vendor).toBe('image:together');
    expect(r.probedCount).toBe(0);
  });

  it('reports "ok" when every catalog model returns a usable image', async () => {
    vi.spyOn(registry, 'getImageModule').mockReturnValue(fakeModule({
      catalog: [
        { id: 'm1', label: 'M1', brand: 'X', tier: 'FREE' },
        { id: 'm2', label: 'M2', brand: 'X', tier: 'FREE' },
      ],
    }));
    const r = await probeImageVendor({ TOGETHER_API_KEY: 'k' }, 'together');
    expect(r.status).toBe('ok');
    expect(r.okCount).toBe(2);
    expect(r.failedCount).toBe(0);
  });

  it('reports "down" when every model throws a retryable error', async () => {
    vi.spyOn(registry, 'getImageModule').mockReturnValue(fakeModule({
      generate: async () => { throw new VendorRetryableError('together', 'm1', 503, 'outage'); },
    }));
    const r = await probeImageVendor({ TOGETHER_API_KEY: 'k' }, 'together');
    expect(r.status).toBe('down');
    expect(r.okCount).toBe(0);
    expect(r.models[0]?.status).toBe(503);
  });

  it('reports "degraded" on a mixed catalog and flags a no-image-but-200 as failed', async () => {
    let n = 0;
    vi.spyOn(registry, 'getImageModule').mockReturnValue(fakeModule({
      catalog: [
        { id: 'm1', label: 'M1', brand: 'X', tier: 'FREE' },
        { id: 'm2', label: 'M2', brand: 'X', tier: 'FREE' },
      ],
      generate: async () => {
        n += 1;
        // First model: usable image. Second: 200 with no image -> failed.
        return n === 1
          ? { created: 1, model: 'm1', data: [{ url: 'https://img/x.png' }] }
          : { created: 1, model: 'm2', data: [] };
      },
    }));
    const r = await probeImageVendor({ TOGETHER_API_KEY: 'k' }, 'together');
    expect(r.status).toBe('degraded');
    expect(r.okCount).toBe(1);
    expect(r.failedCount).toBe(1);
  });
});

describe('probeAllImageVendors', () => {
  it('probes the default image vendor set', async () => {
    vi.spyOn(registry, 'getImageModule').mockReturnValue(fakeModule({ apiKeyFrom: () => null }));
    const rows = await probeAllImageVendors({});
    expect(rows.map((r) => r.vendor)).toEqual(IMAGE_PROBE_VENDOR_IDS.map(imageProbeVendorLabel));
  });
});
