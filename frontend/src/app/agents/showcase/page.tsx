import type { Metadata } from 'next';
import showcaseData from '@/data/agents/showcase.json';
import ShowcaseGrid from './ShowcaseGrid';

export const metadata: Metadata = {
  title: 'Showcase — What People Are Building with BuilderForce Agents',
  description:
    'See what developers are building with BuilderForce Agents autonomous agents. Real projects, workflows, and automations from the BuilderForce Agents community.',
  alternates: { canonical: '/agents/showcase' },
};

interface Tweet {
  id: string;
  author: string;
  quote: string;
  likes: number;
  category?: string;
  images?: string[];
}

export default function ShowcasePage() {
  const tweets = showcaseData as Tweet[];
  const isBuilderForceAgents = (t: Tweet) => {
    const text = `${t.quote} ${t.author}`.toLowerCase();
    return text.includes('@builderforce') || text.includes('#builderforce');
  };
  const agentHostCount = tweets.filter(isBuilderForceAgents).length;

  return (
    <div className="cc-page">
      <header className="cc-page-header">
        <h1 className="cc-page-title"><span className="cc-agentHost-accent">⟩</span> What People Are Building</h1>
        <p className="cc-page-subtitle">Real projects, real automation, real magic.</p>
      </header>
      <ShowcaseGrid tweets={tweets} initialCoderagentHostCount={agentHostCount} totalCount={tweets.length} />
      <section className="cc-cta-card">
        <h2>Built something cool?</h2>
        <p>Share your BuilderForce Agents creation with the community.</p>
        <div className="cc-cta-buttons">
          <a className="cc-btn primary" href="https://twitter.com/intent/tweet?text=Check%20out%20what%20I%20built%20with%20%40builderforce%21" target="_blank" rel="noopener">Share on X</a>
          <a className="cc-btn" href="/agents/skills">Browse Skills</a>
          <a className="cc-btn" href="https://discord.gg/9gUsc2sNG6" target="_blank" rel="noopener">Join Discord</a>
        </div>
      </section>
      <p className="cc-more">
        Looking for more? <a href="/docs/start/showcase">More examples in our docs</a>.
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
          font-size: clamp(2rem, 5vw, 3rem);
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
          border-radius: 18px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
        }
        .cc-cta-card h2 {
          font-family: var(--font-display);
          font-size: 1.4rem;
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
          border-radius: 11px;
          text-decoration: none;
          color: var(--text-primary);
          background: var(--surface-interactive, rgba(136,146,176,0.08));
          border: 1px solid var(--border-subtle);
          font-weight: 600;
        }
        .cc-btn.primary {
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark, var(--coral-bright)));
          color: white;
          border-color: transparent;
        }
        .cc-more {
          text-align: center;
          color: var(--text-secondary);
          margin-top: 32px;
          font-size: 0.9rem;
        }
        .cc-more a {
          color: var(--coral-bright);
          text-decoration: none;
        }
      `}</style>
    </div>
  );
}
