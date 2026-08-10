import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

export type StockImageProvider = 'unsplash' | 'pexels' | 'pixabay';

export interface StockImageResult {
  provider: StockImageProvider;
  providerAssetId: string;
  url: string;
  thumbnailUrl: string;
  width?: number;
  height?: number;
  title?: string;
  author?: string;
  authorUrl?: string;
  licence: string;
}

export interface StockImageKeys {
  unsplash?: string | null;
  pexels?: string | null;
  pixabay?: string | null;
}

async function json(response: Response, provider: StockImageProvider): Promise<unknown> {
  if (!response.ok) throw new Error(`${provider} image search failed (${response.status})`);
  return response.json();
}

async function unsplash(key: string, query: string, limit: number): Promise<StockImageResult[]> {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(limit));
  url.searchParams.set('content_filter', 'high');
  const body = await json(await fetch(url, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } }), 'unsplash') as { results?: Array<Record<string, any>> };
  return (body.results ?? []).flatMap((item) => {
    const urls = item.urls as Record<string, string> | undefined;
    const imageUrl = urls?.regular ?? urls?.full;
    if (!imageUrl) return [];
    const user = item.user as Record<string, any> | undefined;
    return [{
      provider: 'unsplash' as const, providerAssetId: String(item.id), url: imageUrl,
      thumbnailUrl: urls?.small ?? urls?.thumb ?? imageUrl,
      width: Number(item.width) || undefined, height: Number(item.height) || undefined,
      title: String(item.description ?? item.alt_description ?? '').trim() || undefined,
      author: typeof user?.name === 'string' ? user.name : undefined,
      authorUrl: typeof user?.links?.html === 'string' ? user.links.html : undefined,
      licence: 'Unsplash',
    }];
  });
}

async function pexels(key: string, query: string, limit: number): Promise<StockImageResult[]> {
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(limit));
  const body = await json(await fetch(url, { headers: { Authorization: key } }), 'pexels') as { photos?: Array<Record<string, any>> };
  return (body.photos ?? []).flatMap((item) => {
    const src = item.src as Record<string, string> | undefined;
    const imageUrl = src?.large2x ?? src?.large ?? src?.original;
    if (!imageUrl) return [];
    return [{
      provider: 'pexels' as const, providerAssetId: String(item.id), url: imageUrl,
      thumbnailUrl: src?.medium ?? src?.small ?? imageUrl,
      width: Number(item.width) || undefined, height: Number(item.height) || undefined,
      title: typeof item.alt === 'string' && item.alt.trim() ? item.alt.trim() : undefined,
      author: typeof item.photographer === 'string' ? item.photographer : undefined,
      authorUrl: typeof item.photographer_url === 'string' ? item.photographer_url : undefined,
      licence: 'Pexels',
    }];
  });
}

async function pixabay(key: string, query: string, limit: number): Promise<StockImageResult[]> {
  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(Math.max(3, limit)));
  url.searchParams.set('safesearch', 'true');
  const body = await json(await fetch(url), 'pixabay') as { hits?: Array<Record<string, any>> };
  return (body.hits ?? []).flatMap((item) => {
    const imageUrl = typeof item.largeImageURL === 'string' ? item.largeImageURL : item.webformatURL;
    if (typeof imageUrl !== 'string' || !imageUrl) return [];
    return [{
      provider: 'pixabay' as const, providerAssetId: String(item.id), url: imageUrl,
      thumbnailUrl: typeof item.webformatURL === 'string' ? item.webformatURL : imageUrl,
      width: Number(item.imageWidth) || undefined, height: Number(item.imageHeight) || undefined,
      title: typeof item.tags === 'string' && item.tags.trim() ? item.tags.trim() : undefined,
      author: typeof item.user === 'string' ? item.user : undefined,
      licence: 'Pixabay',
    }];
  });
}

/** Search configured providers concurrently and interleave their results. */
export async function searchStockImages(keys: StockImageKeys, query: string, limit = 12): Promise<StockImageResult[]> {
  const perProvider = Math.max(3, Math.min(20, limit));
  const searches: Array<Promise<StockImageResult[]>> = [];
  if (keys.unsplash) searches.push(unsplash(keys.unsplash, query, perProvider).catch(() => []));
  if (keys.pexels) searches.push(pexels(keys.pexels, query, perProvider).catch(() => []));
  if (keys.pixabay) searches.push(pixabay(keys.pixabay, query, perProvider).catch(() => []));
  const groups = await Promise.all(searches);
  const results: StockImageResult[] = [];
  for (let index = 0; results.length < limit; index += 1) {
    let added = false;
    for (const group of groups) if (group[index]) { results.push(group[index]!); added = true; }
    if (!added) break;
  }
  return results;
}

/** Canonical cached stock-image use case consumed by presentation and agents. */
export async function findStockImages(env: Env, query: string, limit = 12): Promise<StockImageResult[]> {
  const normalizedQuery = query.trim().slice(0, 200);
  const normalizedLimit = Math.max(1, Math.min(20, limit));
  const keys = {
    unsplash: env.UNSPLASH_ACCESS_KEY,
    pexels: env.PEXELS_API_KEY,
    pixabay: env.PIXABAY_API_KEY,
  };
  if (!keys.unsplash && !keys.pexels && !keys.pixabay) throw new Error('Stock image search is not configured');
  return getOrSetCached(
    env,
    `creative:image-search:${encodeURIComponent(normalizedQuery.toLowerCase())}:l:${normalizedLimit}`,
    () => searchStockImages(keys, normalizedQuery, normalizedLimit),
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}
