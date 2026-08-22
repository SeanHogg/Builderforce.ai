import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import showcaseData from '@/data/agents/showcase.json';
import ShowcaseGrid from './ShowcaseGrid';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agents.showcase');
  return pageMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/agents/showcase' });
}

interface Tweet {
  id: string;
  author: string;
  quote: string;
  likes: number;
  category?: string;
  images?: string[];
}

export default async function ShowcasePage() {
  const t = await getTranslations('agents.showcase');
  const tweets = showcaseData as Tweet[];
  const isBuilderForceAgents = (tweet: Tweet) => {
    const text = `${tweet.quote} ${tweet.author}`.toLowerCase();
    return text.includes('@builderforce') || text.includes('#builderforce');
  };
  const agentHostCount = tweets.filter(isBuilderForceAgents).length;

  return (
    <div className="cc-page">
      <header className="cc-page-header">
        <h1 className="cc-page-title"><span className="cc-agentHost-accent">⟩</span> {t('heading')}</h1>
        <p className="cc-page-subtitle">{t('subtitle')}</p>
      </header>
      <ShowcaseGrid tweets={tweets} initialCoderagentHostCount={agentHostCount} totalCount={tweets.length} />
      <section className="cc-cta-card">
        <h2>{t('ctaHeading')}</h2>
        <p>{t('ctaBody')}</p>
        <div className="cc-cta-buttons">
          <a className="cc-btn primary" href="https://twitter.com/intent/tweet?text=Check%20out%20what%20I%20built%20with%20%40builderforce%21" target="_blank" rel="noopener">{t('shareOnX')}</a>
          <Link className="cc-btn" href="/agents/skills">{t('browseSkills')}</Link>
          <a className="cc-btn" href="https://discord.gg/9gUsc2sNG6" target="_blank" rel="noopener">{t('joinDiscord')}</a>
        </div>
      </section>
      <p className="cc-more">
        {t.rich('more', { docs: (chunks) => <Link href="/docs/start/showcase">{chunks}</Link> })}
      </p>
      <style>{`
        .cc-page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 56px 24px 80px;
        }
        .cc-page-header {
          text-align: center;
          margin-bottom: 32px;
        }
        .cc-page-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: var(--font-size-page-title);
          margin: 0;
          color: var(--text-primary);
        }
        .cc-page-subtitle {
          color: var(--text-secondary);
          margin-top: 12px;
        }
        .cc-agentHost-accent { color: var(--coral-bright); margin-right: 8px; }
        .cc-cta-card {
          margin-top: 64px;
          padding: 40px 24px;
          text-align: center;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
        }
        .cc-cta-card h2 {
          font-family: var(--font-display);
          font-size: var(--font-size-section);
          margin: 0 0 8px;
        }
        .cc-cta-card p {
          color: var(--text-secondary);
          margin: 0 0 20px;
        }
        .cc-cta-buttons {
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .cc-btn {
          padding: 12px 22px;
          border-radius: var(--radius-lg);
          text-decoration: none;
          color: var(--text-primary);
          background: var(--surface-interactive, rgba(136,146,176,0.08));
          border: 1px solid var(--border-subtle);
          font-weight: 600;
        }
        .cc-btn.primary {
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark, var(--coral-bright)));
          color: var(--text-on-accent);
          border-color: transparent;
        }
        .cc-more {
          text-align: center;
          color: var(--text-secondary);
          margin-top: 32px;
          font-size: var(--font-size-body);
        }
        .cc-more a {
          color: var(--coral-bright);
          text-decoration: none;
        }
      `}</style>
    </div>
  );
}
