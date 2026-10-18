import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('./builderforceApi', () => ({ request: (...args: unknown[]) => request(...args) }));

import { createLiveRunsReader, elapsedNow } from './liveRunsApi';

/**
 * The version-gated live-runs reader: the first read ships the body, later reads
 * send `since` and keep the SAME snapshot while the server answers `unchanged`.
 */
describe('createLiveRunsReader', () => {
  beforeEach(() => request.mockReset());

  it('sends the held version as `since` and keeps the snapshot while nothing moved', async () => {
    request.mockResolvedValueOnce({ version: 'v1', active: [{ id: 1 }], runningCloudRefs: [] });
    request.mockResolvedValueOnce({ version: 'v1', unchanged: true });
    const reader = createLiveRunsReader();

    const first = await reader.read();
    expect(request).toHaveBeenLastCalledWith('/api/runtime/active');
    expect(first.active).toHaveLength(1);

    const second = await reader.read();
    expect(request).toHaveBeenLastCalledWith('/api/runtime/active?since=v1');
    expect(second).toBe(first);
  });

  it('replaces the snapshot when the version moves, and asks for the projections it was built with', async () => {
    request.mockResolvedValueOnce({ version: 'v1', active: [], taskRuns: [] });
    request.mockResolvedValueOnce({ version: 'v2', active: [], taskRuns: [{ id: 7, taskId: 1, status: 'running' }] });
    const reader = createLiveRunsReader({ taskRuns: 12 });

    const first = await reader.read();
    expect(request.mock.calls[0][0]).toBe('/api/runtime/active?taskRuns=12');
    const second = await reader.read();
    expect(request.mock.calls[1][0]).toBe('/api/runtime/active?since=v1&taskRuns=12');
    expect(second).not.toBe(first);
    expect(second.taskRuns).toHaveLength(1);
  });

  it('sends the viewer timezone with an activity window', async () => {
    request.mockResolvedValueOnce({ version: 'v1', active: [], activity: [1, 2] });
    const snapshot = await createLiveRunsReader({ activityDays: 14 }).read();
    expect(String(request.mock.calls[0][0])).toMatch(/activityDays=14&tzOffset=-?\d+/);
    expect(snapshot.activity).toEqual([1, 2]);
  });
});

describe('elapsedNow', () => {
  it('advances the server-measured elapsed by the time since the snapshot arrived', () => {
    expect(elapsedNow({ elapsedMs: 1_000 }, { receivedAt: 5_000 }, 8_000)).toBe(4_000);
    expect(elapsedNow({ elapsedMs: null }, { receivedAt: 5_000 }, 8_000)).toBeNull();
  });
});
