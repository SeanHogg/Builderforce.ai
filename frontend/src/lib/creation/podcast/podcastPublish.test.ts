import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn());
const isGuestSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/apiClient', () => ({ apiRequest }));
vi.mock('@/lib/auth', () => ({ AUTH_API_URL: 'https://api.test' }));
vi.mock('../exportArtifact', () => ({ isGuestSession }));

import { publishUrl, withPublishedEnclosure } from './podcastPublish';

const source = (id: string, storageKey?: string) => ({
  id, kind: 'audio', captureKind: 'import', url: `blob:${id}`, fileName: `${id}.mp3`, mimeType: 'audio/mpeg', durationSeconds: 10,
  ...(storageKey ? { storageKey } : {}),
});
const timeline = (ids: string[]) => ({
  version: 1, width: 1280, height: 720, fps: 30, backgroundColor: '#000000',
  clips: ids.map((sourceId, index) => ({ id: `c${index}`, sourceId, track: 'voiceover', startSeconds: index * 10, durationSeconds: 10, trimStartSeconds: 0, volume: 1, label: sourceId })),
});
const podcast = (ids: string[], keys: Record<string, string | undefined>) => ({
  podcastTimeline: timeline(ids),
  podcastSources: ids.map((id) => source(id, keys[id])),
});

beforeEach(() => { apiRequest.mockReset(); isGuestSession.mockReset(); isGuestSession.mockReturnValue(false); });

describe('publishUrl', () => {
  it('asks for a publish signature and builds the public URL', async () => {
    apiRequest.mockResolvedValue({ exp: 1900000000, sig: 'a+b/c=' });
    await expect(publishUrl('t/1/ep.mp3')).resolves.toBe('https://api.test/api/brain-files/t/1/ep.mp3?exp=1900000000&sig=a%2Bb%2Fc%3D');
    expect(apiRequest).toHaveBeenCalledWith('/api/brain/uploads/sign', { method: 'POST', body: JSON.stringify({ key: 't/1/ep.mp3', purpose: 'publish' }) });
  });
});

describe('withPublishedEnclosure', () => {
  it('swaps the lone hosted segment URL for a publish URL', async () => {
    apiRequest.mockResolvedValue({ exp: 5, sig: 's' });
    const data = podcast(['a'], { a: 'k/a.mp3' });
    const published = await withPublishedEnclosure(data) as typeof data;
    expect(published.podcastSources[0]!.url).toBe('https://api.test/api/brain-files/k/a.mp3?exp=5&sig=s');
    expect(data.podcastSources[0]!.url).toBe('blob:a');
  });

  it('returns the object untouched for an external master URL, a guest, several segments, or no stored file', async () => {
    const hosted = podcast(['a'], { a: 'k/a.mp3' });
    const external = { ...hosted, podcastEpisode: { audioUrl: 'https://cdn.example/ep.mp3' } };
    expect(await withPublishedEnclosure(external)).toBe(external);
    isGuestSession.mockReturnValue(true);
    expect(await withPublishedEnclosure(hosted)).toBe(hosted);
    isGuestSession.mockReturnValue(false);
    const two = podcast(['a', 'b'], { a: 'k/a', b: 'k/b' });
    expect(await withPublishedEnclosure(two)).toBe(two);
    const unstored = podcast(['a'], {});
    expect(await withPublishedEnclosure(unstored)).toBe(unstored);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('falls back to the object when signing is refused', async () => {
    apiRequest.mockRejectedValue(new Error('403'));
    const data = podcast(['a'], { a: 'k/a.mp3' });
    expect(await withPublishedEnclosure(data)).toBe(data);
  });
});
