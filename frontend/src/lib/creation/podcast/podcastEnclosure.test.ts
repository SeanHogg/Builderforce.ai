import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.fn();
const guest = vi.fn();
const sign = vi.fn();
vi.mock('@/lib/canvasMediaStore', () => ({ uploadCanvasFile: (file: File) => store(file) }));
vi.mock('../exportArtifact', () => ({ isGuestSession: () => guest() }));
vi.mock('@/lib/apiClient', () => ({ apiRequest: (path: string, init: unknown) => sign(path, init) }));
vi.mock('@/lib/auth', () => ({ AUTH_API_URL: 'https://api.example.com' }));

import { measureRemoteBytes } from './podcastAudioSize';
import { CHAPTERS_MIME, uploadPodcastChapters } from './podcastChaptersUpload';
import { podcastEnclosureBytes } from './podcastEpisode';
import { buildPodcastFeed } from './podcastRss';

const timeline = { version: 1, fps: 30, width: 1920, height: 1080, clips: [
  { id: 'c1', sourceId: 's1', track: 'voiceover', startSeconds: 0, durationSeconds: 60, trimStartSeconds: 0, volume: 1, label: 'Intro', chapterTitle: 'Welcome' },
] };
const sources = [{ id: 's1', kind: 'audio', captureKind: 'import', url: 'https://cdn.example/ep1.mp3', fileName: 'ep1.mp3', mimeType: 'audio/mpeg', durationSeconds: 60 }];
const object = (episode: Record<string, unknown>) => ({
  title: 'Episode One', podcastTimeline: timeline, podcastSources: sources,
  podcastShow: { title: 'The Show', link: 'https://example.com', imageUrl: 'https://example.com/cover.jpg', ownerEmail: 'a@b.co', author: 'Ann' },
  podcastEpisode: episode,
});
const now = new Date('2026-11-08T00:00:00Z');

beforeEach(() => { store.mockReset(); guest.mockReset(); sign.mockReset(); });

describe('enclosure length', () => {
  it('regression: a single hosted segment declares the size recorded when it was added', () => {
    const data = object({ sourceBytes: { s1: 123456 } });
    expect(buildPodcastFeed(data, 'g', now)).toMatchObject({ ok: false, problems: ['noEnclosureLength'] });
    const bytes = podcastEnclosureBytes(data);
    expect(bytes).toBe(123456);
    const result = buildPodcastFeed(data, 'g', now, { enclosureBytes: bytes! });
    expect(result.ok && result.xml).toContain('length="123456"');
  });

  it('leaves a hand-typed master URL to its own entered or measured size', () => {
    expect(podcastEnclosureBytes(object({ audioUrl: 'https://cdn.example/master.mp3', sourceBytes: { s1: 5 }, audioBytes: 777 }))).toBeUndefined();
    const result = buildPodcastFeed(object({ audioUrl: 'https://cdn.example/master.mp3', audioBytes: 777 }), 'g', now);
    expect(result.ok && result.xml).toContain('length="777"');
  });

  it('measures a published file with a HEAD request for Content-Length', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200, headers: { 'content-length': '2048' } }));
    expect(await measureRemoteBytes('https://cdn.example/master.mp3', fetchMock as unknown as typeof fetch)).toBe(2048);
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/master.mp3', { method: 'HEAD', mode: 'cors', credentials: 'omit' });
  });

  it('answers null when the host will not say, so the editor asks for the size', async () => {
    const noHeader = vi.fn(async () => new Response(null, { status: 200 }));
    const blocked = vi.fn(async () => { throw new TypeError('CORS'); });
    expect(await measureRemoteBytes('https://cdn.example/a.mp3', noHeader as unknown as typeof fetch)).toBeNull();
    expect(await measureRemoteBytes('https://cdn.example/a.mp3', blocked as unknown as typeof fetch)).toBeNull();
    expect(await measureRemoteBytes('data:audio/mpeg;base64,AAAA', noHeader as unknown as typeof fetch)).toBeNull();
  });
});

describe('chapters', () => {
  const chapters = [{ startTimeSec: 0, title: 'Welcome' }];

  it('uploads the Podcast 2.0 chapters JSON and feeds its PUBLISH url to the chapters tag', async () => {
    guest.mockReturnValue(false);
    store.mockResolvedValue({ url: 'https://api.example.com/api/brain/uploads/7/u/c.json', storageKey: '7/u/c.json' });
    sign.mockResolvedValue({ exp: 2000000000, sig: 'a+b' });
    const url = await uploadPodcastChapters(chapters);
    const file = store.mock.calls[0]![0] as File;
    expect(file.type).toBe(CHAPTERS_MIME);
    expect(JSON.parse(await file.text())).toEqual({ version: '1.2.0', chapters: [{ startTime: 0, title: 'Welcome' }] });
    expect(sign).toHaveBeenCalledWith('/api/brain/uploads/sign', { method: 'POST', body: JSON.stringify({ key: '7/u/c.json', purpose: 'publish' }) });
    const result = buildPodcastFeed(object({ sourceBytes: { s1: 9 } }), 'g', now, { enclosureBytes: 9, ...(url ? { chaptersUrl: url } : {}) });
    expect(result.ok && result.xml).toContain('<podcast:chapters url="https://api.example.com/api/brain-files/7/u/c.json?exp=2000000000&amp;sig=a%2Bb"');
  });

  it('skips chapters for a guest, and when the upload or the signature fails', async () => {
    guest.mockReturnValue(true);
    expect(await uploadPodcastChapters(chapters)).toBeUndefined();
    expect(store).not.toHaveBeenCalled();
    guest.mockReturnValue(false);
    store.mockResolvedValue(null);
    expect(await uploadPodcastChapters(chapters)).toBeUndefined();
    store.mockResolvedValue({ url: 'u', storageKey: 'k' });
    sign.mockRejectedValue(new Error('refused'));
    expect(await uploadPodcastChapters(chapters)).toBeUndefined();
  });
});

describe('enclosure publish url', () => {
  const hosted = { ...object({ sourceBytes: { s1: 9 } }), podcastSources: [{ ...sources[0]!, url: 'https://api.example.com/api/brain/uploads/7/u/ep.mp3', storageKey: '7/u/ep.mp3' }] };

  it('puts a publish url (not the authenticated upload url) in the enclosure', async () => {
    guest.mockReturnValue(false);
    sign.mockResolvedValue({ exp: 2000000000, sig: 'sig' });
    const published = await withPublishedEnclosure(hosted);
    const result = buildPodcastFeed(published, 'g', now, { enclosureBytes: 9 });
    expect(result.ok && result.xml).toContain('<enclosure url="https://api.example.com/api/brain-files/7/u/ep.mp3?exp=2000000000&amp;sig=sig"');
    expect(result.ok && result.xml).not.toContain('/api/brain/uploads/');
  });

  it('uses a hand-typed master URL as-is, and leaves a guest or refused signature untouched', async () => {
    guest.mockReturnValue(false);
    const typed = { ...hosted, podcastEpisode: { audioUrl: 'https://cdn.example/master.mp3', audioBytes: 5 } };
    expect(await withPublishedEnclosure(typed)).toBe(typed);
    expect(sign).not.toHaveBeenCalled();
    sign.mockRejectedValue(new Error('type-not-allowed'));
    expect(await withPublishedEnclosure(hosted)).toBe(hosted);
    guest.mockReturnValue(true);
    expect(await withPublishedEnclosure(hosted)).toBe(hosted);
  });
});
