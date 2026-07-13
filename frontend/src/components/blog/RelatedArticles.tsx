'use client';

import { getPostsBySlugs, getRelatedByTags, type BlogPost } from '@/lib/blogData';
import { RELATED_ARTICLES } from '@/lib/content';
import { ArticleCardGrid } from './ArticleCard';

/**
 * Reusable "related reading" section that attaches associated blog content to a
 * marketing surface. Single source of truth for the markup; the *which posts*
 * decision lives in RELATED_ARTICLES (content.ts) keyed by surface, so a page
 * opts in with one prop and never hand-lists posts.
 *
 * Resolution order (first non-empty wins):
 *   1. explicit `slugs`
 *   2. `surface` → RELATED_ARTICLES[surface]
 *   3. `relatedToSlug` → posts sharing tags with that post (blog-post footer)
 *
 * The component decides its own visibility: it returns null when there's
 * nothing to show, so consumers can drop it in unconditionally.
 */
export interface RelatedArticlesProps {
  /** Surface key into RELATED_ARTICLES, e.g. 'product', 'compare', 'compare:devin'. */
  surface?: string;
  /** Explicit ordered slugs (overrides `surface`). */
  slugs?: string[];
  /** Show tag-related posts for this slug (used on individual blog posts). */
  relatedToSlug?: string;
  /** Section heading. */
  heading?: string;
  /** Max cards to show. */
  limit?: number;
}

export default function RelatedArticles({
  surface,
  slugs,
  relatedToSlug,
  heading = 'Related reading',
  limit = 3,
}: RelatedArticlesProps) {
  let posts: BlogPost[] = [];
  if (slugs && slugs.length) posts = getPostsBySlugs(slugs);
  else if (surface) posts = getPostsBySlugs(RELATED_ARTICLES[surface] ?? []);
  else if (relatedToSlug) posts = getRelatedByTags(relatedToSlug, limit);

  posts = posts.slice(0, limit);
  if (posts.length === 0) return null;

  return (
    <section className="related-articles" aria-label={heading}>
      <style>{`
        .related-articles {
          max-width: 1100px;
          margin: 0 auto;
          padding: 8px 24px 56px;
          width: 100%;
        }
        .related-articles-head {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.5rem;
          color: var(--text-primary);
          margin: 0 0 6px;
        }
        .related-articles-head .related-accent { color: var(--coral-bright); margin-right: 8px; }
        .related-articles-sub {
          font-size: 0.95rem;
          color: var(--text-secondary);
          margin: 0 0 20px;
        }
        @media (max-width: 640px) { .related-articles { padding: 8px 16px 40px; } }
      `}</style>
      <h2 className="related-articles-head">
        <span className="related-accent">⟩</span>{heading}
      </h2>
      <p className="related-articles-sub">
        Deeper dives from the Builderforce blog on the topics covered here.
      </p>
      <ArticleCardGrid posts={posts} limit={limit} />
    </section>
  );
}
