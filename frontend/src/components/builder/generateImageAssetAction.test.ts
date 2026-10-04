import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaStudioPort } from './media/useMediaStudio';
import { generateImageAssetAction } from './generateImageAssetAction';

const media = {
  generate: vi.fn<MediaStudioPort['generate']>(),
  review: vi.fn<MediaStudioPort['review']>(),
  markUsed: vi.fn<MediaStudioPort['markUsed']>(),
};
const action = generateImageAssetAction(media);

const ITEM = {
  id: 'm1', kind: 'image' as const, status: 'ready' as const, prompt: 'a warm bakery storefront at dawn',
  url: 'https://api/api/assets/1/u/x.jpg', storageKey: null, mimeType: null, width: 1792, height: 1024,
  durationSeconds: null, model: 'cloudflare/flux', jobId: null, error: null, usedAt: null, createdAt: '2026-10-04T20:00:00.000Z',
};

// Braces matter: a function RETURNED from beforeEach is run as a teardown.
beforeEach(() => {
  media.generate.mockReset().mockResolvedValue(ITEM);
  media.review.mockReset().mockResolvedValue({ action: 'use' });
  media.markUsed.mockReset().mockResolvedValue(undefined);
});

describe('generate_image_asset', () => {
  it('returns the URL only once the person chose to use the image', async () => {
    const result = await action.run({ prompt: 'a warm bakery storefront at dawn', size: '1792x1024' });
    expect(media.generate).toHaveBeenCalledWith({ kind: 'image', prompt: 'a warm bakery storefront at dawn', shape: 'landscape' });
    expect(media.review).toHaveBeenCalledWith(ITEM);
    expect(result).toMatchObject({ url: ITEM.url, model: 'cloudflare/flux' });
  });

  it('treats an unsupported size as square', async () => {
    await action.run({ prompt: 'p', size: '640x480' });
    expect(media.generate).toHaveBeenCalledWith(expect.objectContaining({ shape: 'square' }));
  });

  it('tells the model the person discarded it, with no URL', async () => {
    media.review.mockResolvedValue({ action: 'discard' });
    const result = await action.run({ prompt: 'p' });
    expect(result).toMatchObject({ declined: true });
    expect(result).not.toHaveProperty('url');
  });

  it('refuses an empty prompt without generating', async () => {
    expect(await action.run({ prompt: '  ' })).toEqual({ error: expect.any(String) });
    expect(media.generate).not.toHaveBeenCalled();
  });

  it('relays the gateway refusal as a tool error', async () => {
    media.generate.mockRejectedValue(new Error('Daily image credits exhausted'));
    expect(await action.run({ prompt: 'p' })).toEqual({ error: 'Daily image credits exhausted' });
  });
});
