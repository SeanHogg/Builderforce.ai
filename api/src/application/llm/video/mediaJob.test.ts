import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceMediaJob, mediaJobView, newClipJob, newRenderJob, MEDIA_JOB_DEADLINE_MS, type MediaJobDeps, type MediaJobState } from './mediaJob';
import { VendorFatalError, VendorRetryableError } from '../videoVendors/types';
import { pollinationsVideoModule } from '../videoVendors/pollinations';
import { googleVideoModule } from '../videoVendors/googleai';

afterEach(() => vi.restoreAllMocks());

const MP4 = new Uint8Array([0, 0, 0, 24]).buffer;

function deps(over: Partial<MediaJobDeps> = {}): MediaJobDeps & { stored: string[]; billed: Array<[string, number]> } {
  const stored: string[] = [];
  const billed: Array<[string, number]> = [];
  return {
    vendorEnv: { POLLINATIONS_API_KEY: 'sk_test', GOOGLE_API_KEY: 'g' },
    now: () => 1_000,
    storeMedia: async (_bytes, mimeType, fileName) => { stored.push(`${fileName}:${mimeType}`); return { url: 'https://api/api/assets/7/u/x.mp4', storageKey: '7/u/x.mp4' }; },
    recordClipUsage: async (_job, model, seconds) => { billed.push([model, seconds]); },
    recordFailure: async () => undefined,
    cooledModels: async () => new Set<string>(),
    renderMovie: async () => ({ bytes: MP4, mimeType: 'video/mp4' }),
    ...over,
    stored,
    billed,
  };
}

function clipJob(chain: string[], durationSeconds = 5): MediaJobState {
  return newClipJob({
    id: '00000000-0000-4000-8000-000000000001', tenantId: 7, userId: 'u', product: 'builderforceVideo', useCase: null,
    request: { prompt: 'a fox in snow', durationSeconds, aspectRatio: '16:9' }, chain, now: 1_000,
  });
}

describe('advanceMediaJob — clips', () => {
  it('stores and bills a synchronous vendor clip in one step, at the length the model renders', async () => {
    vi.spyOn(pollinationsVideoModule, 'start').mockResolvedValue({ kind: 'done', bytes: MP4, mimeType: 'video/mp4' });
    const d = deps();
    const step = await advanceMediaJob(clipJob(['pollinations/alibaba/wan-2.2-fast'], 8), d);
    expect(step.nextStepInMs).toBeNull();
    expect(step.state.status).toBe('succeeded');
    expect(step.state.result).toMatchObject({ url: 'https://api/api/assets/7/u/x.mp4', durationSeconds: 5, model: 'pollinations/alibaba/wan-2.2-fast' });
    expect(d.billed).toEqual([['pollinations/alibaba/wan-2.2-fast', 5]]); // wan only renders 5s
    expect(d.stored).toEqual(['clip.mp4:video/mp4']);
  });

  it('cascades to the next model on a retryable failure and records the attempt', async () => {
    vi.spyOn(pollinationsVideoModule, 'start')
      .mockRejectedValueOnce(new VendorRetryableError('pollinations', 'bytedance/seedance-1-pro-fast', 429, 'busy'))
      .mockResolvedValueOnce({ kind: 'done', bytes: MP4, mimeType: 'video/mp4' });
    const d = deps();
    const first = await advanceMediaJob(clipJob(['pollinations/bytedance/seedance-1-pro-fast', 'pollinations/alibaba/wan-2.2-fast']), d);
    expect(first.nextStepInMs).toBe(0);
    expect(first.state.clip?.attempts).toHaveLength(1);
    const second = await advanceMediaJob(first.state, d);
    expect(second.state.status).toBe('succeeded');
    expect(second.state.result?.model).toBe('pollinations/alibaba/wan-2.2-fast');
  });

  it('fails the job on a fatal refusal instead of trying every vendor', async () => {
    vi.spyOn(pollinationsVideoModule, 'start').mockRejectedValue(new VendorFatalError('pollinations', 400, 'prompt refused'));
    const step = await advanceMediaJob(clipJob(['pollinations/alibaba/wan-2.2-fast', 'googleai/veo-3.1-fast-generate-preview']), deps());
    expect(step.state.status).toBe('failed');
    expect(step.state.error).toMatch(/refused/);
  });

  it('parks an async operation and finishes it on a later poll', async () => {
    vi.spyOn(googleVideoModule, 'start').mockResolvedValue({ kind: 'pending', handle: 'models/veo/operations/1', retryAfterMs: 15_000 });
    const poll = vi.spyOn(googleVideoModule, 'poll')
      .mockResolvedValueOnce({ kind: 'pending', handle: 'models/veo/operations/1', retryAfterMs: 15_000 })
      .mockResolvedValueOnce({ kind: 'done', bytes: MP4, mimeType: 'video/mp4' });
    const d = deps();
    const started = await advanceMediaJob(clipJob(['googleai/veo-3.1-fast-generate-preview'], 6), d);
    expect(started.nextStepInMs).toBe(15_000);
    expect(started.state.clip?.pending?.handle).toBe('models/veo/operations/1');
    const stillRunning = await advanceMediaJob(started.state, d);
    expect(stillRunning.nextStepInMs).toBe(15_000);
    const done = await advanceMediaJob(stillRunning.state, d);
    expect(done.state.status).toBe('succeeded');
    expect(poll).toHaveBeenCalledTimes(2);
    expect(d.billed).toEqual([['googleai/veo-3.1-fast-generate-preview', 6]]);
  });

  it('skips vendors without a key and cooled models', async () => {
    const start = vi.spyOn(pollinationsVideoModule, 'start').mockResolvedValue({ kind: 'done', bytes: MP4, mimeType: 'video/mp4' });
    const d = deps({
      vendorEnv: { POLLINATIONS_API_KEY: 'sk_test' }, // no Google key
      cooledModels: async () => new Set(['pollinations/bytedance/seedance-1-pro-fast']),
    });
    const step = await advanceMediaJob(clipJob(['googleai/veo-3.1-fast-generate-preview', 'pollinations/bytedance/seedance-1-pro-fast', 'pollinations/alibaba/wan-2.2-fast']), d);
    expect(step.state.result?.model).toBe('pollinations/alibaba/wan-2.2-fast');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('fails with the attempts listed once the chain is exhausted', async () => {
    vi.spyOn(pollinationsVideoModule, 'start').mockRejectedValue(new VendorRetryableError('pollinations', 'alibaba/wan-2.2-fast', 503, 'down'));
    const d = deps();
    let step = await advanceMediaJob(clipJob(['pollinations/alibaba/wan-2.2-fast']), d);
    step = await advanceMediaJob(step.state, d);
    expect(step.state.status).toBe('failed');
    expect(step.state.error).toContain('pollinations/alibaba/wan-2.2-fast (503)');
  });

  it('gives up after the job deadline', async () => {
    const step = await advanceMediaJob(clipJob(['pollinations/alibaba/wan-2.2-fast']), deps({ now: () => 1_000 + MEDIA_JOB_DEADLINE_MS + 1 }));
    expect(step.state.status).toBe('failed');
  });
});

describe('advanceMediaJob — renders', () => {
  it('stores the rendered movie with its timeline length', async () => {
    const job = newRenderJob({
      id: '00000000-0000-4000-8000-000000000002', tenantId: 7, userId: null, useCase: null, now: 1_000,
      request: { width: 1280, height: 720, fps: 30, backgroundColor: '#000000', items: [
        { url: 'https://a/1.mp4', kind: 'video', track: 'visual', startSeconds: 0, durationSeconds: 5, trimStartSeconds: 0, volume: 1 },
        { url: 'https://a/2.mp4', kind: 'video', track: 'visual', startSeconds: 5, durationSeconds: 4, trimStartSeconds: 0, volume: 1 },
      ] },
    });
    const d = deps();
    const step = await advanceMediaJob(job, d);
    expect(step.state.status).toBe('succeeded');
    expect(step.state.result?.durationSeconds).toBe(9);
    expect(d.billed).toEqual([]); // a render is not a vendor clip
  });

  it('reports a render failure as the job error', async () => {
    const job = newRenderJob({ id: 'x', tenantId: 7, userId: null, useCase: null, now: 1_000, request: { width: 1, height: 1, fps: 1, backgroundColor: '#000000', items: [] } });
    const step = await advanceMediaJob(job, deps({ renderMovie: async () => { throw new Error('ffmpeg exploded'); } }));
    expect(step.state.status).toBe('failed');
    expect(step.state.error).toContain('ffmpeg exploded');
  });
});

describe('mediaJobView', () => {
  it('never exposes the tenant, the chain or a vendor handle', () => {
    const view = mediaJobView(clipJob(['googleai/veo-3.1-fast-generate-preview']));
    expect(view).not.toHaveProperty('tenantId');
    expect(view).not.toHaveProperty('clip');
    expect(view.status).toBe('queued');
  });
});
