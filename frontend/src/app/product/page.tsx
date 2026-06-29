import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { productSchema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import { STATS, PRODUCT_SECTIONS } from '@/lib/content';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('product.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/product',
    ogTitle: t('ogTitle'),
  });
}

type ProductSection = { id: string; title: string; blurb: string; surfaces: { title: string; desc: string }[] };

// Visible copy from the `product` catalog (localized in all 5 locales).
// content.ts STATS/PRODUCT_SECTIONS stays canonical English for the JSON-LD
// (productSchema); stat VALUES, section/surface ICONS and hrefs are paired from
// content by index, so the catalog arrays stay length/order-aligned with it.
export default async function ProductPage() {
  const t = await getTranslations();
  const statLabels = t.raw('product.statLabels') as string[];
  const sections = t.raw('product.sections') as ProductSection[];

  return (
    <>
      <JsonLd data={productSchema()} />

      <style>{`
        .pp { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        .pp-hero { text-align: center; padding: 44px 24px 40px; max-width: 820px; margin: 0 auto; }
        .pp-eyebrow {
          font-family: var(--font-display); font-size: 0.78rem; font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px;
        }
        .pp-title {
          font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.08;
          font-size: clamp(2.2rem, 5.5vw, 3.4rem); color: var(--text-primary); margin: 0 0 18px;
        }
        .pp-sub { font-size: clamp(0.98rem, 2vw, 1.12rem); color: var(--text-secondary); line-height: 1.7; margin: 0; }
        .pp-stats {
          max-width: 900px; margin: 28px auto 0; padding: 0 24px;
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
          border: 1px solid var(--border-subtle); border-radius: 16px; overflow: hidden;
        }
        @media (max-width: 640px) { .pp-stats { grid-template-columns: repeat(2, 1fr); } }
        .pp-stat { padding: 20px 14px; text-align: center; background: var(--surface-card); }
        .pp-stat-n {
          font-family: var(--font-display); font-weight: 700; font-size: clamp(1.3rem, 3vw, 1.8rem);
          color: var(--coral-bright); line-height: 1; margin-bottom: 5px;
        }
        .pp-stat-l { font-size: 0.76rem; color: var(--text-muted); line-height: 1.3; white-space: pre-line; }

        .pp-sections { max-width: 1100px; margin: 0 auto; padding: 40px 24px 24px; width: 100%; }
        .pp-section { margin-bottom: 56px; }
        .pp-section-head { margin-bottom: 20px; }
        .pp-section-title {
          font-family: var(--font-display); font-weight: 700; font-size: 1.5rem; color: var(--text-primary); margin: 0 0 6px;
        }
        .pp-section-title .pp-accent { color: var(--coral-bright); margin-right: 8px; }
        .pp-section-blurb { font-size: 0.95rem; color: var(--text-secondary); margin: 0; }
        .pp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
        .pp-card {
          display: flex; flex-direction: column; background: var(--surface-card);
          border: 1px solid var(--border-subtle); border-radius: 16px; padding: 22px 20px;
          text-decoration: none; transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
        }
        .pp-card:hover {
          transform: translateY(-4px); border-color: var(--border-accent);
          box-shadow: 0 16px 40px var(--shadow-coral-soft);
        }
        .pp-card-icon { font-size: 1.5rem; margin-bottom: 12px; }
        .pp-card-title { font-family: var(--font-display); font-weight: 600; font-size: 1rem; color: var(--text-primary); margin: 0 0 6px; }
        .pp-card-desc { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; margin: 0 0 14px; flex: 1; }
        .pp-card-cta { font-size: 0.82rem; font-weight: 600; color: var(--coral-bright); }

        .pp-cta { max-width: 820px; margin: 0 auto; padding: 0 24px 80px; }
        .pp-cta-box {
          text-align: center; padding: 52px 40px; border-radius: 22px;
          border: 1px solid var(--border-accent); background: var(--surface-card); backdrop-filter: blur(16px);
        }
        .pp-cta-title { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.5rem, 3.4vw, 2.1rem); color: var(--text-primary); margin: 0 0 12px; }
        .pp-cta-desc { font-size: 0.97rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 28px; line-height: 1.65; }
        .pp-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
        .pp-btn-primary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: 13px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: #fff;
          font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; text-decoration: none;
          box-shadow: 0 6px 22px var(--shadow-coral-mid); transition: transform 0.22s ease, box-shadow 0.22s ease;
        }
        .pp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 30px var(--shadow-coral-strong); }
        .pp-btn-secondary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: 13px;
          border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary);
          font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; text-decoration: none;
        }
        .pp-btn-secondary:hover { border-color: var(--border-accent); }
      `}</style>

      <div className="pp">
        <main>
          <section className="pp-hero">
            <div className="pp-eyebrow">{t('product.eyebrow')}</div>
            <h1 className="pp-title">{t('product.title')}</h1>
            <p className="pp-sub">{t('product.sub')}</p>
          </section>

          <div className="pp-stats">
            {statLabels.map((label, i) => (
              <div key={i} className="pp-stat">
                <div className="pp-stat-n">{STATS.marketing[i]?.value}</div>
                <div className="pp-stat-l">{label}</div>
              </div>
            ))}
          </div>

          <div className="pp-sections">
            {sections.map((section, si) => (
              <section key={section.id} className="pp-section" id={section.id}>
                <div className="pp-section-head">
                  <h2 className="pp-section-title">
                    <span className="pp-accent">⟩</span>
                    {section.title}
                  </h2>
                  <p className="pp-section-blurb">{section.blurb}</p>
                </div>
                <div className="pp-grid">
                  {section.surfaces.map((surface, fi) => (
                    <Link key={surface.title} href={PRODUCT_SECTIONS[si]?.surfaces[fi]?.href ?? '#'} className="pp-card">
                      <span className="pp-card-icon">{PRODUCT_SECTIONS[si]?.surfaces[fi]?.icon}</span>
                      <h3 className="pp-card-title">{surface.title}</h3>
                      <p className="pp-card-desc">{surface.desc}</p>
                      <span className="pp-card-cta">{t('product.exploreCta')} →</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="pp-cta">
            <div className="pp-cta-box">
              <h2 className="pp-cta-title">{t('product.ctaTitle')}</h2>
              <p className="pp-cta-desc">{t('product.ctaDesc')}</p>
              <div className="pp-actions">
                <Link href="/register" className="pp-btn-primary">⚡ {t('marketing.ctaGetStartedFree')}</Link>
                <Link href="/marketplace" className="pp-btn-secondary">👀 {t('product.ctaBrowseWorkforce')}</Link>
              </div>
            </div>
          </section>

          <RelatedArticles surface="product" heading={t('product.relatedHeading')} />
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
