import { describe, expect, it, vi } from 'vitest';
import { persistGeneratedImages } from './persistGeneratedImages';

function fakeBucket() {
  const put = vi.fn(async () => ({}));
  return { bucket: { put } as unknown as R2Bucket, put };
}

const actor = { tenantId: 7, userId: 'u1' };
const publicOrigin = 'https://api.example.com';

describe('persistGeneratedImages', () => {
  it('stores a data: image and swaps in the public asset URL', async () => {
    const { bucket, put } = fakeBucket();
    const [entry] = await persistGeneratedImages({
      bucket, actor, publicOrigin,
      entries: [{ url: 'data:image/jpeg;base64,QUJD', revised_prompt: 'r' }],
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(entry!.url).toMatch(/^https:\/\/api\.example\.com\/api\/assets\/7\/u1\/\d+-[0-9a-f]{8}\.jpg$/);
    expect(entry!.revised_prompt).toBe('r');
  });

  it('passes hosted URLs and b64_json entries through untouched', async () => {
    const { bucket, put } = fakeBucket();
    const entries = [{ url: 'https://vendor/img.png' }, { b64_json: 'QUJD' }];
    expect(await persistGeneratedImages({ bucket, actor, publicOrigin, entries })).toEqual(entries);
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps the data: URL when storage is unbound', async () => {
    const entries = [{ url: 'data:image/png;base64,QUJD' }];
    expect(await persistGeneratedImages({ bucket: undefined, actor, publicOrigin, entries })).toEqual(entries);
  });
});
