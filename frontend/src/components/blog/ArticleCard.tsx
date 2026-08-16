'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { BlogPost } from '@/lib/blogData';

/**
 * Reusable blog article card + grid + list rows.
 *
 * Single source of truth for how an article is rendered in a collection. Used by
 * the /blog index (both layouts of its Card | List toggle), by "Related
 * articles" under a post, and by the "Latest from the blog" section on the
 * homepage, so the markup, class names, and styles live here rather than being
 * inlined per page. The styles are emitted once by <ArticleCardStyles />
 * (rendered automatically by <ArticleCardGrid /> and <ArticleRows />); the class
 * names (blog-card*, blog-grid, blog-row*) rely on the global theme CSS
 * variables defined in the app shell.
 *
 * The date is formatted in the ACTIVE locale. It was pinned to `en-US`, which
 * printed "August 14, 2026" on all five language builds of a page whose every
 * other string was translated.
 */

/** Shared date formatting, so a card and a row can never disagree on the date. */
function useArticleDate(): (iso: string) => string {
  const locale = useLocale();
  return (iso: string) => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  };
}

export interface ArticleCardProps {
  post: BlogPost;
  /** Index in the list — drives the staggered fade-in animation delay. */
  index?: number;
}

export function ArticleCard({ post, index = 0 }: ArticleCardProps) {
  const t = useTranslations('blog');
  const formatDate = useArticleDate();

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="blog-card"
      style={{ animationDelay: `${index * 0.07}s` }}
    >
      <div className="blog-card-meta">
        <span className="blog-card-date">{formatDate(post.date)}</span>
        {post.tags.slice(0, 1).map((tag) => (
          <span key={tag} className="blog-card-tag">{tag}</span>
        ))}
      </div>

      <h2 className="blog-card-title">{post.title}</h2>
      <p className="blog-card-desc">{post.description}</p>

      {post.author && <p className="blog-card-author">{t('post.byline', { author: post.author })}</p>}

      <span className="blog-card-cta">{t('readArticle')}</span>
    </Link>
  );
}

export interface ArticleCardGridProps {
  posts: BlogPost[];
  /** Cap the number of cards shown (e.g. 3 for a homepage teaser). */
  limit?: number;
  /** Extra class on the grid wrapper for page-specific overrides. */
  className?: string;
}

export function ArticleCardGrid({ posts, limit, className }: ArticleCardGridProps) {
  const visible = typeof limit === 'number' ? posts.slice(0, limit) : posts;
  return (
    <>
      <ArticleCardStyles />
      <div className={className ? `blog-grid ${className}` : 'blog-grid'}>
        {visible.map((post, i) => (
          <ArticleCard key={post.slug} post={post} index={i} />
        ))}
      </div>
    </>
  );
}

/**
 * The "List" layout of the same articles.
 *
 * Not a `<table>`, unlike the other catalogues' list views: every row here is a
 * single link to one destination, and wrapping that in a grid of cells costs a
 * screen-reader user the one thing the row is for. It reads as a dense list and
 * behaves as a list of links.
 */
export function ArticleRows({ posts, className }: { posts: BlogPost[]; className?: string }) {
  const t = useTranslations('blog');
  const formatDate = useArticleDate();

  return (
    <>
      <ArticleCardStyles />
      <ul className={className ? `blog-rows ${className}` : 'blog-rows'}>
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/blog/${post.slug}`} className="blog-row">
              <div className="blog-row-main">
                <h2 className="blog-row-title">{post.title}</h2>
                <p className="blog-row-desc">{post.description}</p>
                <div className="blog-row-meta">
                  <span>{formatDate(post.date)}</span>
                  {post.author && <span>{t('post.byline', { author: post.author })}</span>}
                  {post.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="blog-card-tag">{tag}</span>
                  ))}
                </div>
              </div>
              <span className="blog-row-cta" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Card + grid + row styles. Emitted once by the grid and the list. */
export function ArticleCardStyles() {
  return (
    <style>{`
      .blog-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 24px;
      }

      @keyframes blog-card-fadeInUp {
        from { opacity: 0; transform: translateY(18px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .blog-card {
        background: var(--surface-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-xl);
        padding: 28px 24px;
        backdrop-filter: blur(12px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        text-decoration: none;
        color: inherit;
        transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        animation: blog-card-fadeInUp 0.6s ease-out both;
      }
      .blog-card:hover {
        border-color: var(--border-accent);
        transform: translateY(-5px);
        box-shadow:
          0 20px 52px var(--shadow-coral-soft),
          inset 0 1px 0 var(--surface-inset-highlight);
      }
      .blog-card-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .blog-card-date {
        font-size: var(--font-size-small);
        color: var(--text-muted);
        font-family: var(--font-display);
      }
      .blog-card-tag {
        font-size: var(--font-size-eyebrow);
        font-weight: 600;
        padding: 2px 8px;
        border-radius: var(--radius-full);
        background: var(--surface-coral-soft);
        color: var(--coral-bright);
        border: 1px solid var(--border-accent);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .blog-card-title {
        font-family: var(--font-display);
        font-size: var(--font-size-card-title);
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.3;
      }
      .blog-card-desc {
        font-size: var(--font-size-small);
        color: var(--text-secondary);
        line-height: 1.65;
        flex: 1;
      }
      .blog-card-author {
        font-size: var(--font-size-small);
        color: var(--text-muted);
      }
      .blog-card-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--font-size-small);
        font-weight: 600;
        color: var(--coral-bright);
        font-family: var(--font-display);
        margin-top: 4px;
      }

      /* ── LIST VIEW ── */
      .blog-rows {
        list-style: none;
        margin: 0;
        padding: 0;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        background: var(--surface-card);
        overflow: hidden;
      }
      .blog-rows > li + li { border-top: 1px solid var(--border-subtle); }
      .blog-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        text-decoration: none;
        color: inherit;
        transition: background 0.2s ease;
      }
      .blog-row:hover { background: var(--surface-coral-soft); }
      .blog-row-main { min-width: 0; flex: 1; }
      .blog-row-title {
        font-family: var(--font-display);
        font-size: var(--font-size-body);
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.35;
        margin: 0 0 4px;
      }
      .blog-row-desc {
        font-size: var(--font-size-small);
        color: var(--text-secondary);
        line-height: 1.55;
        margin: 0 0 8px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .blog-row-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        font-size: var(--font-size-small);
        color: var(--text-muted);
      }
      .blog-row-cta {
        color: var(--coral-bright);
        font-size: var(--font-size-card-title);
        flex-shrink: 0;
      }

      @media (max-width: 640px) {
        .blog-grid { grid-template-columns: 1fr; }
        .blog-row { padding: 14px 14px; }
        .blog-row-cta { display: none; }
      }
    `}</style>
  );
}

export default ArticleCard;
