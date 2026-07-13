import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { integrationSchema } from '@/lib/structured-data';
import { SEO_INTEGRATIONS, INTEGRATION_SLUG_MAP } from '@/lib/content';

export const dynamicParams = false;

export function generateStaticParams() {
  return SEO_INTEGRATIONS.map((it) => ({ tool: it.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tool: string }>;
}): Promise<Metadata> {
  const { tool } = await params;
  const seo = INTEGRATION_SLUG_MAP[tool];
  if (!seo) return { title: 'Integration Not Found' };
  return pageMetadata({
    title: `Builderforce.ai + ${seo.name} Integration | Builderforce.ai`,
    description: seo.summary,
    path: `/integrations/${seo.slug}`,
    ogTitle: `Builderforce.ai + ${seo.name}`,
  });
}

export default async function IntegrationPage({
  params,
}: {
  params: Promise<{ tool: string }>;
}) {
  const { tool } = await params;
  const seo = INTEGRATION_SLUG_MAP[tool];
  if (!seo) notFound();

  return (
    <>
      <JsonLd data={integrationSchema(seo)} />

      <style>{`
        .intg { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        .intg-hero { text-align: center; padding: 44px 24px 28px; max-width: 820px; margin: 0 auto; width: 100%; }
        .intg-eyebrow { font-family: var(--font-display); font-size: 0.78rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px; }
        .intg-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; font-size: clamp(1.9rem, 5vw, 2.8rem); color: var(--text-primary); margin: 0 0 14px; }
        .intg-tagline { font-size: clamp(1rem, 2vw, 1.16rem); color: var(--text-primary); font-weight: 600; margin: 0 0 12px; }
        .intg-sub { font-size: clamp(0.95rem, 2vw, 1.05rem); color: var(--text-secondary); line-height: 1.7; margin: 0; }
        .intg-cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
        .intg-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 12px; font-weight: 600; font-size: 0.95rem; text-decoration: none; }
        .intg-btn-primary { background: linear-gradient(135deg, var(--coral-bright), #e23b2e); color: #fff; }
        .intg-btn-ghost { background: var(--surface-card); border: 1px solid var(--border-subtle); color: var(--text-primary); }
        .intg-section { max-width: 820px; margin: 0 auto; padding: 20px 24px; width: 100%; }
        .intg-cat-chip { display: inline-block; font-size: 0.74rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: 999px; padding: 4px 12px; }
        .intg-h2 { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; color: var(--text-primary); margin: 22px 0 12px; }
        .intg-uses { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
        .intg-use { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px 18px; color: var(--text-primary); font-size: 0.92rem; line-height: 1.5; }
        .intg-use::before { content: '\\2713'; color: var(--coral-bright); font-weight: 700; margin-right: 8px; }
      `}</style>

      <main className="intg">
        <header className="intg-hero">
          <div className="intg-eyebrow">{seo.category} integration</div>
          <h1 className="intg-title">Builderforce.ai + {seo.name}</h1>
          <p className="intg-tagline">{seo.tagline}</p>
          <p className="intg-sub">{seo.summary}</p>
          <div className="intg-cta-row">
            <Link className="intg-btn intg-btn-primary" href="/register">Get Started Free</Link>
            {seo.docsHref ? (
              <Link className="intg-btn intg-btn-ghost" href={seo.docsHref}>Learn more</Link>
            ) : null}
          </div>
        </header>

        <section className="intg-section">
          <span className="intg-cat-chip">{seo.category}</span>
          <h2 className="intg-h2">What you can do with {seo.name}</h2>
          <ul className="intg-uses">
            {seo.useCases.map((u) => (
              <li className="intg-use" key={u}>{u}</li>
            ))}
          </ul>

          <h2 className="intg-h2">Explore more integrations</h2>
          <p className="intg-sub" style={{ marginBottom: 12 }}>
            Builderforce.ai connects your agent workforce to source control, chat channels, model
            providers and the tools you already use. <Link href="/integrations">Browse all integrations</Link>.
          </p>
        </section>

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </main>
    </>
  );
}
