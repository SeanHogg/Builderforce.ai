'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BLOG_POSTS } from '@/lib/blogData';
import JsonLd from '@/components/JsonLd';
import { blogIndexSchema } from '@/lib/structured-data';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';

/** Articles per page on the /blog index. */
const PAGE_SIZE = 9;

export default function BlogPageClient() {
  const t = useTranslations('blog');
  const totalPages = Math.max(1, Math.ceil(BLOG_POSTS.length / PAGE_SIZE));
  const [page, setPage] = useState(1);
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const visible = BLOG_POSTS.slice(start, start + PAGE_SIZE);

  const goTo = (p: number) => {
    setPage(p);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <style>{`
        .blog-page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* ── HERO ── */
        .blog-hero {
          max-width: 1100px;
          margin: 0 auto;
          padding: 44px 24px 40px;
          text-align: center;
          animation: blog-fadeInUp 0.7s ease-out both;
        }
        @keyframes blog-fadeInUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .blog-hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--surface-coral-soft);
          border: 1px solid var(--border-accent);
          border-radius: 999px;
          padding: 5px 16px;
          font-family: var(--font-display);
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--coral-bright);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 20px;
        }
        .blog-hero-title {
          font-family: var(--font-display);
          font-size: clamp(2rem, 5vw, 3.2rem);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.1;
          background: linear-gradient(135deg, var(--hero-title-start) 0%, var(--coral-bright) 46%, var(--hero-title-end) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 16px;
        }
        .blog-hero-desc {
          font-size: 1.05rem;
          color: var(--text-secondary);
          max-width: 520px;
          margin: 0 auto;
          line-height: 1.7;
        }

        /* ── POST GRID ── */
        .blog-main {
          flex: 1;
          max-width: 1100px;
          margin: 0 auto;
          padding: 8px 24px 72px;
          width: 100%;
        }
        /* Card + grid styles live in components/blog/ArticleCard.tsx */

        /* ── PAGINATION ── */
        .blog-pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 48px;
        }
        .blog-page-btn {
          min-width: 40px;
          height: 40px;
          padding: 0 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          border: 1px solid var(--border-subtle);
          background: var(--surface-card);
          color: var(--text-secondary);
          font-family: var(--font-display);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
        }
        .blog-page-btn:hover:not(:disabled) {
          border-color: var(--border-accent);
          color: var(--text-primary);
        }
        .blog-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .blog-page-btn.is-active {
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark));
          border-color: transparent;
          color: #fff;
        }

        @media (max-width: 640px) {
          .blog-hero { padding: 40px 20px 24px; }
          .blog-main { padding: 8px 16px 48px; }
        }
      `}</style>

      <JsonLd data={blogIndexSchema(BLOG_POSTS)} />

      <div className="blog-page">
        {/* ── Hero ── */}
        <div className="blog-hero">
          <div className="blog-hero-badge">📝 {t('badge')}</div>
          <h1 className="blog-hero-title">Builderforce Blog</h1>
          <p className="blog-hero-desc">{t('desc')}</p>
        </div>

        {/* ── Post grid ── */}
        <main className="blog-main">
          <ArticleCardGrid posts={visible} />

          {totalPages > 1 && (
            <nav className="blog-pagination" aria-label={t('paginationLabel')}>
              <button
                type="button"
                className="blog-page-btn"
                onClick={() => goTo(current - 1)}
                disabled={current === 1}
                aria-label={t('prevPage')}
              >
                ←
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`blog-page-btn${p === current ? ' is-active' : ''}`}
                  onClick={() => goTo(p)}
                  aria-current={p === current ? 'page' : undefined}
                  aria-label={t('pageN', { n: p })}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                className="blog-page-btn"
                onClick={() => goTo(current + 1)}
                disabled={current === totalPages}
                aria-label={t('nextPage')}
              >
                →
              </button>
            </nav>
          )}
        </main>

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
