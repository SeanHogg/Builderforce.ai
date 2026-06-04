'use client';

import Link from 'next/link';
import { BLOG_POSTS } from '@/lib/blogData';
import JsonLd from '@/components/JsonLd';
import { blogIndexSchema } from '@/lib/structured-data';

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
          padding: 64px 24px 40px;
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
        .blog-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 24px;
        }

        /* ── POST CARD ── */
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
          animation: blog-fadeInUp 0.6s ease-out both;
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
          .blog-grid { grid-template-columns: 1fr; }
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
          <div className="blog-grid">
            {BLOG_POSTS.map((post, i) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="blog-card"
                style={{ animationDelay: `${i * 0.07}s` }}
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

                {post.author && (
                  <p className="blog-card-author">By {post.author}</p>
                )}

                <span className="blog-card-cta">Read article →</span>
              </Link>
            ))}
          </div>
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
