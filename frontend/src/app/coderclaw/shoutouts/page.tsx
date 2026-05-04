import type { Metadata } from 'next';
import testimonials from '@/data/coderclaw/testimonials.json';
import extraTestimonials from '@/data/coderclaw/testimonials-extra.json';

export const metadata: Metadata = {
  title: 'Shoutouts — CoderClaw',
  description: 'What developers are saying about CoderClaw. Real praise from engineers, founders, and builders who use CoderClaw autonomous agents every day.',
  alternates: { canonical: '/coderclaw/shoutouts' },
};

interface Testimonial {
  quote: string;
  author: string;
  url: string;
  avatar?: string;
}

export default function ShoutoutsPage() {
  const all = [...testimonials, ...extraTestimonials] as Testimonial[];
  return (
    <div className="cc-page">
      <header className="cc-page-header">
        <h1 className="cc-page-title"><span className="cc-claw-accent">⟩</span> Shoutouts</h1>
        <p className="cc-page-subtitle">What the community is saying about CoderClaw.</p>
      </header>

      <div className="cc-shoutouts-grid">
        {all.map((t, i) => (
          <a key={i} href={t.url} target="_blank" rel="noopener" className="cc-shoutout-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={t.avatar || `https://unavatar.io/x/${t.author}`}
              alt={t.author}
              loading="lazy"
              className="cc-shoutout-avatar"
            />
            <div className="cc-shoutout-content">
              <p className="cc-shoutout-quote">&ldquo;{t.quote}&rdquo;</p>
              <span className="cc-shoutout-author">@{t.author}</span>
            </div>
          </a>
        ))}
      </div>

      <style>{`
        .cc-page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 56px 24px 80px;
        }
        .cc-page-header {
          text-align: center;
          margin-bottom: 40px;
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
        .cc-claw-accent { color: var(--coral-bright); margin-right: 8px; }
        .cc-shoutouts-grid {
          column-count: 1;
          column-gap: 16px;
        }
        @media (min-width: 640px) {
          .cc-shoutouts-grid { column-count: 2; }
        }
        @media (min-width: 1024px) {
          .cc-shoutouts-grid { column-count: 3; }
        }
        .cc-shoutout-card {
          display: flex;
          gap: 12px;
          padding: 18px;
          margin: 0 0 16px;
          break-inside: avoid;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
          color: var(--text-primary);
          text-decoration: none;
          transition: transform 0.15s, border-color 0.15s;
        }
        .cc-shoutout-card:hover {
          transform: translateY(-2px);
          border-color: color-mix(in srgb, var(--coral-bright) 40%, transparent);
        }
        .cc-shoutout-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cc-shoutout-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .cc-shoutout-quote {
          color: var(--text-secondary);
          line-height: 1.55;
          font-size: 0.92rem;
          margin: 0;
        }
        .cc-shoutout-author {
          color: var(--coral-bright);
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}
