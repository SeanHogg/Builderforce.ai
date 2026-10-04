import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { generateVideoClip as GenerateVideoClip } from '@/lib/videoGenerationApi';
import { generateVideoAssetAction } from './generateVideoAssetAction';

const generateVideoClip = vi.fn<typeof GenerateVideoClip>();
const action = generateVideoAssetAction(generateVideoClip);

beforeEach(() => { generateVideoClip.mockReset(); });

const SOURCE = {
  id: 'job-1', kind: 'video' as const, captureKind: 'ai' as const, url: 'https://api/api/assets/1/v/clip.mp4',
  fileName: 'clip.mp4', mimeType: 'video/mp4', durationSeconds: 5, storageKey: '1/v/clip.mp4',
};

describe('generate_video_asset', () => {
  it('returns the durable MP4 URL the gateway produced', async () => {
    generateVideoClip.mockResolvedValue({ job: { id: 'job-1', kind: 'clip', status: 'succeeded', result: { url: SOURCE.url, storageKey: SOURCE.storageKey, mimeType: 'video/mp4', durationSeconds: 5, model: 'pollinations/wan-2.2-fast' } }, source: SOURCE });
    const result = await action.run({ prompt: 'steam rising off fresh bread', aspectRatio: '9:16' });
    expect(generateVideoClip).toHaveBeenCalledWith({ prompt: 'steam rising off fresh bread', durationSeconds: 5, aspectRatio: '9:16', useCase: 'studio_video_asset' });
    expect(result).toMatchObject({ url: SOURCE.url, mimeType: 'video/mp4', durationSeconds: 5, model: 'pollinations/wan-2.2-fast' });
  });

  it('snaps an odd length to a supported one and drops an unknown aspect', async () => {
    generateVideoClip.mockResolvedValue({ job: { id: 'j', kind: 'clip', status: 'succeeded' }, source: SOURCE });
    await action.run({ prompt: 'p', durationSeconds: 7, aspectRatio: '4:3' });
    const call = generateVideoClip.mock.calls[0]![0];
    expect([4, 5, 6, 8, 10]).toContain(call.durationSeconds);
    expect(call).not.toHaveProperty('aspectRatio');
  });

  it('refuses an empty prompt without calling the gateway', async () => {
    expect(await action.run({ prompt: '  ' })).toEqual({ error: expect.any(String) });
    expect(generateVideoClip).not.toHaveBeenCalled();
  });

  it('relays the gateway refusal as a tool error', async () => {
    generateVideoClip.mockImplementation(async () => { throw new Error('Daily video generation limit reached'); });
    expect(await action.run({ prompt: 'p' })).toEqual({ error: 'Daily video generation limit reached' });
  });
});
