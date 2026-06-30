import type { Metadata } from 'next';
import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { pageMetadata } from '@/lib/seo';
import { competitorCompareSchema } from '@/lib/structured-data';
import {
  COMPETITORS,
  COMPETITOR_SEO,
  COMPETITOR_SLUG_TO_KEY,
} from '@/lib/content';

// next-on-pages requires every non-static route to opt into the Edge Runtime.
export const runtime = 'edge';

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(COMPETITOR_SEO).map((c) => ({ competitor: c.slug }));
}

type CompareCategory = { id: string; title: string; blurb: string; rows: { feature: string; note?: string; values: Record<string, string> }[] };
type CompareFaq = { question: string; answer: string };

// Resolve the URL slug to its stable key + canonical-English SEO record
// (content.ts COMPETITOR_SEO drives JSON-LD + routing); the visible copy is
// pulled from the localized `compare` catalog by key.
function resolve(slug: string) {
  const key = COMPETITOR_SLUG_TO_KEY[slug];
  if (!key) return null;
  const seo = COMPETITOR_SEO[key];
  const hasCol = COMPETITORS.some((c) => c.key === key);
  return seo && hasCol ? { key, seo } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const { competitor } = await params;
  const hit = resolve(competitor);
  if (!hit) return { title: 'Comparison Not Found' };
  const t = await getTranslations('compare');
  const vs = t('leaf.vsLabel', { name: hit.seo.name });
  return pageMetadata({
    title: `${vs} — ${t(`competitors.${hit.key}.tagline`)}`,
    description: t(`competitors.${hit.key}.summary`),
    path: `/compare/${hit.seo.slug}`,
    ogTitle: vs,
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
  const { key, seo } = hit;
  const t = await getTranslations();
  const label = t(`compare.competitorLabels.${key}`);
  const tagline = t(`compare.competitors.${key}.tagline`);
  const summary = t(`compare.competitors.${key}.summary`);
  const verdict = t(`compare.competitors.${key}.verdict`);
  const categories = t.raw('compare.categories') as CompareCategory[];
  const faq = t.raw('compare.faq') as CompareFaq[];

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
          <div className="vs-eyebrow">{t('compare.leaf.vsLabel', { name: label })}</div>
          <h1 className="vs-title">{t('compare.leaf.vsLabel', { name: seo.name })}</h1>
          <p className="vs-tagline">{tagline}</p>
          <p className="vs-sub">{summary}</p>
          <div className="vs-cta-row">
            <Link className="vs-btn vs-btn-primary" href="/register">{t('marketing.ctaGetStartedFree')}</Link>
            <Link className="vs-btn vs-btn-ghost" href="/compare">{t('compare.leaf.seeFullComparison')}</Link>
          </div>
        </header>

        <section className="vs-section">
          {categories.map((cat) => (
            <Fragment key={cat.id}>
              <h2 className="vs-cat">{cat.title}</h2>
              <p className="vs-cat-blurb">{cat.blurb}</p>
              <div className="vs-table-wrap">
                <table className="vs-table">
                  <thead>
                    <tr>
                      <th>{t('compare.capabilityHeader')}</th>
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

          <h2 className="vs-cat">{t('compare.leaf.bottomLine')}</h2>
          <p className="vs-verdict">{verdict}</p>

          <h2 className="vs-cat">{t('compare.leaf.faqHeading')}</h2>
          {faq.map((q) => (
            <Fragment key={q.question}>
              <h3 className="vs-faq-q">{q.question}</h3>
              <p className="vs-faq-a">{q.answer}</p>
            </Fragment>
          ))}
        </section>

        <RelatedArticles surface={`compare:${key}`} heading={t('compare.leaf.relatedHeading')} />

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </main>
    </>
  );
}
