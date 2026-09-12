import { headers } from 'next/headers';
import { BRAND } from '@/lib/content';

/**
 * Absolute origin of the current request — what a server render resolves a
 * published static asset against (a message catalog, a translated blog body).
 *
 * A worker has no implicit base URL, and the deployed host differs per
 * environment (production, a Pages preview, `next dev`), so it comes from the
 * request. `BRAND.url` is the last resort rather than the default: a preview
 * deploy must read ITS OWN assets, not production's.
 *
 * One reader, shared by `request.ts` (catalogs) and the blog post route
 * (translated bodies) — both fetch a per-locale asset from the same deploy.
 */
export async function requestOrigin(): Promise<string> {
  const head = await headers();
  const host = head.get('host');
  if (!host) return BRAND.url;
  const protocol = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}
