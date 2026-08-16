import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import CompetitorMatrix, { type CompareCategory } from '@/components/marketing/CompetitorMatrix';
import MarketingFaq, { type MarketingFaqItem } from '@/components/marketing/MarketingFaq';
import { pageMetadata } from '@/lib/seo';
import { competitorCompareSchema } from '@/lib/structured-data';
import {
  COMPETITORS,
  COMPETITOR_SEO,
  COMPETITOR_SLUG_TO_KEY,
} from '@/lib/content';

// Dynamic on the Edge Runtime — NOT statically prerendered. `getTranslations()`
// reads the locale cookie (cookie-based i18n), which forces this route dynamic, so
// it can't use `generateStaticParams` (and Next 15.5 forbids combining that with
// `runtime = 'edge'` anyway). next-on-pages then requires every non-static route to
// opt into the Edge Runtime. Invalid slugs 404 via `notFound()` in `resolve()`, so
// no slug enumeration is needed. Same shape as /integrations/[tool].
export const runtime = 'edge';

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
    title: `${vs} — ${t('leaf.criteriaTitle')}`,
    description: t('leaf.criteriaSummary', { name: hit.seo.name }),
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
  const categories = t.raw('compare.categories') as CompareCategory[];
  // Per-vendor narrative. Translated in all five catalogs since the leaf pages
  // were built, and rendered by none of them until now — every "vs" page showed
  // the same generic `leaf.*` criteria copy, so all seven read identically.
  const vendor = (t.raw('compare.competitors') as Record<string, { tagline: string; summary: string; verdict: string }>)[key];
  const faq = t.raw('compare.faq') as MarketingFaqItem[];

  return (
    <>
      <JsonLd data={competitorCompareSchema(seo)} />

      <style>{`
        .vs { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        /* THE marketing column (globals.css) — the band is the page width; the
           reading measure is set on the text inside it, not on the band. */
        .vs-hero { text-align: center; padding: 44px var(--marketing-gutter) 28px; max-width: var(--marketing-max); margin: 0 auto; width: 100%; }
        .vs-hero > * { max-width: 62ch; margin-inline: auto; }
        .vs-eyebrow { font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px; }
        .vs-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.08; font-size: var(--font-size-page-title); color: var(--text-primary); margin: 0 0 16px; }
        .vs-tagline { font-size: var(--font-size-lede); color: var(--text-primary); font-weight: 600; margin: 0 0 14px; }
        .vs-sub { font-size: var(--font-size-lede); color: var(--text-secondary); line-height: 1.7; margin: 0; }
        .vs-cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
        .vs-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: var(--radius-lg); font-weight: 600; font-size: var(--font-size-body); text-decoration: none; }
        .vs-btn-primary { background: linear-gradient(135deg, var(--coral-bright), var(--error)); color: var(--text-on-accent); }
        .vs-btn-ghost { background: var(--surface-card); border: 1px solid var(--border-subtle); color: var(--text-primary); }
        .vs-section { max-width: var(--marketing-max); margin: 0 auto; padding: 24px var(--marketing-gutter); width: 100%; }
        .vs-criteria { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
        .vs-criterion { border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); background: var(--surface-card); padding: 20px; }
        .vs-cat { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-card-title); color: var(--text-primary); margin: 26px 0 10px; }
        .vs-cat-blurb { font-size: var(--font-size-small); color: var(--text-secondary); margin: 0 0 12px; line-height: 1.6; }
        .vs-verdict { border: 1px solid var(--border-accent); border-radius: var(--radius-xl); background: var(--surface-card); padding: 24px; }
        .vs-verdict .vs-cat { margin-top: 0; }
      `}</style>

      <main className="vs">
        <header className="vs-hero">
          {/* The eyebrow used to repeat `vsLabel` verbatim above the <h1>, so
              every leaf opened by saying the same sentence twice. */}
          <div className="vs-eyebrow">{t('compare.hero.eyebrow')}</div>
          <h1 className="vs-title">{t('compare.leaf.vsLabel', { name: seo.name })}</h1>
          <p className="vs-tagline">{vendor?.tagline ?? t('compare.leaf.criteriaTitle')}</p>
          <p className="vs-sub">{vendor?.summary ?? t('compare.leaf.criteriaSummary', { name: label })}</p>
          <div className="vs-cta-row">
            <Link className="vs-btn vs-btn-primary" href="/register">{t('marketing.ctaGetStartedFree')}</Link>
            <Link className="vs-btn vs-btn-ghost" href="/compare">{t('compare.leaf.seeFullComparison')}</Link>
          </div>
        </header>

        <section className="vs-section">
          <p className="vs-cat-blurb">{t('compare.leaf.criteriaNote')}</p>
          <div className="vs-criteria">
            {categories.map((cat) => (
              <article className="vs-criterion" key={cat.id}>
              <h2 className="vs-cat">{cat.title}</h2>
              <p className="vs-cat-blurb">{cat.blurb}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Two columns only — Builderforce.ai against this vendor. Somebody who
            followed a "vs Cursor" link wants that row, not all seven. */}
        <CompetitorMatrix only={key} />

        {vendor?.verdict && (
          <section className="vs-section">
            <div className="vs-verdict">
              <h2 className="vs-cat">{t('compare.leaf.bottomLine')}</h2>
              <p className="vs-sub">{vendor.verdict}</p>
            </div>
          </section>
        )}

        <section className="vs-section">
          <h2 className="vs-cat">{t('compare.leaf.faqHeading')}</h2>
          <MarketingFaq items={faq} />
        </section>

        <RelatedArticles surface={`compare:${key}`} heading={t('compare.leaf.relatedHeading')} />

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </main>
    </>
  );
}
