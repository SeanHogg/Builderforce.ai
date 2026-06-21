import type { Metadata } from 'next';
import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { pageMetadata } from '@/lib/seo';
import { competitorCompareSchema } from '@/lib/structured-data';
import {
  COMPETITORS,
  COMPETITIVE_COMPARISON,
  COMPARE_FAQ,
  COMPETITOR_SEO,
  COMPETITOR_SLUG_TO_KEY,
} from '@/lib/content';

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(COMPETITOR_SEO).map((c) => ({ competitor: c.slug }));
}

function resolve(slug: string) {
  const key = COMPETITOR_SLUG_TO_KEY[slug];
  if (!key) return null;
  const seo = COMPETITOR_SEO[key];
  const col = COMPETITORS.find((c) => c.key === key);
  return seo && col ? { key, seo, label: col.label } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const { competitor } = await params;
  const hit = resolve(competitor);
  if (!hit) return { title: 'Comparison Not Found' };
  return pageMetadata({
    title: `Builderforce.ai vs ${hit.seo.name}: Self-Hosted Multi-Agent Alternative | Builderforce.ai`,
    description: hit.seo.summary,
    path: `/compare/${hit.seo.slug}`,
    ogTitle: `Builderforce.ai vs ${hit.seo.name}`,
  });
}

export default async function CompetitorComparePage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  const { competitor } = await params;
  const hit = resolve(competitor);
  if (!hit) notFound();
  const { key, seo, label } = hit;

  return (
    <>
      <JsonLd data={competitorCompareSchema(seo)} />

      <style>{`
        .vs { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        .vs-hero { text-align: center; padding: 44px 24px 28px; max-width: 900px; margin: 0 auto; width: 100%; }
        .vs-eyebrow { font-family: var(--font-display); font-size: 0.78rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px; }
        .vs-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.08; font-size: clamp(1.9rem, 5vw, 3rem); color: var(--text-primary); margin: 0 0 16px; }
        .vs-tagline { font-size: clamp(1rem, 2vw, 1.18rem); color: var(--text-primary); font-weight: 600; margin: 0 0 14px; }
        .vs-sub { font-size: clamp(0.95rem, 2vw, 1.05rem); color: var(--text-secondary); line-height: 1.7; margin: 0; }
        .vs-cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
        .vs-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 12px; font-weight: 600; font-size: 0.95rem; text-decoration: none; }
        .vs-btn-primary { background: linear-gradient(135deg, var(--coral-bright), #e23b2e); color: #fff; }
        .vs-btn-ghost { background: var(--surface-card); border: 1px solid var(--border-subtle); color: var(--text-primary); }
        .vs-section { max-width: 900px; margin: 0 auto; padding: 24px; width: 100%; }
        .vs-table-wrap { overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 16px; background: var(--surface-card); }
        .vs-table { width: 100%; border-collapse: collapse; min-width: 560px; }
        .vs-table th, .vs-table td { padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: 0.9rem; }
        .vs-table thead th { font-family: var(--font-display); font-weight: 700; color: var(--text-primary); background: var(--surface-sunken, rgba(255,255,255,0.02)); }
        .vs-table th.col-bf { color: var(--coral-bright); }
        .vs-cat { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; color: var(--text-primary); margin: 26px 0 10px; }
        .vs-cat-blurb { font-size: 0.88rem; color: var(--text-secondary); margin: 0 0 12px; line-height: 1.6; }
        .vs-feat { color: var(--text-primary); font-weight: 600; }
        .vs-feat-note { display: block; color: var(--text-secondary); font-weight: 400; font-size: 0.78rem; margin-top: 2px; }
        .vs-verdict { background: var(--surface-card); border: 1px solid var(--border-subtle); border-left: 3px solid var(--coral-bright); border-radius: 12px; padding: 18px 20px; margin: 8px 0 0; color: var(--text-primary); line-height: 1.65; font-size: 0.97rem; }
        .vs-faq-q { font-family: var(--font-display); font-weight: 600; font-size: 1rem; color: var(--text-primary); margin: 18px 0 6px; }
        .vs-faq-a { font-size: 0.92rem; color: var(--text-secondary); line-height: 1.7; margin: 0; }
      `}</style>

      <main className="vs">
        <header className="vs-hero">
          <div className="vs-eyebrow">Builderforce.ai vs {label}</div>
          <h1 className="vs-title">Builderforce.ai vs {seo.name}</h1>
          <p className="vs-tagline">{seo.tagline}</p>
          <p className="vs-sub">{seo.summary}</p>
          <div className="vs-cta-row">
            <Link className="vs-btn vs-btn-primary" href="/register">Get Started Free</Link>
            <Link className="vs-btn vs-btn-ghost" href="/compare">See the full comparison</Link>
          </div>
        </header>

        <section className="vs-section">
          {COMPETITIVE_COMPARISON.map((cat) => (
            <Fragment key={cat.id}>
              <h2 className="vs-cat">{cat.title}</h2>
              <p className="vs-cat-blurb">{cat.blurb}</p>
              <div className="vs-table-wrap">
                <table className="vs-table">
                  <thead>
                    <tr>
                      <th>Capability</th>
                      <th className="col-bf">Builderforce.ai</th>
                      <th>{label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.rows.map((row) => (
                      <tr key={row.feature}>
                        <td>
                          <span className="vs-feat">{row.feature}</span>
                          {row.note ? <span className="vs-feat-note">{row.note}</span> : null}
                        </td>
                        <td className="col-bf">{row.values.builderforce ?? '—'}</td>
                        <td>{row.values[key] ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Fragment>
          ))}

          <h2 className="vs-cat">The bottom line</h2>
          <p className="vs-verdict">{seo.verdict}</p>

          <h2 className="vs-cat">Frequently asked questions</h2>
          {COMPARE_FAQ.map((q) => (
            <Fragment key={q.question}>
              <h3 className="vs-faq-q">{q.question}</h3>
              <p className="vs-faq-a">{q.answer}</p>
            </Fragment>
          ))}
        </section>

        <RelatedArticles surface={`compare:${key}`} heading="Related reading" />

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </main>
    </>
  );
}
