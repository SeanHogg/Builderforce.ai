import { afterEach, describe, expect, it, vi } from 'vitest';
import { urlUploadSource } from './youtubeUploadSources';
import { YouTubeUploadSourceError } from './youtubeResumableUpload';

/**
 * A campaign's video is read from its public URL in ranges. `fetch` is stubbed
 * globally — the SSRF guard's DNS-over-HTTPS lookups go through it too, and are
 * answered 404 so the guard fails open exactly as it does when DoH is unreachable.
 */

const MEDIA = 'https://cdn.example.com/launch.mp4';

function stubMedia(respond: (range: string | null) => Response) {
  const ranges: Array<string | null> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response('', { status: 404 });
    const range = ((init?.headers ?? {}) as Record<string, string>).Range ?? null;
    ranges.push(range);
    return respond(range);
  }));
  return ranges;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('urlUploadSource', () => {
  it('learns size and type from a one-byte ranged read', async () => {
    stubMedia(() => new Response('x', { status: 206, headers: { 'Content-Range': 'bytes 0-0/5242880', 'Content-Type': 'video/mp4' } }));
    await expect(urlUploadSource(MEDIA).describe()).resolves.toEqual({ size: 5242880, contentType: 'video/mp4' });
  });

  it('reads exactly the requested range', async () => {
    const ranges = stubMedia(() => new Response(new Uint8Array(10), { status: 206 }));
    const bytes = await urlUploadSource(MEDIA).read(100, 10);
    expect(bytes.byteLength).toBe(10);
    expect(ranges).toEqual(['bytes=100-109']);
  });

  it('refuses a host that ignores Range, because every chunk would be the whole file', async () => {
    stubMedia(() => new Response('whole file', { status: 200 }));
    await expect(urlUploadSource(MEDIA).describe()).rejects.toMatchObject({ retryable: false });
  });

  it('marks a 5xx retryable and a 404 terminal', async () => {
    stubMedia(() => new Response('', { status: 503 }));
    const transient = await urlUploadSource(MEDIA).read(0, 10).catch((error: unknown) => error);
    expect(transient).toBeInstanceOf(YouTubeUploadSourceError);
    expect((transient as YouTubeUploadSourceError).retryable).toBe(true);

    vi.unstubAllGlobals();
    stubMedia(() => new Response('', { status: 404 }));
    const gone = await urlUploadSource(MEDIA).read(0, 10).catch((error: unknown) => error);
    expect((gone as YouTubeUploadSourceError).retryable).toBe(false);
  });

  it('refuses a non-public URL before any request', async () => {
    const ranges = stubMedia(() => new Response('', { status: 206 }));
    await expect(urlUploadSource('http://127.0.0.1/video.mp4').describe()).rejects.toMatchObject({ retryable: false });
    expect(ranges).toHaveLength(0);
  });
});
