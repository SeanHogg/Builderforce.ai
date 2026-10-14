import { gunzipSync } from 'node:zlib';
import { CompressionStream as NodeCompressionStream } from 'node:stream/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_LIMITS, type ReplayChunk } from '@builderforce/interaction-contract';
import { ChunkBatch, gzipJson, type BatchSink, type ChunkHeader, type PostOptions } from './batch';

function header(over: Partial<ChunkHeader> = {}): ChunkHeader {
  return {
    v: 1,
    visitorId: 'visitor_abc123',
    visitId: 'visit_abc123',
    startedAt: 1_700_000_000_000,
    release: 'r1',
    recorderVersion: 'test',
    device: { class: 'desktop', w: 1280, h: 720 },
    newVisitor: false,
    keep: null,
    sampleWeight: 1,
    ...over,
  };
}

interface Post {
  chunk: ReplayChunk;
  opts: PostOptions;
  raw: string | ArrayBuffer;
}

function harness(over: { header?: Partial<ChunkHeader>; statuses?: Array<{ status: number; retryAfterMs?: number }>; gzip?: boolean } = {}) {
  const posts: Post[] = [];
  const sleep = vi.fn(async (_ms: number) => {});
  let seq = 0;
  const sink: BatchSink = {
    async post(_url, body, opts) {
      const text = typeof body === 'string' ? body : gunzipSync(Buffer.from(body)).toString('utf8');
      posts.push({ chunk: JSON.parse(text) as ReplayChunk, opts, raw: body });
      return over.statuses?.shift() ?? { status: 202 };
    },
    sleep,
  };
  const batch = new ChunkBatch({
    url: 'https://api.test/api/replay-ingest/v1/chunks?site=bfr_x',
    header: () => header(over.header),
    nextSeq: () => seq++,
    sink,
    compress: over.gzip ? gzipJson : async () => null,
  });
  return { batch, posts, sleep };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChunkBatch', () => {
  it('posts a §3.4 chunk with increasing seq', async () => {
    const { batch, posts } = harness();
    batch.addMark({ kind: 'page', key: '/', atMs: 0 });
    await batch.flush(false);
    batch.addMark({ kind: 'click', key: 'a', atMs: 10 });
    await batch.flush(false);
    expect(posts.map((p) => p.chunk.seq)).toEqual([0, 1]);
    expect(posts[0]!.chunk).toMatchObject({ v: 1, visitId: 'visit_abc123', keep: null, marks: [{ kind: 'page', key: '/', atMs: 0 }] });
    expect(posts[0]!.opts).toEqual({ keepalive: false, gzip: false });
  });

  it('never sends events while the session is not kept', async () => {
    const { batch, posts } = harness();
    batch.pushEvent({ type: 3 });
    batch.addMark({ kind: 'page', key: '/', atMs: 0 });
    await batch.flush(false);
    expect(posts[0]!.chunk.events).toBeUndefined();
  });

  it('sends events on a kept session and uses keepalive on the final flush', async () => {
    const { batch, posts } = harness({ header: { keep: 'sample', sampleWeight: 4 } });
    batch.pushEvent({ type: 2 });
    batch.addMark({ kind: 'page', key: '/', atMs: 0 });
    await batch.flush(true);
    expect(posts[0]!.chunk).toMatchObject({ keep: 'sample', sampleWeight: 4, events: [{ type: 2 }] });
    expect(posts[0]!.opts.keepalive).toBe(true);
  });

  it('gzips with CompressionStream when the browser has it', async () => {
    vi.stubGlobal('CompressionStream', NodeCompressionStream);
    const { batch, posts } = harness({ gzip: true });
    batch.addMark({ kind: 'page', key: '/gz', atMs: 0 });
    await batch.flush(false);
    expect(posts[0]!.opts.gzip).toBe(true);
    expect(posts[0]!.raw).toBeInstanceOf(ArrayBuffer);
    expect(posts[0]!.chunk.marks[0]).toMatchObject({ key: '/gz' });
  });

  it('sends plain JSON when CompressionStream is missing', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(await gzipJson('{}')).toBeNull();
    const { batch, posts } = harness({ gzip: true });
    batch.addMark({ kind: 'page', key: '/', atMs: 0 });
    await batch.flush(false);
    expect(posts[0]!.opts.gzip).toBe(false);
    expect(typeof posts[0]!.raw).toBe('string');
  });

  it('splits events on 413', async () => {
    const { batch, posts } = harness({ header: { keep: 'manual' }, statuses: [{ status: 413 }] });
    batch.pushEvent({ type: 3, n: 1 });
    batch.pushEvent({ type: 3, n: 2 });
    await batch.flush(false);
    expect(posts).toHaveLength(3);
    expect(posts[1]!.chunk.events).toHaveLength(1);
    expect(posts[2]!.chunk.events).toHaveLength(1);
    expect(posts[2]!.chunk.seq).not.toBe(posts[1]!.chunk.seq);
  });

  it('honours 429 Retry-After and retries 5xx with backoff', async () => {
    const { batch, posts, sleep } = harness({ statuses: [{ status: 429, retryAfterMs: 1500 }, { status: 503 }] });
    batch.addMark({ kind: 'page', key: '/', atMs: 0 });
    await batch.flush(false);
    expect(sleep).toHaveBeenNthCalledWith(1, 1500);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(posts).toHaveLength(3);
  });

  it('uses the contract flush interval', () => {
    expect(REPLAY_LIMITS.flushMs).toBe(5_000);
  });
});
