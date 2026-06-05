import type { Metadata } from 'next';
import testimonials from '@/data/agents/testimonials.json';
import extraTestimonials from '@/data/agents/testimonials-extra.json';
import ShoutoutsView, { type Testimonial } from './ShoutoutsView';

export const metadata: Metadata = {
  title: 'Shoutouts — BuilderForce Agents',
  description: 'What developers are saying about BuilderForce Agents. Real praise from engineers, founders, and builders who use BuilderForce Agents autonomous agents every day.',
  alternates: { canonical: '/agents/shoutouts' },
};

export default function ShoutoutsPage() {
  const all = [...testimonials, ...extraTestimonials] as Testimonial[];
  return (
    <div className="cc-page">
      <ShoutoutsView all={all} />

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
        .cc-agentHost-accent { color: var(--coral-bright); margin-right: 8px; }
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
        .cc-shoutouts-toolbar {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 16px;
        }
        .cc-shoutout-tauthor {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          white-space: nowrap;
        }
        .cc-shoutout-tavatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cc-shoutout-thandle {
          color: var(--coral-bright);
          text-decoration: none;
          white-space: nowrap;
        }
        .cc-shoutout-thandle:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
