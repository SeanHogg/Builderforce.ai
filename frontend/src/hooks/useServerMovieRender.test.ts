import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ startServerMovieRender: vi.fn(), waitForVideoJob: vi.fn() }));
vi.mock('@/lib/videoGenerationApi', () => api);

import { useServerMovieRender } from './useServerMovieRender';

const RESULT = { url: 'https://x/movie.mp4', storageKey: 'k/movie', mimeType: 'video/mp4', durationSeconds: 30 };
const TIMELINE = { clips: [] } as never;

beforeEach(() => {
  api.startServerMovieRender.mockReset();
  api.waitForVideoJob.mockReset();
});

describe('useServerMovieRender', () => {
  it('starts a job and hands its id to the caller to persist', async () => {
    api.startServerMovieRender.mockResolvedValue({ id: 'job-1', kind: 'render', status: 'queued' });
    const onJobChange = vi.fn();
    const { result } = renderHook(() => useServerMovieRender({ pendingJobId: null, onJobChange, onRendered: vi.fn() }));
    await act(() => result.current.start(TIMELINE, []));
    expect(api.startServerMovieRender).toHaveBeenCalledWith({ timeline: TIMELINE, sources: [], useCase: 'canvas-movie-render' });
    expect(onJobChange).toHaveBeenCalledWith('job-1');
  });

  it('follows a pending job left by an earlier visit and lands its MP4', async () => {
    api.waitForVideoJob.mockResolvedValue({ id: 'job-1', kind: 'render', status: 'succeeded', result: RESULT });
    const onJobChange = vi.fn();
    const onRendered = vi.fn();
    const { result } = renderHook(() => useServerMovieRender({ pendingJobId: 'job-1', onJobChange, onRendered }));
    expect(result.current.phase).toBe('rendering');
    await waitFor(() => expect(onRendered).toHaveBeenCalledWith(RESULT));
    expect(onJobChange).toHaveBeenCalledWith(null);
    expect(result.current.phase).toBe('idle');
  });

  it("surfaces the job's failure and clears the pending id", async () => {
    api.waitForVideoJob.mockRejectedValue(new Error('A clip in the timeline is not in this workspace'));
    const onJobChange = vi.fn();
    const { result } = renderHook(() => useServerMovieRender({ pendingJobId: 'job-1', onJobChange, onRendered: vi.fn() }));
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toBe('A clip in the timeline is not in this workspace');
    expect(onJobChange).toHaveBeenCalledWith(null);
  });

  it('reports a refused start (e.g. the plan gate) without a job', async () => {
    api.startServerMovieRender.mockRejectedValue(new Error('Upgrade to Pro to unlock rendering movies on the server.'));
    const onJobChange = vi.fn();
    const { result } = renderHook(() => useServerMovieRender({ pendingJobId: null, onJobChange, onRendered: vi.fn() }));
    await act(() => result.current.start(TIMELINE, []));
    expect(result.current.phase).toBe('failed');
    expect(onJobChange).not.toHaveBeenCalled();
  });
});
