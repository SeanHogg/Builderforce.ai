import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbSchema } from '@/lib/structured-data';
import { SEO_INTEGRATIONS } from '@/lib/content';

export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: 'Integrations — Connect Your Agent Workforce to Your Stack | Builderforce.ai',
  description:
    'Builderforce.ai integrates with GitHub, GitLab, Slack, Discord, WhatsApp, Ollama, Anthropic, MCP, Notion and Gmail. Connect your self-hosted AI agent workforce to the tools you already use.',
  path: '/integrations',
});

const CATEGORIES = Array.from(new Set(SEO_INTEGRATIONS.map((i) => i.category)));

export default function IntegrationsIndexPage() {
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
        .intx-hero { text-align: center; padding: 44px 24px 24px; max-width: 820px; margin: 0 auto; width: 100%; }
        .intx-eyebrow { font-family: var(--font-display); font-size: 0.78rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px; }
        .intx-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; font-size: clamp(1.9rem, 5vw, 2.8rem); color: var(--text-primary); margin: 0 0 14px; }
        .intx-sub { font-size: clamp(0.95rem, 2vw, 1.05rem); color: var(--text-secondary); line-height: 1.7; margin: 0; }
        .intx-section { max-width: 980px; margin: 0 auto; padding: 16px 24px; width: 100%; }
        .intx-cat { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; color: var(--text-primary); margin: 26px 0 12px; }
        .intx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
        .intx-card { display: block; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 18px 20px; text-decoration: none; transition: border-color .15s ease; }
        .intx-card:hover { border-color: var(--coral-bright); }
        .intx-card-name { font-family: var(--font-display); font-weight: 700; font-size: 1.02rem; color: var(--text-primary); margin: 0 0 6px; }
        .intx-card-desc { font-size: 0.86rem; color: var(--text-secondary); line-height: 1.55; margin: 0; }
      `}</style>

      <main className="intx">
        <header className="intx-hero">
          <div className="intx-eyebrow">Integrations</div>
          <h1 className="intx-title">Connect your agent workforce to your stack</h1>
          <p className="intx-sub">
            Builderforce.ai plugs your self-hosted, model-agnostic AI agents into source control,
            chat channels, model providers and the tools you already use — every action governed by
            approvals and an audit trail.
          </p>
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
