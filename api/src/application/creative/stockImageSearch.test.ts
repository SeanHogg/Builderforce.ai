import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchStockImages } from './stockImageSearch';

describe('searchStockImages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes and interleaves configured providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes('unsplash.com')) return new Response(JSON.stringify({ results: [{ id: 'u1', urls: { regular: 'https://img/u.jpg', small: 'https://img/u-small.jpg' }, width: 1200, height: 800, alt_description: 'Mountain', user: { name: 'Uma', links: { html: 'https://unsplash.com/uma' } } }] }));
      if (url.includes('pexels.com')) return new Response(JSON.stringify({ photos: [{ id: 2, src: { large2x: 'https://img/p.jpg', medium: 'https://img/p-small.jpg' }, width: 1000, height: 1000, alt: 'Peak', photographer: 'Pat' }] }));
      return new Response(JSON.stringify({ hits: [{ id: 3, largeImageURL: 'https://img/x.jpg', webformatURL: 'https://img/x-small.jpg', imageWidth: 900, imageHeight: 600, tags: 'mountain, dawn', user: 'Pia' }] }));
    }));

    const results = await searchStockImages({ unsplash: 'u', pexels: 'p', pixabay: 'x' }, 'mountain', 3);

    expect(results.map((result) => result.provider)).toEqual(['unsplash', 'pexels', 'pixabay']);
    expect(results[0]).toMatchObject({ url: 'https://img/u.jpg', author: 'Uma', licence: 'Unsplash' });
  });

  it('lets one failed provider degrade without hiding successful results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => String(input).includes('unsplash.com')
      ? new Response('nope', { status: 503 })
      : new Response(JSON.stringify({ photos: [{ id: 2, src: { large: 'https://img/p.jpg' } }] }))));

    await expect(searchStockImages({ unsplash: 'u', pexels: 'p' }, 'team', 4)).resolves.toMatchObject([
      { provider: 'pexels', url: 'https://img/p.jpg' },
    ]);
  });
});
