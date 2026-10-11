import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgedBytes,
  normalizeChunkBytes,
  runYouTubeUploadTick,
  uploadPercent,
  YOUTUBE_CHUNK_QUANTUM,
  YouTubeUploadSourceError,
  type YouTubeUploadCursor,
  type YouTubeUploadSource,
} from './youtubeResumableUpload';

/**
 * The resumable protocol against a stubbed `fetch`: no network, no database. Every
 * call the engine makes is recorded so the assertions can read the wire — the
 * Content-Range headers are the contract with Google, not an implementation detail.
 */

const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session-1';
const Q = YOUTUBE_CHUNK_QUANTUM;

interface Call { url: string; method: string; headers: Record<string, string>; bytes: number }

function memorySource(size: number, contentType: string | null = 'video/mp4'): YouTubeUploadSource & { reads: Array<[number, number]> } {
  const reads: Array<[number, number]> = [];
  return {
    reads,
    describe: async () => ({ size, contentType }),
    read: async (offset, length) => { reads.push([offset, length]); return new ArrayBuffer(length); },
  };
}

/** A fake Google: `respond` decides each answer; every request is recorded. */
function fakeGoogle(respond: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = init?.body;
    const bytes = body instanceof ArrayBuffer ? body.byteLength : typeof body === 'string' ? body.length : 0;
    const call = { url: String(input), method: init?.method ?? 'GET', headers, bytes };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const initiated = () => new Response(null, { status: 200, headers: { Location: SESSION } });
const incomplete = (lastByte: number | null) => new Response(null, { status: 308, headers: lastByte == null ? {} : { Range: `bytes=0-${lastByte}` } });
const done = (id = 'vid123') => new Response(JSON.stringify({ id, status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const cursor = (patch: Partial<YouTubeUploadCursor> = {}): YouTubeUploadCursor => ({
  uploadUrl: null, bytesSent: 0, byteSize: 0, mimeType: 'video/mp4',
  title: 'Launch', description: 'It is out', privacyStatus: 'unlisted', ...patch,
});

describe('chunk arithmetic', () => {
  it('rounds every chunk DOWN to a 256 KiB multiple, never below one quantum', () => {
    expect(normalizeChunkBytes(Q * 3 + 1000)).toBe(Q * 3);
    expect(normalizeChunkBytes(10)).toBe(Q);
    expect(normalizeChunkBytes(undefined) % Q).toBe(0);
  });

  it('reads the acknowledged byte count from a 308 Range header', () => {
    expect(acknowledgedBytes('bytes=0-524287')).toBe(524288);
    expect(acknowledgedBytes(null)).toBe(0);
  });

  it('reports a whole-number percent, clamped', () => {
    expect(uploadPercent(1, 3)).toBe(33);
    expect(uploadPercent(5, 0)).toBe(0);
    expect(uploadPercent(9, 3)).toBe(100);
  });
});

describe('runYouTubeUploadTick', () => {
  it('finishes a small object in one chunk — the same path as a long one', async () => {
    const source = memorySource(1000);
    const google = fakeGoogle((call) => call.method === 'POST' ? initiated() : done());
    const tick = await runYouTubeUploadTick(cursor(), { accessToken: 't', source, fetchImpl: google.fetchImpl });

    expect(tick).toMatchObject({ kind: 'succeeded', videoId: 'vid123', bytesSent: 1000, byteSize: 1000 });
    expect(google.calls).toHaveLength(2);
    expect(google.calls[0]!.headers['X-Upload-Content-Length']).toBe('1000');
    expect(google.calls[1]!.headers['Content-Range']).toBe('bytes 0-999/1000');
    expect(google.calls[1]!.headers.Authorization).toBe('Bearer t');
  });

  it('sends 256 KiB-multiple chunks with Content-Range and yields after maxChunks', async () => {
    const size = Q * 10;
    const source = memorySource(size);
    const google = fakeGoogle((call) => {
      if (call.method === 'POST') return initiated();
      const end = Number(/bytes \d+-(\d+)\//.exec(call.headers['Content-Range']!)![1]);
      return incomplete(end);
    });
    const tick = await runYouTubeUploadTick(cursor(), { accessToken: 't', source, fetchImpl: google.fetchImpl, chunkBytes: Q * 2, maxChunks: 2 });

    expect(tick).toEqual({ kind: 'progress', uploadUrl: SESSION, bytesSent: Q * 4, byteSize: size, mimeType: 'video/mp4' });
    const puts = google.calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.headers['Content-Range'])).toEqual([
      `bytes 0-${Q * 2 - 1}/${size}`,
      `bytes ${Q * 2}-${Q * 4 - 1}/${size}`,
    ]);
    for (const put of puts) expect(put.bytes % Q).toBe(0);
  });

  it('resumes a stored session from the offset GOOGLE confirms, not our own counter', async () => {
    const size = Q * 4;
    const source = memorySource(size);
    const google = fakeGoogle((call, index) => {
      // The status probe: Google only holds one quantum even though we recorded two.
      if (index === 0) return incomplete(Q - 1);
      return done('resumed');
    });
    const tick = await runYouTubeUploadTick(
      cursor({ uploadUrl: SESSION, bytesSent: Q * 2, byteSize: size }),
      { accessToken: 't', source, fetchImpl: google.fetchImpl, chunkBytes: Q * 4 },
    );

    expect(google.calls[0]).toMatchObject({ method: 'PUT', bytes: 0 });
    expect(google.calls[0]!.headers['Content-Range']).toBe(`bytes */${size}`);
    expect(source.reads[0]).toEqual([Q, Q * 3]);
    expect(google.calls[1]!.headers['Content-Range']).toBe(`bytes ${Q}-${size - 1}/${size}`);
    expect(tick).toMatchObject({ kind: 'succeeded', videoId: 'resumed' });
  });

  it('turns a 5xx on a chunk into a retry that keeps the confirmed offset', async () => {
    const size = Q * 4;
    const google = fakeGoogle((call, index) => {
      if (call.method === 'POST') return initiated();
      return index === 1 ? incomplete(Q - 1) : new Response('upstream', { status: 503 });
    });
    const tick = await runYouTubeUploadTick(cursor(), { accessToken: 't', source: memorySource(size), fetchImpl: google.fetchImpl, chunkBytes: Q });
    expect(tick).toMatchObject({ kind: 'retry', uploadUrl: SESSION, bytesSent: Q, byteSize: size });
  });

  it('re-initiates when the stored session has expired (404 on the status probe)', async () => {
    const google = fakeGoogle((call, index) => {
      if (index === 0) return new Response(null, { status: 404 });
      if (call.method === 'POST') return new Response(null, { status: 200, headers: { Location: `${SESSION}-2` } });
      return done('fresh');
    });
    const tick = await runYouTubeUploadTick(
      cursor({ uploadUrl: SESSION, bytesSent: Q, byteSize: 500 }),
      { accessToken: 't', source: memorySource(500), fetchImpl: google.fetchImpl },
    );
    expect(google.calls.map((c) => c.method)).toEqual(['PUT', 'POST', 'PUT']);
    expect(google.calls[2]!.url).toBe(`${SESSION}-2`);
    expect(google.calls[2]!.headers['Content-Range']).toBe('bytes 0-499/500');
    expect(tick).toMatchObject({ kind: 'succeeded', videoId: 'fresh' });
  });

  it('fails terminally on a refusal retrying cannot fix (quota)', async () => {
    const google = fakeGoogle(() => new Response(JSON.stringify({ error: { message: 'Quota exceeded', errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }));
    const tick = await runYouTubeUploadTick(cursor(), { accessToken: 't', source: memorySource(100), fetchImpl: google.fetchImpl });
    expect(tick).toEqual({ kind: 'failed', error: 'Quota exceeded (quotaExceeded)' });
  });

  it('refuses media that is not a video before any call to Google', async () => {
    const google = fakeGoogle(() => initiated());
    const tick = await runYouTubeUploadTick(cursor(), { accessToken: 't', source: memorySource(100, 'image/png'), fetchImpl: google.fetchImpl });
    expect(tick.kind).toBe('failed');
    expect(google.calls).toHaveLength(0);
  });

  it('classifies a source failure by its own retryable flag', async () => {
    const google = fakeGoogle(() => initiated());
    const broken: YouTubeUploadSource = {
      describe: async () => ({ size: Q, contentType: 'video/webm' }),
      read: async () => { throw new YouTubeUploadSourceError('gone', false); },
    };
    const tick = await runYouTubeUploadTick(cursor(), { accessToken: 't', source: broken, fetchImpl: google.fetchImpl });
    expect(tick).toEqual({ kind: 'failed', error: 'gone' });
  });

  it('treats a network error as transient', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('connection reset'); }) as unknown as typeof fetch;
    const tick = await runYouTubeUploadTick(cursor(), { accessToken: 't', source: memorySource(100), fetchImpl });
    expect(tick).toMatchObject({ kind: 'retry', error: 'connection reset', bytesSent: 0 });
  });
});
