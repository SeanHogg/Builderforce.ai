import { describe, expect, it } from 'vitest';
import { buildMovieRenderRequest } from './movieRenderRequest';

const origin = 'https://api.example.com';
const timeline = {
  version: 1, fps: 30, width: 1280, height: 720, backgroundColor: '#101010',
  clips: [
    { id: 'c1', sourceId: 's1', track: 'visual', startSeconds: 0, durationSeconds: 5, trimStartSeconds: 0, volume: 1, label: 'Shot 1', captions: 'Morning' },
    { id: 'c2', sourceId: 's2', track: 'music', startSeconds: 0, durationSeconds: 5, trimStartSeconds: 0, volume: 0.6, label: 'Music' },
  ],
};

describe('buildMovieRenderRequest', () => {
  it('resolves tenant-stored media to public asset URLs', () => {
    const built = buildMovieRenderRequest({
      timeline,
      sources: [
        { id: 's1', kind: 'video', url: 'https://api.example.com/api/brain/uploads/7/u/a.mp4', storageKey: '7/u/a.mp4' },
        { id: 's2', kind: 'audio', url: 'https://cdn.example.org/song.mp3' },
      ],
      tenantId: 7,
      publicOrigin: origin,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.items[0]).toMatchObject({ url: `${origin}/api/assets/7/u/a.mp4`, track: 'visual', captions: 'Morning' });
    expect(built.request.items[1]).toMatchObject({ url: 'https://cdn.example.org/song.mp3', kind: 'audio', volume: 0.6 });
    expect(built.request).toMatchObject({ width: 1280, height: 720, fps: 30, backgroundColor: '#101010' });
  });

  it("refuses another tenant's storage key", () => {
    const built = buildMovieRenderRequest({
      timeline: { ...timeline, clips: [timeline.clips[0]] },
      sources: [{ id: 's1', kind: 'video', url: 'x', storageKey: '8/u/a.mp4' }],
      tenantId: 7, publicOrigin: origin,
    });
    expect(built.ok).toBe(false);
  });

  it('refuses blob:, data: and internal URLs', () => {
    for (const url of ['blob:https://app/x', 'data:video/mp4;base64,AAAA', 'https://169.254.169.254/latest', 'http://example.com/a.mp4']) {
      const built = buildMovieRenderRequest({
        timeline: { ...timeline, clips: [timeline.clips[0]] },
        sources: [{ id: 's1', kind: 'video', url }],
        tenantId: 7, publicOrigin: origin,
      });
      expect(built.ok, url).toBe(false);
    }
  });

  it('refuses an empty timeline and a clip without a source', () => {
    expect(buildMovieRenderRequest({ timeline: { ...timeline, clips: [] }, sources: [], tenantId: 7, publicOrigin: origin }).ok).toBe(false);
    expect(buildMovieRenderRequest({ timeline, sources: [], tenantId: 7, publicOrigin: origin }).ok).toBe(false);
  });
});
