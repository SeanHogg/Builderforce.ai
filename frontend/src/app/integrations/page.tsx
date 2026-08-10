import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbSchema } from '@/lib/structured-data';
import { SEO_INTEGRATIONS } from '@/lib/content';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrationsIndex.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/integrations',
  });
}

const CATEGORIES = Array.from(new Set(SEO_INTEGRATIONS.map((i) => i.category)));

export default async function IntegrationsIndexPage() {
  const t = await getTranslations('integrationsIndex');
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Home', url: 'https://builderforce.ai' },
          { name: 'Integrations', url: 'https://builderforce.ai/integrations' },
        ])}
      />

      <style>{`
        .intx { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        /* THE marketing column (globals.css); the reading measure is on the text. */
        .intx-hero { text-align: center; padding: 44px var(--marketing-gutter) 24px; max-width: var(--marketing-max); margin: 0 auto; width: 100%; }
        .intx-hero > * { max-width: 62ch; margin-inline: auto; }
        .intx-eyebrow { font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px; }
        .intx-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; font-size: var(--font-size-page-title); color: var(--text-primary); margin: 0 0 14px; }
        .intx-sub { font-size: var(--font-size-lede); color: var(--text-secondary); line-height: 1.7; margin: 0; }
        .intx-section { max-width: var(--marketing-max); margin: 0 auto; padding: 16px var(--marketing-gutter); width: 100%; }
        .intx-cat { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-card-title); color: var(--text-primary); margin: 26px 0 12px; }
        .intx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
        .intx-card { display: block; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; transition: border-color .15s ease; }
        .intx-card:hover { border-color: var(--coral-bright); }
        .intx-card-name { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-card-title); color: var(--text-primary); margin: 0 0 6px; }
        .intx-card-desc { font-size: var(--font-size-small); color: var(--text-secondary); line-height: 1.55; margin: 0; }
      `}</style>

      <main className="intx">
        <header className="intx-hero">
          <div className="intx-eyebrow">{t('eyebrow')}</div>
          <h1 className="intx-title">{t('title')}</h1>
          <p className="intx-sub">{t('lede')}</p>
        </header>

        <section className="intx-section">
          {CATEGORIES.map((cat) => (
            <div key={cat}>
              <h2 className="intx-cat">{cat}</h2>
              <div className="intx-grid">
                {SEO_INTEGRATIONS.filter((i) => i.category === cat).map((i) => (
                  <Link key={i.slug} className="intx-card" href={`/integrations/${i.slug}`}>
                    <p className="intx-card-name">{i.name}</p>
                    <p className="intx-card-desc">{i.tagline}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </main>
    </>
  );
}
