import { describe, expect, it, vi } from 'vitest';
import { REPLAY_LIMITS } from '@builderforce/interaction-contract';
import { ChunkBatch, type BatchSink } from './batch';

function sink(handler: BatchSink['post']): BatchSink {
  return {
    post: handler,
    now: () => 0,
    sleep: async () => {},
  };
}

describe('ChunkBatch', () => {
  it('posts a well-formed chunk and increments seq', async () => {
    const posts: string[] = [];
    const batch = new ChunkBatch({
      url: 'https://example.test/ingest',
      visitId: 'visit-abc',
      sink: sink(async (_url, body) => {
        posts.push(body);
        return { status: 204 };
      }),
    });
    batch.push({ t: 0, kind: 'click', x: 1 });
    await batch.flush(false);
    expect(JSON.parse(posts[0]!)).toMatchObject({ visitId: 'visit-abc', seq: 0 });
    batch.push({ t: 10, kind: 'scroll' });
    await batch.flush(false);
    expect(JSON.parse(posts[1]!).seq).toBe(1);
  });

  it('splits on 413 when there are two or more events', async () => {
    const statuses = [413, 204, 204];
    const posts: unknown[] = [];
    const batch = new ChunkBatch({
      url: 'https://example.test/ingest',
      visitId: 'visit-abc',
      sink: sink(async (_url, body) => {
        posts.push(JSON.parse(body));
        return { status: statuses.shift() ?? 204 };
      }),
    });
    batch.push({ t: 0, kind: 'click' });
    batch.push({ t: 1, kind: 'click' });
    await batch.flush(false);
    expect(posts.length).toBeGreaterThanOrEqual(3);
    expect((posts[1] as { events: unknown[] }).events.length).toBe(1);
  });

  it('honours 429 Retry-After before retrying', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const batch = new ChunkBatch({
      url: 'https://example.test/ingest',
      visitId: 'visit-abc',
      sink: {
        post: async () => {
          calls += 1;
          return calls === 1 ? { status: 429, retryAfterMs: 1500 } : { status: 204 };
        },
        now: () => 0,
        sleep,
      },
    });
    batch.push({ t: 0, kind: 'pageview' });
    await batch.flush(false);
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(calls).toBe(2);
  });

  it('retries 5xx with backoff', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const batch = new ChunkBatch({
      url: 'https://example.test/ingest',
      visitId: 'visit-abc',
      sink: {
        post: async () => {
          calls += 1;
          return { status: calls < 3 ? 503 : 204 };
        },
        now: () => 0,
        sleep,
      },
    });
    batch.push({ t: 0, kind: 'error' });
    await batch.flush(false);
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalled();
  });

  it('uses the contract flush interval', () => {
    expect(REPLAY_LIMITS.flushIntervalMs).toBe(5_000);
  });
});
