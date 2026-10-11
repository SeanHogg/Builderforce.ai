import { describe, expect, it, vi } from 'vitest';
import { publishCanvasVideoToYouTube } from './youtubeCanvasPublish';

describe('YouTube publishing boundary', () => {
  it('rejects an R2 key outside the authenticated tenant before any provider call', async () => {
    const head = vi.fn();
    await expect(publishCanvasVideoToYouTube({} as never, { UPLOADS: { head } } as never, 12, 'user-1', {
      connectionId: 1, storageKey: '99/user/video.webm', title: 'Demo', description: '', privacyStatus: 'unlisted', mimeType: 'video/webm',
    })).rejects.toThrow('Video artifact not found.');
    expect(head).not.toHaveBeenCalled();
  });

  it('rejects a missing tenant-owned artifact before a job is queued', async () => {
    const head = vi.fn().mockResolvedValue(null);
    const insert = vi.fn();
    await expect(publishCanvasVideoToYouTube({ insert } as never, { UPLOADS: { head } } as never, 12, 'user-1', {
      connectionId: 1, storageKey: '12/user/video.webm', title: 'Demo', description: '', privacyStatus: 'private', mimeType: 'video/webm',
    })).rejects.toThrow('Video artifact not found.');
    expect(head).toHaveBeenCalledWith('12/user/video.webm');
    expect(insert).not.toHaveBeenCalled();
  });
});
