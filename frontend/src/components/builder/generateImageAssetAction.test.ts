import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateImage = vi.fn();
vi.mock('@/lib/imageGenerationApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/imageGenerationApi')>()),
  generateImage: (...args: unknown[]) => generateImage(...args),
}));

import { generateImageAssetAction } from './generateImageAssetAction';

beforeEach(() => generateImage.mockReset());

describe('generate_image_asset', () => {
  const action = generateImageAssetAction();

  it('returns the durable URL the gateway produced', async () => {
    generateImage.mockResolvedValue({ url: 'https://api/api/assets/1/u/x.jpg', model: 'cloudflare/flux' });
    const result = await action.run({ prompt: 'a warm bakery storefront at dawn', size: '1792x1024' });
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'a warm bakery storefront at dawn', size: '1792x1024', useCase: 'studio_image_asset' });
    expect(result).toMatchObject({ url: 'https://api/api/assets/1/u/x.jpg', model: 'cloudflare/flux' });
  });

  it('drops an unsupported size instead of sending it upstream', async () => {
    generateImage.mockResolvedValue({ url: 'u' });
    await action.run({ prompt: 'p', size: '640x480' });
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ size: undefined }));
  });

  it('refuses an empty prompt without calling the gateway', async () => {
    expect(await action.run({ prompt: '  ' })).toEqual({ error: expect.any(String) });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('relays the gateway refusal as a tool error', async () => {
    generateImage.mockRejectedValue(new Error('Daily image credits exhausted'));
    expect(await action.run({ prompt: 'p' })).toEqual({ error: expect.stringContaining('Daily image credits exhausted') });
  });
});
