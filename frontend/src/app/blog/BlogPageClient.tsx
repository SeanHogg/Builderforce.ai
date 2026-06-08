'use client';

import Link from 'next/link';
import { BLOG_POSTS } from '@/lib/blogData';
import JsonLd from '@/components/JsonLd';
import { blogIndexSchema } from '@/lib/structured-data';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';

export default function BlogPageClient() {
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

        /* ── FOOTER ── */
        .blog-footer {
          border-top: 1px solid var(--border-subtle);
          padding: 36px 24px;
          text-align: center;
        }
        .blog-footer-inner {
          max-width: 1100px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        .blog-footer-links {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 2px;
          list-style: none;
        }
        .blog-footer-links a {
          font-size: 0.82rem;
          color: var(--text-muted);
          text-decoration: none;
          padding: 4px 10px;
          border-radius: 6px;
          transition: color 0.2s;
        }
        .blog-footer-links a:hover { color: var(--text-secondary); }
        .blog-footer-copy {
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .blog-footer-copy a {
          color: var(--coral-bright);
          text-decoration: none;
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
          <div className="blog-hero-badge">📝 Latest Articles</div>
          <h1 className="blog-hero-title">Builderforce Blog</h1>
          <p className="blog-hero-desc">
            Deep dives, tutorials, and best practices for building and deploying
            AI agents — from WebGPU LoRA training to multi-agent orchestration.
          </p>
        </div>

        {/* ── Post grid ── */}
        <main className="blog-main">
          <ArticleCardGrid posts={BLOG_POSTS} />
        </main>

        {/* ── Footer ── */}
        <footer className="blog-footer">
          <div className="blog-footer-inner">
            <ul className="blog-footer-links">
              <li><Link href="/">Home</Link></li>
              <li><Link href="/workforce">Workforce Registry</Link></li>
              <li><Link href="/blog">Blog</Link></li>
              <li><Link href="/login">Sign In</Link></li>
              <li><Link href="/register">Get Started</Link></li>
              <li><a href="https://builderforce.ai" target="_blank" rel="noopener">BuilderForce Agents</a></li>
            </ul>
            <p className="blog-footer-copy">
              Built by{' '}
              <a href="https://myvideoresu.me/resumes/seanhogg" target="_blank" rel="noopener">
                Sean Hogg
              </a>
              {' '}· Builderforce.ai © 2026
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
