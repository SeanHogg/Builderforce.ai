import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiRequest }));

import { generateVideoClip, startServerMovieRender, startVideoClip, videoJobSource, waitForVideoJob, type VideoJob } from './videoGenerationApi';

const RESULT = { url: 'https://api/api/assets/1/v/a.mp4', storageKey: '1/v/a.mp4', mimeType: 'video/mp4', durationSeconds: 5, model: 'wan' };

beforeEach(() => { apiRequest.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('startVideoClip', () => {
  it('posts the gateway body, omitting what the caller left out', async () => {
    apiRequest.mockResolvedValue({ id: 'j', kind: 'clip', status: 'queued' });
    await startVideoClip({ prompt: 'a fox', useCase: 'test' });
    const [path, init] = apiRequest.mock.calls[0]!;
    expect(path).toBe('/llm/v1/videos/generations');
    expect(JSON.parse(init.body)).toEqual({ prompt: 'a fox', useCase: 'test' });
  });

  it('maps duration, aspect and first frame onto the wire names', async () => {
    apiRequest.mockResolvedValue({ id: 'j', kind: 'clip', status: 'queued' });
    await startVideoClip({ prompt: 'a fox', durationSeconds: 8, aspectRatio: '9:16', imageUrl: 'https://x/f.png', useCase: 'test' });
    expect(JSON.parse(apiRequest.mock.calls[0]![1].body)).toEqual({ prompt: 'a fox', duration: 8, aspect_ratio: '9:16', image_url: 'https://x/f.png', useCase: 'test' });
  });
});

describe('startServerMovieRender', () => {
  it('posts the timeline and sources to the render endpoint', async () => {
    apiRequest.mockResolvedValue({ id: 'r', kind: 'render', status: 'queued' });
    await startServerMovieRender({ timeline: { clips: [] } as never, sources: [], useCase: 'test' });
    expect(apiRequest.mock.calls[0]![0]).toBe('/llm/v1/videos/renders');
  });
});

describe('waitForVideoJob', () => {
  it('polls until the job succeeds and reports every read', async () => {
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({ id: 'j', kind: 'clip', status: 'running' })
      .mockResolvedValueOnce({ id: 'j', kind: 'clip', status: 'succeeded', result: RESULT });
    const updates: VideoJob[] = [];
    const done = waitForVideoJob('j', { onUpdate: (job) => updates.push(job) });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(done).resolves.toMatchObject({ status: 'succeeded' });
    expect(updates.map((job) => job.status)).toEqual(['running', 'succeeded']);
    expect(apiRequest).toHaveBeenCalledWith('/llm/v1/videos/jobs/j');
  });

  it("throws the job's own failure reason", async () => {
    apiRequest.mockResolvedValue({ id: 'j', kind: 'clip', status: 'failed', error: 'Every video model failed' });
    await expect(waitForVideoJob('j')).rejects.toThrow('Every video model failed');
  });

  it('stops waiting when aborted', async () => {
    vi.useFakeTimers();
    apiRequest.mockResolvedValue({ id: 'j', kind: 'clip', status: 'running' });
    const controller = new AbortController();
    const waiting = waitForVideoJob('j', { signal: controller.signal });
    const assertion = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
  });
});

describe('videoJobSource / generateVideoClip', () => {
  it('turns a finished job into stored canvas media', () => {
    expect(videoJobSource({ id: 'j', kind: 'clip', status: 'succeeded', result: RESULT }, 'a.mp4')).toEqual({
      id: 'j', kind: 'video', captureKind: 'ai', url: RESULT.url, fileName: 'a.mp4', mimeType: 'video/mp4', durationSeconds: 5, storageKey: RESULT.storageKey,
    });
  });

  it('refuses a job with no result', () => {
    expect(() => videoJobSource({ id: 'j', kind: 'clip', status: 'running' }, 'a.mp4')).toThrow();
  });

  it('starts and waits in one call', async () => {
    apiRequest
      .mockResolvedValueOnce({ id: 'j', kind: 'clip', status: 'queued' })
      .mockResolvedValueOnce({ id: 'j', kind: 'clip', status: 'succeeded', result: RESULT });
    const { source } = await generateVideoClip({ prompt: 'a fox in snow', useCase: 'test' });
    expect(source).toMatchObject({ url: RESULT.url, fileName: 'a fox in snow.mp4' });
  });
});
