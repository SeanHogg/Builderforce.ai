import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostPersistQueue, HOST_PERSIST_MAX_ITEMS, HOST_PERSIST_MAX_WAIT_MS } from './hostPersistQueue';

function queue() {
  const posts: Array<{ suffix: string; body: unknown }> = [];
  const errors: unknown[] = [];
  const q = createHostPersistQueue({
    post: async (suffix, body) => { posts.push({ suffix, body }); },
    onError: (error) => { errors.push(error); },
  });
  return { q, posts, errors };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('relay persist queue', () => {
  it('batches frames per kind into one post each after the wait', async () => {
    const { q, posts } = queue();
    q.event('/tool-audit', { toolName: 'a' });
    q.event('/tool-audit', { toolName: 'b' });
    q.event('/usage-snapshot', { inputTokens: 1 });
    q.event('/tool-audit', { toolName: 'c' });
    await vi.advanceTimersByTimeAsync(HOST_PERSIST_MAX_WAIT_MS - 1);
    expect(posts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(posts).toEqual([
      { suffix: '/tool-audit', body: { events: [{ toolName: 'a' }, { toolName: 'b' }, { toolName: 'c' }] } },
      { suffix: '/usage-snapshot', body: { events: [{ inputTokens: 1 }] } },
    ]);
  });

  it('sends a full batch without waiting', async () => {
    const { q, posts } = queue();
    for (let i = 0; i < HOST_PERSIST_MAX_ITEMS; i += 1) q.event('/file-change', { taskId: 1, path: `f${i}` });
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toHaveLength(1);
    expect((posts[0]!.body as { events: unknown[] }).events).toHaveLength(HOST_PERSIST_MAX_ITEMS);
  });

  it('keeps chat messages in order, one batch per session', async () => {
    const { q, posts } = queue();
    q.message('main', { role: 'user', content: 'hi', seq: 1 });
    q.message('side', { role: 'user', content: 'other', seq: 1 });
    q.message('main', { role: 'assistant', content: 'hello', seq: 2 });
    await q.flush();
    expect(posts).toEqual([
      { suffix: '/messages', body: { sessionKey: 'main', messages: [
        { role: 'user', content: 'hi', seq: 1 },
        { role: 'assistant', content: 'hello', seq: 2 },
      ] } },
      { suffix: '/messages', body: { sessionKey: 'side', messages: [{ role: 'user', content: 'other', seq: 1 }] } },
    ]);
  });

  it('reports a failed batch instead of throwing (best-effort, as before)', async () => {
    const errors: unknown[] = [];
    const q = createHostPersistQueue({
      post: async () => { throw new Error('down'); },
      onError: (error) => { errors.push(error); },
    });
    q.event('/tool-audit', { toolName: 'a' });
    await expect(q.flush()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
