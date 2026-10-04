import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaStudioPort } from './media/useMediaStudio';
import { generateVideoAssetAction } from './generateVideoAssetAction';

const media = {
  generate: vi.fn<MediaStudioPort['generate']>(),
  review: vi.fn<MediaStudioPort['review']>(),
  markUsed: vi.fn<MediaStudioPort['markUsed']>(),
};
const action = generateVideoAssetAction(media);

const ITEM = {
  id: 'v1', kind: 'video' as const, status: 'ready' as const, prompt: 'steam rising off fresh bread',
  url: 'https://api/api/assets/1/v/clip.mp4', storageKey: '1/v/clip.mp4', mimeType: 'video/mp4', width: null, height: null,
  durationSeconds: 5, model: 'pollinations/wan-2.2-fast', jobId: null, error: null, usedAt: null, createdAt: '2026-10-04T20:00:00.000Z',
};

beforeEach(() => {
  media.generate.mockReset().mockResolvedValue(ITEM);
  media.review.mockReset().mockResolvedValue({ action: 'use' });
  media.markUsed.mockReset().mockResolvedValue(undefined);
});

describe('generate_video_asset', () => {
  it('returns the durable MP4 URL once the person chose the clip', async () => {
    const result = await action.run({ prompt: 'steam rising off fresh bread', aspectRatio: '9:16' });
    expect(media.generate).toHaveBeenCalledWith({ kind: 'video', prompt: 'steam rising off fresh bread', shape: 'portrait', durationSeconds: 5 });
    expect(result).toMatchObject({ url: ITEM.url, mimeType: 'video/mp4', durationSeconds: 5, model: 'pollinations/wan-2.2-fast' });
  });

  it('snaps an odd length to a supported one and defaults an unknown aspect to landscape', async () => {
    await action.run({ prompt: 'p', durationSeconds: 7, aspectRatio: '4:3' });
    const request = media.generate.mock.calls[0]![0];
    expect(request).toMatchObject({ kind: 'video', shape: 'landscape' });
    expect([4, 5, 6, 8, 10]).toContain((request as { durationSeconds: number }).durationSeconds);
  });

  it('tells the model the person discarded it, with no URL', async () => {
    media.review.mockResolvedValue({ action: 'discard' });
    expect(await action.run({ prompt: 'p' })).toMatchObject({ declined: true });
  });

  it('refuses an empty prompt without generating', async () => {
    expect(await action.run({ prompt: '  ' })).toEqual({ error: expect.any(String) });
    expect(media.generate).not.toHaveBeenCalled();
  });

  it('relays the gateway refusal as a tool error', async () => {
    media.generate.mockRejectedValue(new Error('Daily video generation limit reached'));
    expect(await action.run({ prompt: 'p' })).toEqual({ error: 'Daily video generation limit reached' });
  });
});
