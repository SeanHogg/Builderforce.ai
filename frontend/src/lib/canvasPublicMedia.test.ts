import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createAssetFromSource: vi.fn() }));
vi.mock('./growthApi', () => ({ growthApi: { createAssetFromSource: mocks.createAssetFromSource } }));

const { canvasMediaSource, isCanvasMediaKind, isPubliclyFetchable, resolvePublicMediaUrls } =
  await import('./canvasPublicMedia');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('canvasMediaSource', () => {
  it('prefers the full render over the preview — posting a thumbnail is posting a worse picture', () => {
    expect(canvasMediaSource({ outputUrl: 'https://cdn/full.png', thumbnailUrl: 'https://cdn/thumb.png' } as never))
      .toBe('https://cdn/full.png');
  });

  it('falls back to the thumbnail rather than attaching nothing', () => {
    expect(canvasMediaSource({ thumbnailUrl: 'https://cdn/thumb.png' } as never)).toBe('https://cdn/thumb.png');
  });

  it('reports no source for a card whose generation has not produced pixels yet', () => {
    expect(canvasMediaSource({ prompt: 'a coniferous landscape' } as never)).toBeNull();
    expect(canvasMediaSource(undefined)).toBeNull();
  });
});

describe('isCanvasMediaKind', () => {
  it('accepts the kinds that can hold a picture and rejects the rest', () => {
    expect(isCanvasMediaKind('image')).toBe(true);
    expect(isCanvasMediaKind('video')).toBe(true);
    expect(isCanvasMediaKind('task')).toBe(false);
    expect(isCanvasMediaKind(null)).toBe(false);
  });
});

describe('isPubliclyFetchable', () => {
  it('is https and nothing else — a network fetches with no session of ours', () => {
    expect(isPubliclyFetchable('https://cdn.example/a.png')).toBe(true);
    expect(isPubliclyFetchable('http://cdn.example/a.png')).toBe(false);
    expect(isPubliclyFetchable(PNG)).toBe(false);
  });
});

/**
 * The gap this closes, stated as a test: Instagram FETCHES media with no session,
 * so a campaign carrying the `data:` URI a generated image lives in was an account
 * silently `skipped` with a blocker nobody could clear from the canvas.
 */
describe('resolvePublicMediaUrls', () => {
  beforeEach(() => {
    mocks.createAssetFromSource.mockReset();
    mocks.createAssetFromSource.mockResolvedValue({ url: 'https://builderforce.ai/gateway/api/campaign-assets/tok' });
  });

  it('publishes an inline picture to a public URL', async () => {
    const resolved = await resolvePublicMediaUrls([PNG], { name: 'Launch' });
    expect(resolved.urls).toEqual(['https://builderforce.ai/gateway/api/campaign-assets/tok']);
    expect(resolved.problems).toEqual([]);
    expect(mocks.createAssetFromSource).toHaveBeenCalledWith({ source: PNG, name: 'Launch' });
  });

  it('leaves an already-public URL alone — re-hosting stock photography buys nothing', async () => {
    const resolved = await resolvePublicMediaUrls(['https://images.example/photo.jpg']);
    expect(resolved.urls).toEqual(['https://images.example/photo.jpg']);
    expect(mocks.createAssetFromSource).not.toHaveBeenCalled();
  });

  it('keeps request order, so the first attachment stays the first', async () => {
    mocks.createAssetFromSource.mockResolvedValueOnce({ url: 'https://public/one' });
    const resolved = await resolvePublicMediaUrls([PNG, 'https://images.example/two.jpg']);
    expect(resolved.urls).toEqual(['https://public/one', 'https://images.example/two.jpg']);
  });

  it('names a blob URL as tab-local instead of uploading an empty file', async () => {
    const resolved = await resolvePublicMediaUrls(['blob:https://builderforce.ai/8f2c']);
    expect(resolved.urls).toEqual([]);
    expect(resolved.problems[0]!.reason).toContain('browser tab');
    expect(mocks.createAssetFromSource).not.toHaveBeenCalled();
  });

  /** One bad picture must not lose the campaign — the other one still publishes,
   *  and the reason travels back so the model can say WHICH failed and why. */
  it('reports a failed upload without dropping the media that worked', async () => {
    mocks.createAssetFromSource
      .mockRejectedValueOnce(new Error('Images must be 2 MB or smaller.'))
      .mockResolvedValueOnce({ url: 'https://public/ok' });
    const resolved = await resolvePublicMediaUrls([PNG, PNG]);
    expect(resolved.urls).toEqual(['https://public/ok']);
    expect(resolved.problems).toHaveLength(1);
    expect(resolved.problems[0]!.reason).toContain('2 MB');
  });

  it('does not put megabytes of base64 into the reason it reports', async () => {
    mocks.createAssetFromSource.mockRejectedValueOnce(new Error('nope'));
    const huge = `data:image/png;base64,${'A'.repeat(5_000)}`;
    const resolved = await resolvePublicMediaUrls([huge]);
    expect(resolved.problems[0]!.source.length).toBeLessThan(120);
  });

  it('skips blanks rather than calling the store with nothing', async () => {
    const resolved = await resolvePublicMediaUrls(['', '   ']);
    expect(resolved.urls).toEqual([]);
    expect(resolved.problems).toEqual([]);
    expect(mocks.createAssetFromSource).not.toHaveBeenCalled();
  });
});
