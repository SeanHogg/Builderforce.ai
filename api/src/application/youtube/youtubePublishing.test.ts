import { describe, expect, it, vi } from 'vitest';
import { publishCanvasVideoToYouTube } from './youtubePublishing';

describe('YouTube publishing boundary', () => {
  it('rejects an R2 key outside the authenticated tenant before any provider call', async () => {
    const get = vi.fn();
    await expect(publishCanvasVideoToYouTube({} as never, { UPLOADS: { get } } as never, 12, 'user-1', {
      connectionId: 1, storageKey: '99/user/video.webm', title: 'Demo', description: '', privacyStatus: 'unlisted', mimeType: 'video/webm',
    })).rejects.toThrow('Video artifact not found.');
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects a missing tenant-owned artifact before loading credentials', async () => {
    const get = vi.fn().mockResolvedValue(null);
    await expect(publishCanvasVideoToYouTube({} as never, { UPLOADS: { get } } as never, 12, 'user-1', {
      connectionId: 1, storageKey: '12/user/video.webm', title: 'Demo', description: '', privacyStatus: 'private', mimeType: 'video/webm',
    })).rejects.toThrow('Video artifact not found.');
    expect(get).toHaveBeenCalledWith('12/user/video.webm');
  });
});
