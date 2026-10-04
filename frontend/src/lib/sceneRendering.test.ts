import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasSceneShot } from '@builderforce/creation-canvas-contract';

const api = vi.hoisted(() => ({
  startVideoClip: vi.fn(),
  waitForVideoJob: vi.fn(),
}));

vi.mock('./videoGenerationApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./videoGenerationApi')>()),
  startVideoClip: api.startVideoClip,
  waitForVideoJob: api.waitForVideoJob,
}));

import { renderSceneShots } from './sceneRendering';

function shot(id: string, extra: Partial<CanvasSceneShot> = {}): CanvasSceneShot {
  return { id, action: id, prompt: `prompt ${id}`, camera: 'wide', durationSeconds: 5, status: 'pending', ...extra };
}

function succeeded(id: string) {
  return { id, kind: 'clip', status: 'succeeded', result: { url: `https://x/${id}.mp4`, storageKey: `k/${id}`, mimeType: 'video/mp4', durationSeconds: 5 } };
}

beforeEach(() => {
  api.startVideoClip.mockReset();
  api.waitForVideoJob.mockReset();
});

describe('renderSceneShots', () => {
  it('renders every shot without a clip and reports each one', async () => {
    api.startVideoClip.mockImplementation(async (args: { prompt: string }) => ({ id: `job-${args.prompt}`, kind: 'clip', status: 'queued' }));
    api.waitForVideoJob.mockImplementation(async (id: string) => succeeded(id));
    const patches: Array<[string, Partial<CanvasSceneShot>]> = [];
    const summary = await renderSceneShots([shot('a'), shot('b')], { aspectRatio: '9:16', useCase: 'test', onShot: (id, patch) => patches.push([id, patch]) });
    expect(summary).toEqual({ done: 2, failed: 0 });
    expect(api.startVideoClip).toHaveBeenCalledWith({ prompt: 'prompt a', durationSeconds: 5, aspectRatio: '9:16', useCase: 'test' });
    const done = patches.filter(([, patch]) => patch.status === 'done');
    expect(done.map(([id]) => id).sort()).toEqual(['a', 'b']);
    expect(done[0]![1].output).toMatchObject({ kind: 'video', mimeType: 'video/mp4' });
  });

  it('skips shots that already have a clip and resumes one still rendering', async () => {
    api.waitForVideoJob.mockImplementation(async (id: string) => succeeded(id));
    const output = { id: 'o', kind: 'video' as const, captureKind: 'ai' as const, url: 'u', fileName: 'f', mimeType: 'video/mp4', durationSeconds: 5 };
    const summary = await renderSceneShots([
      shot('done', { status: 'done', output }),
      shot('resumed', { status: 'rendering', jobId: 'existing-job' }),
    ], { aspectRatio: '16:9', useCase: 'test', onShot: () => {} });
    expect(summary).toEqual({ done: 1, failed: 0 });
    expect(api.startVideoClip).not.toHaveBeenCalled();
    expect(api.waitForVideoJob).toHaveBeenCalledWith('existing-job', {});
  });

  it('marks a failed shot and keeps rendering the rest', async () => {
    api.startVideoClip.mockImplementation(async (args: { prompt: string }) => {
      if (args.prompt === 'prompt bad') throw new Error('Daily video generation limit reached');
      return { id: 'job-good', kind: 'clip', status: 'queued' };
    });
    api.waitForVideoJob.mockImplementation(async (id: string) => succeeded(id));
    const patches: Array<[string, Partial<CanvasSceneShot>]> = [];
    const summary = await renderSceneShots([shot('bad'), shot('good')], { aspectRatio: '16:9', useCase: 'test', onShot: (id, patch) => patches.push([id, patch]) });
    expect(summary).toEqual({ done: 1, failed: 1 });
    expect(patches).toContainEqual(['bad', expect.objectContaining({ status: 'failed', error: 'Daily video generation limit reached' })]);
  });
});
