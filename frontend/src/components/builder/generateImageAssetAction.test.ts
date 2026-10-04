import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { generateImage as GenerateImage } from '@/lib/imageGenerationApi';
import { generateImageAssetAction } from './generateImageAssetAction';

const generateImage = vi.fn<typeof GenerateImage>();
const action = generateImageAssetAction(generateImage);

beforeEach(() => generateImage.mockReset());

describe('generate_image_asset', () => {
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
    generateImage.mockImplementation(async () => { throw new Error('Daily image credits exhausted'); });
    expect(await action.run({ prompt: 'p' })).toEqual({ error: 'Daily image credits exhausted' });
  });
});
