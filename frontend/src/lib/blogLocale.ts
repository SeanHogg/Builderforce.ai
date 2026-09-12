import { DEFAULT_LOCALE, isLocale } from '@/i18n/config';
import { postBody, type BlogPost } from './blogData';

/**
 * THE ONE PLACE a blog article is put into the reader's language.
 *
 * ── WHAT IS LOCALIZED, AND WHERE IT LIVES ───────────────────────────────────
 *   · Title + description → the message catalogs, `blog.posts.<slug>.{title,description}`.
 *     The /blog index renders all ~145 of them at once, so they have to arrive
 *     with the page's catalog rather than one fetch per card. The English entry
 *     mirrors the post's front-matter (asserted by `blogLocale.test.ts`), which
 *     stays the source of truth for the English article.
 *   · Tag chips → `blog.tagLabel.<tag>`. The tag ITSELF stays the stable id —
 *     it is the `?tag=` filter value and the topic classifier's input — so only
 *     its label is translated.
 *   · The BODY → `src/content/blog/<slug>.<locale>.md`, beside the English
 *     `<slug>.md`. Body only: no front-matter, no H1 (the title is catalog copy).
 *
 * ── WHY BODIES ARE FETCHED, NOT IMPORTED ────────────────────────────────────
 * The English bodies are already ~1.2 MB of bundled markdown. Four more
 * languages imported the same way would put ~5 MB into every edge function that
 * can reach `blogData` — the exact failure that moved the message catalogs out
 * of the bundle (`i18n/catalog.ts`: "Exceeds maximum edge function size"). So a
 * translated body is DATA: `scripts/publish-blog-translations.mjs` (prebuild)
 * publishes it under `/blog-i18n/<locale>/<slug>.md`, and the post route's
 * server render fetches the one it needs. Missing → the English body, the same
 * degradation the catalogs make: a page in the wrong language is a far smaller
 * failure than a page that does not render.
 */

/**
 * The slice of next-intl's `blog`-scoped translator this module uses. `has` is
 * what lets a post published in English today render its English title in every
 * locale until its translations land, rather than a dotted key.
 */
export interface BlogText {
  (key: string): string;
  has(key: string): boolean;
}

/** Catalog key (under `blog`) for a post's localized title or description. */
export function blogPostKey(slug: string, field: 'title' | 'description'): string {
  return `posts.${slug}.${field}`;
}

/** Catalog key (under `blog`) for a tag chip's label. */
export function blogTagKey(tag: string): string {
  return `tagLabel.${tag}`;
}

/** The post with its title and description in the reader's language. Tags stay
 *  ids (see above); the body is resolved separately by {@link loadPostBody}. */
export function localizePost(post: BlogPost, t: BlogText): BlogPost {
  const titleKey = blogPostKey(post.slug, 'title');
  const descriptionKey = blogPostKey(post.slug, 'description');
  return {
    ...post,
    title: t.has(titleKey) ? t(titleKey) : post.title,
    description: t.has(descriptionKey) ? t(descriptionKey) : post.description,
  };
}

/** A tag's chip label in the reader's language — the tag id when it has none. */
export function blogTagLabel(tag: string, t: BlogText): string {
  const key = blogTagKey(tag);
  return t.has(key) ? t(key) : tag;
}

/**
 * Root-relative URL of a published translated body, versioned by the build so
 * `public/_headers` can mark it immutable (the same contract as `catalogUrl`).
 */
export function blogBodyUrl(slug: string, locale: string): string {
  return `/blog-i18n/${locale}/${slug}.md?v=${process.env.NEXT_PUBLIC_APP_VERSION || 'dev'}`;
}

/**
 * The post's body in `locale`, or the English body if there is no translation
 * (or it cannot be read).
 *
 * @param origin Absolute origin to resolve the asset against — required on the
 *   server (see `i18n/requestOrigin.ts`), ignored for the default locale, which
 *   never leaves the bundle.
 */
export async function loadPostBody(post: BlogPost, locale: string, origin = ''): Promise<string> {
  if (locale === DEFAULT_LOCALE || !isLocale(locale)) return post.content;
  try {
    const response = await fetch(`${origin}${blogBodyUrl(post.slug, locale)}`, { cache: 'force-cache' });
    if (!response.ok) return post.content;
    return postBody(await response.text()) || post.content;
  } catch (error) {
    console.warn(`[blog] "${post.slug}" body unavailable in ${locale} — rendering ${DEFAULT_LOCALE}.`, error);
    return post.content;
  }
}
