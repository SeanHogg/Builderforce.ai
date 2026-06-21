'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { getRouteMarketing } from '@/lib/routeMarketing';
import { PRODUCT_SECTIONS } from '@/lib/content';
import { routeMarketingSchema } from '@/lib/structured-data';
import JsonLd from './JsonLd';
import RelatedArticles from './blog/RelatedArticles';

/**
 * Marketing page rendered (inside MarketingShell) when a logged-out visitor or
 * crawler hits an authenticated route — a feature-specific hero, "how it works"
 * highlights, the product map, a per-feature FAQ, associated blog articles, and
 * JSON-LD. Replaces the old one-line gate so every authed deep link is a real,
 * indexable marketing page rather than a dead end.
 *
 * All per-route copy lives in lib/routeMarketing.ts (single source of truth);
 * this component only renders it and decides its own section visibility.
 */
export default function RouteMarketing({ pathname }: { pathname: string }) {
  const m = getRouteMarketing(pathname);
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;
  const metaDesc = m.seoDescription ?? m.description;

  // Client-set <title>/description so each feature route has a unique, crawlable
  // head (these routes render client-side, so there is no server metadata
  // export). Modern crawlers execute JS and read both this and the JSON-LD below.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${m.title} — Builderforce.ai`;
    const tag = document.querySelector('meta[name="description"]');
    const prevDesc = tag?.getAttribute('content') ?? null;
    if (tag) tag.setAttribute('content', metaDesc);
    return () => {
      document.title = prevTitle;
      if (tag && prevDesc !== null) tag.setAttribute('content', prevDesc);
    };
  }, [m.title, metaDesc]);

  return (
    <div className="route-mkt">
      <JsonLd
        data={routeMarketingSchema({
          path: pathname,
          title: m.title,
          description: metaDesc,
          faq: m.faq,
        })}
      />

      <section className="rm-hero">
        <div className="rm-icon" aria-hidden="true">{m.icon}</div>
        <h1 className="rm-title">{m.title}</h1>
        <p className="rm-desc">{m.description}</p>
        <p className="rm-sub">
          Sign in to use {m.title}, or create a free account — no credit card required.
        </p>
        <div className="rm-actions">
          <Link href="/register" className="rm-btn-primary">🚀 Get Started Free</Link>
          <Link href={loginHref} className="rm-btn-secondary">Sign In</Link>
          <Link href="/product" className="rm-btn-ghost">Explore the product →</Link>
        </div>
      </section>

      {m.highlights && m.highlights.length > 0 && (
        <section className="rm-highlights">
          <div className="rm-inside-head">How {m.title} works</div>
          <div className="rm-hl-grid">
            {m.highlights.map((h) => (
              <div key={h.title} className="rm-hl-card">
                <div className="rm-hl-title">{h.title}</div>
                <div className="rm-hl-desc">{h.desc}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rm-inside">
        <div className="rm-inside-head">What you get with Builderforce.ai</div>
        <div className="rm-grid">
          {PRODUCT_SECTIONS.map((s) => (
            <Link key={s.id} href={`/product#${s.id}`} className="rm-card">
              <div className="rm-card-icon" aria-hidden="true">{s.icon}</div>
              <div className="rm-card-title">{s.title}</div>
              <div className="rm-card-blurb">{s.blurb}</div>
            </Link>
          ))}
        </div>
      </section>

      {m.faq && m.faq.length > 0 && (
        <section className="rm-faq">
          <div className="rm-inside-head">Frequently asked questions</div>
          <div className="rm-faq-list">
            {m.faq.map((q) => (
              <details key={q.question} className="rm-faq-item">
                <summary className="rm-faq-q">{q.question}</summary>
                <p className="rm-faq-a">{q.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {m.relatedSurface && (
        <RelatedArticles surface={m.relatedSurface} heading="Related reading" />
      )}

      <style>{`
        .route-mkt { max-width: 1000px; margin: 0 auto; padding: 24px; }
        .rm-hero {
          text-align: center;
          padding: 48px 24px 40px;
          border: 1px solid var(--border-subtle);
          border-radius: 20px;
          background: var(--surface-card);
        }
        .rm-icon { font-size: 56px; line-height: 1; margin-bottom: 16px; }
        .rm-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(1.8rem, 4vw, 2.6rem);
          color: var(--text-primary);
          margin: 0 0 12px;
        }
        .rm-desc {
          font-size: clamp(1rem, 2vw, 1.12rem);
          color: var(--text-secondary);
          max-width: 600px;
          margin: 0 auto 8px;
          line-height: 1.6;
        }
        .rm-sub { font-size: 0.9rem; color: var(--text-muted); margin: 0 auto 28px; }
        .rm-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; align-items: center; }
        .rm-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 26px; border-radius: 12px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark));
          color: #fff; font-family: var(--font-display); font-weight: 600; font-size: 0.92rem;
          text-decoration: none; box-shadow: 0 6px 20px var(--shadow-coral-mid);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .rm-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 28px var(--shadow-coral-strong); }
        .rm-btn-secondary {
          display: inline-flex; align-items: center; padding: 13px 26px; border-radius: 12px;
          border: 1px solid var(--border-subtle); background: var(--surface-card);
          color: var(--text-primary); font-family: var(--font-display); font-weight: 600; font-size: 0.92rem;
          text-decoration: none;
        }
        .rm-btn-secondary:hover { border-color: var(--border-accent); }
        .rm-btn-ghost { color: var(--coral-bright); font-weight: 600; font-size: 0.88rem; text-decoration: none; padding: 13px 8px; }
        .rm-btn-ghost:hover { text-decoration: underline; }

        .rm-highlights { margin-top: 40px; }
        .rm-hl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
        .rm-hl-card {
          padding: 22px 20px; border-radius: 16px;
          border: 1px solid var(--border-subtle); background: var(--surface-card);
        }
        .rm-hl-title { font-family: var(--font-display); font-weight: 600; font-size: 1.02rem; color: var(--text-primary); margin-bottom: 6px; }
        .rm-hl-desc { font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6; }

        .rm-inside { margin-top: 40px; }
        .rm-inside-head {
          text-align: center; font-family: var(--font-display); font-weight: 600;
          font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--text-muted); margin-bottom: 18px;
        }
        .rm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
        .rm-card {
          display: flex; flex-direction: column; gap: 6px;
          padding: 20px; border-radius: 16px;
          border: 1px solid var(--border-subtle); background: var(--surface-card);
          text-decoration: none; transition: transform 0.2s ease, border-color 0.2s ease;
        }
        .rm-card:hover { transform: translateY(-3px); border-color: var(--border-accent); }
        .rm-card-icon { font-size: 1.5rem; }
        .rm-card-title { font-family: var(--font-display); font-weight: 600; font-size: 1rem; color: var(--text-primary); }
        .rm-card-blurb { font-size: 0.84rem; color: var(--text-secondary); line-height: 1.5; }

        .rm-faq { margin-top: 40px; max-width: 760px; margin-left: auto; margin-right: auto; }
        .rm-faq-list { display: flex; flex-direction: column; gap: 10px; }
        .rm-faq-item {
          border: 1px solid var(--border-subtle); border-radius: 14px;
          background: var(--surface-card); padding: 4px 18px;
        }
        .rm-faq-q {
          cursor: pointer; list-style: none; padding: 14px 0;
          font-family: var(--font-display); font-weight: 600; font-size: 0.98rem;
          color: var(--text-primary); display: flex; justify-content: space-between; align-items: center; gap: 12px;
        }
        .rm-faq-q::-webkit-details-marker { display: none; }
        .rm-faq-q::after { content: '+'; color: var(--coral-bright); font-size: 1.3rem; line-height: 1; flex-shrink: 0; }
        .rm-faq-item[open] .rm-faq-q::after { content: '–'; }
        .rm-faq-a { margin: 0 0 14px; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; }
      `}</style>
    </div>
  );
}
