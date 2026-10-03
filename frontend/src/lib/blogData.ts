/**
 * Blog post metadata — the index of every published article.
 *
 * Posts are Markdown files in src/content/blog/ (front-matter + body). Their
 * front-matter is compiled into `blogIndex.generated.json` by
 * `scripts/publish-blog-content.mjs`, which derives the post list from the
 * directory itself, so a new `<slug>.md` is published by existing.
 *
 * This module carries NO article bodies, which is what makes it safe to import
 * from client components (post cards, related reading, the blog index). A body is
 * fetched by the post route only — see `loadPostBody` in `blogLocale.ts`.
 */

import BLOG_INDEX from './blogIndex.generated.json';

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  description: string;
  tags: string[];
  author: string;
}

/**
 * A post file's renderable body: front-matter removed, and the leading `# Title`
 * H1 that duplicates the page title shown above the content stripped. Only a
 * single top-level ATX heading (# followed by a space) goes, never ##/###.
 *
 * One rule for every body — the English original and each `<slug>.<locale>.md`
 * translation are cleaned the same way, or there would be two answers to "where
 * does this article start".
 */
export function postBody(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return (match ? match[1] : raw).trim().replace(/^# [^\n]*\r?\n?/, '').trim();
}

/** All published blog posts, sorted newest-first (the generator owns the order). */
export const BLOG_POSTS: BlogPost[] = BLOG_INDEX;

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/**
 * Resolve an explicit, ordered list of slugs to their posts (missing slugs are
 * skipped). Used to attach curated "related reading" to marketing surfaces via
 * the RELATED_ARTICLES map in content.ts — single source of truth for which
 * articles back which page.
 */
export function getPostsBySlugs(slugs: string[]): BlogPost[] {
  return slugs.map((s) => getPostBySlug(s)).filter((p): p is BlogPost => Boolean(p));
}

/**
 * Find posts related to a given post by shared tags, newest-first, excluding the
 * post itself. Powers the "Related articles" block at the foot of each blog post
 * without hand-maintaining a per-post list.
 */
export function getRelatedByTags(slug: string, limit = 3): BlogPost[] {
  const post = getPostBySlug(slug);
  if (!post) return [];
  const tags = new Set(post.tags);
  return BLOG_POSTS.filter((p) => p.slug !== slug)
    .map((p) => ({ post: p, overlap: p.tags.filter((t) => tags.has(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => (b.overlap - a.overlap) || (a.post.date < b.post.date ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.post);
}
