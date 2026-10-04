import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/reportError', () => ({ reportBackgroundFailure: vi.fn(async () => true) }));

import type { ProjectMediaItem } from '@/lib/projectMediaApi';
import { generateReviewedMedia, MAX_MEDIA_ATTEMPTS } from './reviewedMediaGeneration';
import type { MediaReviewDecision } from './mediaRequest';
import type { MediaStudioPort } from './useMediaStudio';

function item(id: string, prompt: string): ProjectMediaItem {
  return {
    id, kind: 'image', status: 'ready', prompt, url: `https://x/${id}.png`, storageKey: null, mimeType: null,
    width: 1792, height: 1024, durationSeconds: null, model: 'flux', jobId: null, error: null, usedAt: null,
    createdAt: '2026-10-04T20:00:00.000Z',
  };
}

function port(decisions: MediaReviewDecision[]): MediaStudioPort & { generate: ReturnType<typeof vi.fn>; markUsed: ReturnType<typeof vi.fn> } {
  let n = 0;
  return {
    generate: vi.fn(async (request: { prompt: string }) => item(`i${++n}`, request.prompt)),
    review: vi.fn(async () => decisions.shift() ?? { action: 'discard' }),
    markUsed: vi.fn(async () => {}),
  };
}

const REQUEST = { kind: 'image' as const, prompt: 'a bakery hero', shape: 'landscape' as const };

describe('generateReviewedMedia', () => {
  it('returns the item only after the person chooses "use", and marks it used', async () => {
    const media = port([{ action: 'use' }]);
    const result = await generateReviewedMedia(media, REQUEST);
    expect(result).toEqual({ ok: true, item: expect.objectContaining({ id: 'i1', url: 'https://x/i1.png' }) });
    expect(media.markUsed).toHaveBeenCalledWith('i1');
  });

  it('regenerates with the edited prompt on "try again"', async () => {
    const media = port([{ action: 'retry', prompt: 'a bakery hero at dusk' }, { action: 'use' }]);
    const result = await generateReviewedMedia(media, REQUEST);
    expect(media.generate).toHaveBeenNthCalledWith(2, { ...REQUEST, prompt: 'a bakery hero at dusk' });
    expect(result).toMatchObject({ ok: true, item: { id: 'i2' } });
  });

  it('declines on "discard" without marking anything used', async () => {
    const media = port([{ action: 'discard' }]);
    const result = await generateReviewedMedia(media, REQUEST);
    expect(result).toMatchObject({ ok: false, declined: true });
    expect(media.markUsed).not.toHaveBeenCalled();
  });

  it('hands the question back after the last attempt', async () => {
    const media = port(Array.from({ length: MAX_MEDIA_ATTEMPTS }, () => ({ action: 'retry' as const, prompt: '' })));
    const result = await generateReviewedMedia(media, REQUEST);
    expect(media.generate).toHaveBeenCalledTimes(MAX_MEDIA_ATTEMPTS);
    expect(result).toMatchObject({ ok: false, declined: true });
  });

  it("relays the gateway's refusal as the tool error", async () => {
    const media = port([]);
    media.generate.mockRejectedValueOnce(new Error('Daily image credits exhausted'));
    expect(await generateReviewedMedia(media, REQUEST)).toEqual({ ok: false, error: 'Daily image credits exhausted' });
  });
});
