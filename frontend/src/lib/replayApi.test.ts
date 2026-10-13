import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';
import { REPLAY_PATHS } from '@builderforce/interaction-contract';

/**
 * The Insights client: paths from `REPLAY_PATHS`, `?site=` on every read, the
 * filter encoded by the contract, and chunk bytes read whether or not the
 * browser already inflated them.
 */

const transport = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestStream: vi.fn() }));
vi.mock('./apiClient', () => transport);

import { parseChunkBytes, replayApi } from './replayApi';

afterEach(() => {
  transport.apiRequest.mockReset();
  transport.apiRequestStream.mockReset();
});

function calledUrl(): URL {
  return new URL(String(transport.apiRequest.mock.calls.at(-1)![0]), 'https://api.example');
}

describe('replayApi', () => {
  it('lists recordings for a site with the window, cursor and contract-encoded filter', async () => {
    transport.apiRequest.mockResolvedValue({ items: [], nextCursor: null });
    await replayApi.listRecordings('site-1', {
      days: 7,
      cursor: 'c2',
      filter: { all: [{ field: 'visitedPath', op: 'eq', value: '/pricing' }] },
    });
    const url = calledUrl();
    expect(url.pathname).toBe(REPLAY_PATHS.recordings);
    expect(url.searchParams.get('site')).toBe('site-1');
    expect(url.searchParams.get('days')).toBe('7');
    expect(url.searchParams.get('cursor')).toBe('c2');
    expect(url.searchParams.get('f.visitedPath.eq')).toBe('/pricing');
  });

  it('fills path segments and leaves out empty params', async () => {
    transport.apiRequest.mockResolvedValue({});
    await replayApi.getIssue('site-1', 'iss/1', { days: 30 });
    const url = calledUrl();
    expect(url.pathname).toBe('/api/replay/issues/iss%2F1');
    expect([...url.searchParams.keys()]).toEqual(['site', 'days']);
  });

  it('collapses concurrent reads of one recording into one request', async () => {
    let resolve: (value: unknown) => void = () => {};
    transport.apiRequest.mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = replayApi.getRecording('site-1', 'rec-1');
    const b = replayApi.getRecording('site-1', 'rec-1');
    resolve({ id: 'rec-1' });
    await Promise.all([a, b]);
    expect(transport.apiRequest).toHaveBeenCalledTimes(1);
    // Settled → not a cache: the next read asks again.
    transport.apiRequest.mockResolvedValue({ id: 'rec-1' });
    await replayApi.getRecording('site-1', 'rec-1');
    expect(transport.apiRequest).toHaveBeenCalledTimes(2);
  });

  it('renames a release with PATCH', async () => {
    transport.apiRequest.mockResolvedValue({});
    await replayApi.renameRelease('site-1', 'rel-a', 'Spring launch');
    const [path, init] = transport.apiRequest.mock.calls.at(-1)!;
    expect(String(path)).toContain('/api/replay/releases/rel-a?');
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ label: 'Spring launch' }) });
  });

  it('accepts a bare array or a page of releases', async () => {
    transport.apiRequest.mockResolvedValueOnce([{ releaseKey: 'a' }]);
    expect(await replayApi.listReleases('site-1')).toEqual([{ releaseKey: 'a' }]);
    transport.apiRequest.mockResolvedValueOnce({ items: [{ releaseKey: 'b' }], nextCursor: null });
    expect(await replayApi.listReleases('site-1')).toEqual([{ releaseKey: 'b' }]);
  });

  it('reads a chunk and throws on a failed one', async () => {
    const body = strToU8('{"type":4,"timestamp":1}\n{"type":2,"timestamp":2}\n');
    transport.apiRequestStream.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
    expect(await replayApi.getRecordingChunk('site-1', 'rec-1', 0)).toHaveLength(2);
    const [path] = transport.apiRequestStream.mock.calls.at(-1)!;
    expect(String(path)).toContain('/api/replay/recordings/rec-1/chunks/0?site=site-1');

    transport.apiRequestStream.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(replayApi.getRecordingChunk('site-1', 'rec-1', 9)).rejects.toThrow('404');
  });
});

describe('parseChunkBytes', () => {
  const ndjson = '{"type":4,"timestamp":1}\n\n{"type":2,"timestamp":2}\n';

  it('reads inflated NDJSON', () => {
    expect(parseChunkBytes(strToU8(ndjson))).toEqual([{ type: 4, timestamp: 1 }, { type: 2, timestamp: 2 }]);
  });

  it('inflates raw gzip itself', () => {
    expect(parseChunkBytes(gzipSync(strToU8(ndjson)))).toEqual([{ type: 4, timestamp: 1 }, { type: 2, timestamp: 2 }]);
  });

  it('flattens a line that is a whole chunk object', () => {
    const line = JSON.stringify({ v: 1, seq: 0, events: [{ type: 4 }, { type: 2 }] });
    expect(parseChunkBytes(strToU8(line))).toEqual([{ type: 4 }, { type: 2 }]);
  });

  it('skips a torn line rather than losing the chunk', () => {
    expect(parseChunkBytes(strToU8('{"type":4}\n{"type":2,"ti'))).toEqual([{ type: 4 }]);
  });
});
