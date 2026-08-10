/**
 * Server-safe read helpers for the public, indexable marketplace detail surface
 * (`/marketplace/[slug]`) and sitemap. No client-only imports (localStorage,
 * auth) so they are usable from server components and `sitemap.ts`. Reads hit
 * the public, cached `?seo=1` endpoint (no download-counter side effect). [1333]
 *
 * The request itself goes through `lib/publicApi` — the one uncredentialed
 * server read, which owns the base URL, the data-cache window and the
 * degrade-to-null contract this file used to carry a private copy of.
 */

import { publicApiGet } from './publicApi';

export interface PublishedSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string | null;
  tags: string[];
  version: string | null;
  readme: string | null;
  icon_url: string | null;
  repo_url: string | null;
  downloads: number | null;
  likes: number | null;
  author_username: string | null;
  author_display_name: string | null;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
    } catch {
      return raw.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }
  return [];
}

/** Fetch one published skill for SSR/metadata. Returns null on miss/error. */
export async function getPublishedSkill(slug: string): Promise<PublishedSkill | null> {
  const body = await publicApiGet<{ skill?: Record<string, unknown> }>(
    `/marketplace/skills/${encodeURIComponent(slug)}?seo=1`,
  );
  const s = body?.skill;
  if (!s) return null;
  return {
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    slug: String(s.slug ?? slug),
    description: String(s.description ?? ''),
    category: (s.category as string) ?? null,
    tags: parseTags(s.tags),
    version: (s.version as string) ?? null,
    readme: (s.readme as string) ?? null,
    icon_url: (s.icon_url as string) ?? null,
    repo_url: (s.repo_url as string) ?? null,
    downloads: typeof s.downloads === 'number' ? s.downloads : null,
    likes: typeof s.likes === 'number' ? s.likes : null,
    author_username: (s.author_username as string) ?? null,
    author_display_name: (s.author_display_name as string) ?? null,
  };
}

/** Published skill slugs for the sitemap. Best-effort; empty on error. */
export async function listPublishedSkillSlugs(limit = 500): Promise<string[]> {
  const body = await publicApiGet<{ skills?: { slug?: string }[] }>(`/marketplace/skills?limit=${limit}`);
  return (body?.skills ?? [])
    .map((s) => s.slug)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}
