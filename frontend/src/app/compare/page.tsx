import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { compareSchema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import { COMPARE } from '@/lib/content';
import { Icon } from '@/components/ui/Icon';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('compare.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/compare',
    ogTitle: t('ogTitle'),
  });
}

type CompareCategory = { id: string; title: string; blurb: string; rows: { feature: string; note?: string; values: Record<string, string> }[] };

// Visible copy from the `compare` catalog (localized in all 5 locales).
// `content.ts` COMPARE stays canonical English for the
// crawler-facing JSON-LD (compareSchema); COMPETITORS supplies the stable column
// ORDER + keys, and pillar ICONS are paired from COMPARE.pillars by index.
export default async function ComparePage() {
  const t = await getTranslations();
  const pillars = t.raw('compare.pillars') as { title: string; desc: string }[];
  const categories = t.raw('compare.categories') as CompareCategory[];

  return (
    <>
      <JsonLd data={compareSchema()} />

      <style>{`
        .cmp { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        .cmp-hero { text-align: center; padding: 44px 24px 36px; max-width: 1100px; margin: 0 auto; width: 100%; }
        .cmp-eyebrow {
          font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px;
        }
        .cmp-title {
          font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.08;
          font-size: var(--font-size-page-title); color: var(--text-primary); margin: 0 0 18px;
        }
        .cmp-sub { font-size: var(--font-size-lede); color: var(--text-secondary); line-height: 1.7; margin: 0; }

        .cmp-pillars {
          max-width: 1100px; margin: 0 auto; padding: 16px 24px 8px; width: 100%;
          display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;
        }
        .cmp-pillar {
          background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); padding: 22px 20px;
        }
        .cmp-pillar-icon { font-size: var(--font-size-section); margin-bottom: 10px; }
        .cmp-pillar-title { font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-card-title); color: var(--text-primary); margin: 0 0 6px; }
        .cmp-pillar-desc { font-size: var(--font-size-small); color: var(--text-secondary); line-height: 1.6; margin: 0; }

        .cmp-section { max-width: 1100px; margin: 0 auto; padding: 28px 24px 8px; width: 100%; }
        .cmp-intro { font-size: var(--font-size-body); color: var(--text-secondary); line-height: 1.7; max-width: none; margin: 0 0 24px; }

        .cmp-criteria { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
        .cmp-criterion { border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); background: var(--surface-card); padding: 20px; }
        .cmp-cat-title { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-body); color: var(--text-primary); margin: 0 0 6px; }
        .cmp-cat-blurb { font-size: var(--font-size-small); color: var(--text-muted); line-height: 1.6; margin: 0; }

        .cmp-cta { max-width: 820px; margin: 0 auto; padding: 40px 24px 80px; }
        .cmp-cta-box {
          text-align: center; padding: 52px 40px; border-radius: var(--radius-xl);
          border: 1px solid var(--border-accent); background: var(--surface-card); backdrop-filter: blur(16px);
        }
        .cmp-cta-title { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-section); color: var(--text-primary); margin: 0 0 12px; }
        .cmp-cta-desc { font-size: var(--font-size-body); color: var(--text-secondary); max-width: 520px; margin: 0 auto 28px; line-height: 1.65; }
        .cmp-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
        .cmp-btn-primary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: var(--radius-lg);
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: var(--text-on-accent);
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-body); text-decoration: none;
          box-shadow: 0 6px 22px var(--shadow-coral-mid); transition: transform 0.22s ease, box-shadow 0.22s ease;
        }
        .cmp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 30px var(--shadow-coral-strong); }
        .cmp-btn-secondary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: var(--radius-lg);
          border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary);
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-body); text-decoration: none;
        }
        .cmp-btn-secondary:hover { border-color: var(--border-accent); }

      `}</style>

      <div className="cmp">
        <main>
          <section className="cmp-hero">
            <div className="cmp-eyebrow">{t('compare.hero.eyebrow')}</div>
            <h1 className="cmp-title">{t('compare.hero.title')}</h1>
            <p className="cmp-sub">{t('compare.hero.subtitle')}</p>
          </section>

          <div className="cmp-pillars">
            {pillars.map((p, i) => (
              <div key={p.title} className="cmp-pillar">
                <div className="cmp-pillar-icon"><Icon source={COMPARE.pillars[i]?.icon} size={28} /></div>
                <h2 className="cmp-pillar-title">{p.title}</h2>
                <p className="cmp-pillar-desc">{p.desc}</p>
              </div>
            ))}
          </div>

          <section className="cmp-section">
            <p className="cmp-intro">{t('compare.intro')}</p>
            <div className="cmp-criteria" aria-label={t('compare.capabilityHeader')}>
              {categories.map((cat) => (
                <article className="cmp-criterion" key={cat.id}>
                  <h2 className="cmp-cat-title">{cat.title}</h2>
                  <p className="cmp-cat-blurb">{cat.blurb}</p>
                </article>
              ))}
            </div>
          </section>

          <RelatedArticles surface="compare" heading={t('compare.relatedHeading')} />

          <section className="cmp-cta">
            <div className="cmp-cta-box">
              <h2 className="cmp-cta-title">{t('compare.ctaTitle')}</h2>
              <p className="cmp-cta-desc">{t('compare.ctaDesc')}</p>
              <div className="cmp-actions">
          <Link href="/register" className="cmp-btn-primary"><Icon name="automation" size={17} /> {t('marketing.ctaGetStartedFree')}</Link>
          <Link href="/product" className="cmp-btn-secondary"><Icon name="search" size={17} /> {t('compare.ctaTourPlatform')}</Link>
              </div>
            </div>
          </section>
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
