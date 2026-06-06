'use client';

import Link from 'next/link';
import type { BlogPost } from '@/lib/blogData';

/**
 * Reusable blog article card + grid.
 *
 * Single source of truth for how an article is rendered as a card. Used by
 * the /blog index and by the "Latest from the blog" section on the homepage,
 * so the markup, class names, and styles live here rather than being inlined
 * per page. The styles are emitted once by <ArticleCardStyles /> (rendered
 * automatically by <ArticleCardGrid />); the class names (blog-card*, blog-grid)
 * rely on the global theme CSS variables defined in the app shell.
 */

export interface ArticleCardProps {
  post: BlogPost;
  /** Index in the list — drives the staggered fade-in animation delay. */
  index?: number;
}

export function ArticleCard({ post, index = 0 }: ArticleCardProps) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="blog-card"
      style={{ animationDelay: `${index * 0.07}s` }}
    >
      <div className="blog-card-meta">
        <span className="blog-card-date">
          {new Date(post.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </span>
        {post.tags.slice(0, 1).map((tag) => (
          <span key={tag} className="blog-card-tag">{tag}</span>
        ))}
      </div>

      <h2 className="blog-card-title">{post.title}</h2>
      <p className="blog-card-desc">{post.description}</p>

      {post.author && <p className="blog-card-author">By {post.author}</p>}

      <span className="blog-card-cta">Read article →</span>
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

/** Card + grid styles. Emitted once by <ArticleCardGrid />. */
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
        border-radius: 20px;
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
        font-size: 0.78rem;
        color: var(--text-muted);
        font-family: var(--font-display);
      }
      .blog-card-tag {
        font-size: 0.7rem;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--surface-coral-soft);
        color: var(--coral-bright);
        border: 1px solid var(--border-accent);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .blog-card-title {
        font-family: var(--font-display);
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.3;
      }
      .blog-card-desc {
        font-size: 0.88rem;
        color: var(--text-secondary);
        line-height: 1.65;
        flex: 1;
      }
      .blog-card-author {
        font-size: 0.78rem;
        color: var(--text-muted);
      }
      .blog-card-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--coral-bright);
        font-family: var(--font-display);
        margin-top: 4px;
      }

      @media (max-width: 640px) {
        .blog-grid { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}

export default ArticleCard;
