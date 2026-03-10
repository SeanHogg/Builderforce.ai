'use client';

export const runtime = 'edge';

import { use } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { getPostBySlug } from '@/lib/blogData';

export default function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const post = getPostBySlug(slug);

  return (
    <>
      <style>{`
        .bpost-page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* ── NAV ── */
        .bpost-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .bpost-nav-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 24px;
          height: 62px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .bpost-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--text-primary);
        }
        .bpost-nav-logo img {
          width: 32px;
          height: 32px;
          object-fit: contain;
          filter: drop-shadow(0 0 10px var(--logo-glow));
          transition: filter 0.3s ease, transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
        }
        .bpost-nav-logo:hover img {
          filter: drop-shadow(0 0 18px var(--logo-glow-hover));
          transform: scale(1.12) rotate(-6deg);
        }
        .bpost-nav-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .bpost-nav-link {
          font-size: 0.875rem;
          color: var(--text-secondary);
          text-decoration: none;
          padding: 6px 12px;
          border-radius: 8px;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .bpost-nav-link:hover {
          color: var(--text-primary);
          background: var(--surface-interactive);
        }
        .bpost-nav-cta {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 18px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark));
          color: #fff;
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.875rem;
          text-decoration: none;
          box-shadow: 0 4px 14px var(--shadow-coral-mid);
          transition: all 0.25s ease;
        }
        .bpost-nav-cta:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 22px var(--shadow-coral-strong);
        }

        /* ── ARTICLE ── */
        .bpost-main {
          flex: 1;
          max-width: 780px;
          margin: 0 auto;
          padding: 48px 24px 80px;
          width: 100%;
          animation: bpost-fadeInUp 0.6s ease-out both;
        }
        @keyframes bpost-fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .bpost-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.875rem;
          color: var(--coral-bright);
          text-decoration: none;
          margin-bottom: 28px;
          font-family: var(--font-display);
          font-weight: 500;
          transition: gap 0.2s ease;
        }
        .bpost-back:hover { gap: 10px; }

        .bpost-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .bpost-date {
          font-size: 0.82rem;
          color: var(--text-muted);
          font-family: var(--font-display);
        }
        .bpost-tag {
          font-size: 0.7rem;
          font-weight: 600;
          padding: 2px 9px;
          border-radius: 999px;
          background: var(--surface-coral-soft);
          color: var(--coral-bright);
          border: 1px solid var(--border-accent);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .bpost-author {
          font-size: 0.82rem;
          color: var(--text-muted);
        }

        .bpost-title {
          font-family: var(--font-display);
          font-size: clamp(1.8rem, 4vw, 2.8rem);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.15;
          color: var(--text-primary);
          margin-bottom: 12px;
        }

        .bpost-description {
          font-size: 1.05rem;
          color: var(--text-secondary);
          line-height: 1.7;
          margin-bottom: 36px;
          padding-bottom: 36px;
          border-bottom: 1px solid var(--border-subtle);
        }

        /* ── MARKDOWN CONTENT ── */
        .bpost-content {
          font-size: 0.97rem;
          line-height: 1.8;
          color: var(--text-secondary);
        }
        .bpost-content h1,
        .bpost-content h2,
        .bpost-content h3,
        .bpost-content h4 {
          font-family: var(--font-display);
          font-weight: 700;
          color: var(--text-primary);
          margin: 2em 0 0.6em;
          line-height: 1.25;
        }
        .bpost-content h1 { font-size: 1.9rem; letter-spacing: -0.025em; }
        .bpost-content h2 { font-size: 1.4rem; letter-spacing: -0.02em; }
        .bpost-content h3 { font-size: 1.15rem; }
        .bpost-content h4 { font-size: 1rem; }
        .bpost-content p { margin: 0 0 1.2em; }
        .bpost-content ul,
        .bpost-content ol {
          margin: 0 0 1.2em 1.4em;
          padding: 0;
        }
        .bpost-content li { margin: 0.35em 0; }
        .bpost-content blockquote {
          margin: 1.5em 0;
          padding: 14px 20px;
          border-left: 3px solid var(--coral-bright);
          background: var(--surface-coral-soft);
          border-radius: 0 12px 12px 0;
          color: var(--text-primary);
          font-style: italic;
        }
        .bpost-content code {
          font-family: var(--font-mono);
          font-size: 0.87em;
          background: var(--bg-elevated, rgba(255,255,255,0.07));
          padding: 2px 6px;
          border-radius: 5px;
          color: var(--cyan-bright);
        }
        .bpost-content pre {
          margin: 1.4em 0;
          padding: 20px 22px;
          background: var(--bg-elevated, rgba(0,0,0,0.35));
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          overflow-x: auto;
        }
        .bpost-content pre code {
          background: none;
          padding: 0;
          border-radius: 0;
          font-size: 0.88rem;
          color: var(--text-secondary);
        }
        .bpost-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.4em 0;
          font-size: 0.9rem;
        }
        .bpost-content th,
        .bpost-content td {
          padding: 10px 14px;
          border: 1px solid var(--border-subtle);
          text-align: left;
        }
        .bpost-content th {
          background: var(--surface-card);
          font-family: var(--font-display);
          font-weight: 600;
          color: var(--text-primary);
        }
        .bpost-content tr:nth-child(even) td {
          background: var(--surface-card);
        }
        .bpost-content a {
          color: var(--coral-bright);
          text-decoration: underline;
          text-decoration-color: transparent;
          transition: text-decoration-color 0.2s;
        }
        .bpost-content a:hover { text-decoration-color: var(--coral-bright); }
        .bpost-content strong { color: var(--text-primary); font-weight: 600; }
        .bpost-content hr {
          border: none;
          border-top: 1px solid var(--border-subtle);
          margin: 2em 0;
        }

        /* ── FOOTER ── */
        .bpost-footer {
          border-top: 1px solid var(--border-subtle);
          padding: 36px 24px;
          text-align: center;
        }
        .bpost-footer-inner {
          max-width: 1100px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        .bpost-footer-links {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 2px;
          list-style: none;
        }
        .bpost-footer-links a {
          font-size: 0.82rem;
          color: var(--text-muted);
          text-decoration: none;
          padding: 4px 10px;
          border-radius: 6px;
          transition: color 0.2s;
        }
        .bpost-footer-links a:hover { color: var(--text-secondary); }
        .bpost-footer-copy {
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .bpost-footer-copy a {
          color: var(--coral-bright);
          text-decoration: none;
        }

        @media (max-width: 640px) {
          .bpost-main { padding: 32px 16px 56px; }
        }
      `}</style>

      <div className="bpost-page">
        {/* ── Nav ── */}
        <nav className="bpost-nav">
          <div className="bpost-nav-inner">
            <Link href="/" className="bpost-nav-logo">
              <Image src="/claw.png" alt="" width={32} height={32} priority />
              Builderforce.ai
            </Link>
            <div className="bpost-nav-right">
              <Link href="/workforce" className="bpost-nav-link">Workforce</Link>
              <Link href="/blog" className="bpost-nav-link">Blog</Link>
              <Link href="/login" className="bpost-nav-link">Sign In</Link>
              <ThemeToggleButton />
              <Link href="/register" className="bpost-nav-cta">
                Get Started Free →
              </Link>
            </div>
          </div>
        </nav>

        {/* ── Content ── */}
        <main className="bpost-main">
          <Link href="/blog" className="bpost-back">← Back to Blog</Link>

          {!post ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-secondary)' }}>
              <p style={{ fontSize: '3rem', marginBottom: 16 }}>📄</p>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: 8 }}>
                Post not found
              </h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
                This article doesn&apos;t exist or has been moved.
              </p>
              <Link href="/blog" style={{ color: 'var(--coral-bright)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                Browse all articles →
              </Link>
            </div>
          ) : (
            <>
              <div className="bpost-meta">
                <span className="bpost-date">
                  {new Date(post.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
                {post.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="bpost-tag">{tag}</span>
                ))}
                {post.author && <span className="bpost-author">By {post.author}</span>}
              </div>

              <h1 className="bpost-title">{post.title}</h1>
              <p className="bpost-description">{post.description}</p>

              <div className="bpost-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {post.content}
                </ReactMarkdown>
              </div>

              <div style={{ marginTop: 48, paddingTop: 32, borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <Link href="/blog" style={{ fontSize: '0.9rem', color: 'var(--coral-bright)', fontFamily: 'var(--font-display)', fontWeight: 600, textDecoration: 'none' }}>
                  ← Back to Blog
                </Link>
                <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 12, background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', boxShadow: '0 4px 14px var(--shadow-coral-mid)' }}>
                  Start building for free →
                </Link>
              </div>
            </>
          )}
        </main>

        {/* ── Footer ── */}
        <footer className="bpost-footer">
          <div className="bpost-footer-inner">
            <ul className="bpost-footer-links">
              <li><Link href="/">Home</Link></li>
              <li><Link href="/workforce">Workforce Registry</Link></li>
              <li><Link href="/blog">Blog</Link></li>
              <li><Link href="/login">Sign In</Link></li>
              <li><Link href="/register">Get Started</Link></li>
              <li><a href="https://coderclaw.ai" target="_blank" rel="noopener">CoderClaw</a></li>
            </ul>
            <p className="bpost-footer-copy">
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
