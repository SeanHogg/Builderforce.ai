import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/builderforceApi', () => ({ creationSessionsApi: { timeline: { list: api.list } } }));

import { fetchTimelineTail, mergeTimelineTail, timelineCursor } from './canvasTimelineTail';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';

const msg = (clientMessageId: string, id?: number, body = clientMessageId): CanvasTimelineMessage => ({
  clientMessageId, id, body, messageRole: 'assistant', createdAt: '2026-10-17T00:00:00.000Z',
});

/** A `timeline.changed` frame reads only the rows past the newest id held, not the whole transcript. */
describe('canvas timeline tail', () => {
  beforeEach(() => { api.list.mockReset(); });

  it('uses the highest server id held as the cursor, ignoring optimistic rows', () => {
    expect(timelineCursor([])).toBe(0);
    expect(timelineCursor([msg('a', 4), msg('b'), msg('c', 9), msg('d', 7)])).toBe(9);
  });

  it('replaces an optimistic echo in place and appends the rest', () => {
    const held = [msg('a', 1), msg('mine')];
    const merged = mergeTimelineTail(held, [msg('mine', 2, 'saved'), msg('theirs', 3)]);
    expect(merged.map((m) => [m.clientMessageId, m.id])).toEqual([['a', 1], ['mine', 2], ['theirs', 3]]);
    expect(merged[1]!.body).toBe('saved');
  });

  it('keeps the same array when nothing arrived', () => {
    const held = [msg('a', 1)];
    expect(mergeTimelineTail(held, [])).toBe(held);
  });

  it('asks after the cursor and follows hasMore', async () => {
    api.list
      .mockResolvedValueOnce({ messages: [msg('b', 6)], lastId: 6, hasMore: true })
      .mockResolvedValueOnce({ messages: [msg('c', 7)], lastId: 7, hasMore: false });
    const rows = await fetchTimelineTail('s1', 5);
    expect(api.list).toHaveBeenNthCalledWith(1, 's1', 5);
    expect(api.list).toHaveBeenNthCalledWith(2, 's1', 6);
    expect(rows.map((m) => m.id)).toEqual([6, 7]);
  });
});
