import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiRequest }));

import { generateCanvasImage, resolveCanvasImage } from './canvasImageAssets';

describe('canvasImageAssets', () => {
  beforeEach(() => apiRequest.mockReset());

  it('returns the first stock result for find intent', async () => {
    apiRequest.mockResolvedValueOnce({ results: [{ provider: 'pexels', providerAssetId: '1', url: 'https://img/full.jpg', thumbnailUrl: 'https://img/thumb.jpg', licence: 'Pexels' }] });

    await expect(resolveCanvasImage('design team', 'find')).resolves.toMatchObject({ source: 'stock', provider: 'pexels', url: 'https://img/full.jpg' });
    expect(apiRequest).toHaveBeenCalledWith('/api/creative/images/search?q=design%20team&limit=12');
  });

  it('uses the image gateway for explicit create intent', async () => {
    apiRequest.mockResolvedValueOnce({ data: [{ url: 'https://generated/image.png' }], _builderforce: { resolvedModel: 'flux', resolvedVendor: 'together' } });

    await expect(generateCanvasImage('a glass city')).resolves.toMatchObject({ source: 'ai', model: 'flux', provider: 'together' });
    expect(apiRequest).toHaveBeenCalledWith('/llm/v1/images/generations', expect.objectContaining({ method: 'POST' }));
  });

  it('falls through to generation when automatic stock search is unavailable', async () => {
    apiRequest.mockRejectedValueOnce(new Error('not configured')).mockResolvedValueOnce({ data: [{ b64_json: 'abc' }], model: 'fallback' });

    await expect(resolveCanvasImage('an origami fox', 'auto')).resolves.toMatchObject({ source: 'ai', url: 'data:image/png;base64,abc' });
  });
});
