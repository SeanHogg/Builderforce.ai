import type { Metadata } from 'next';
import { Fragment } from 'react';
import Link from 'next/link';
import JsonLd from '@/components/JsonLd';
import { compareSchema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import {
  COMPARE,
  COMPARE_FAQ,
  COMPETITORS,
  COMPETITIVE_COMPARISON,
} from '@/lib/content';

export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: COMPARE.seo.title,
  description: COMPARE.seo.description,
  path: '/compare',
  ogTitle: COMPARE.seo.ogTitle,
});

const COL_COUNT = 2 + COMPETITORS.length;

export default function ComparePage() {
  return (
    <>
      <JsonLd data={compareSchema()} />

      <style>{`
        .cmp { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        .cmp-hero { text-align: center; padding: 44px 24px 36px; max-width: 1100px; margin: 0 auto; width: 100%; }
        .cmp-eyebrow {
          font-family: var(--font-display); font-size: 0.78rem; font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px;
        }
        .cmp-title {
          font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.08;
          font-size: clamp(2rem, 5vw, 3.1rem); color: var(--text-primary); margin: 0 0 18px;
        }
        .cmp-sub { font-size: clamp(0.98rem, 2vw, 1.1rem); color: var(--text-secondary); line-height: 1.7; margin: 0; }

        .cmp-pillars {
          max-width: 1100px; margin: 0 auto; padding: 16px 24px 8px; width: 100%;
          display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;
        }
        .cmp-pillar {
          background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 16px; padding: 22px 20px;
        }
        .cmp-pillar-icon { font-size: 1.5rem; margin-bottom: 10px; }
        .cmp-pillar-title { font-family: var(--font-display); font-weight: 600; font-size: 1rem; color: var(--text-primary); margin: 0 0 6px; }
        .cmp-pillar-desc { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; margin: 0; }

        .cmp-section { max-width: 1100px; margin: 0 auto; padding: 28px 24px 8px; width: 100%; }
        .cmp-intro { font-size: 0.97rem; color: var(--text-secondary); line-height: 1.7; max-width: none; margin: 0 0 24px; }

        .cmp-table-wrap {
          overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 16px; background: var(--surface-card);
          -webkit-overflow-scrolling: touch;
        }
        .cmp-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; min-width: 880px; }
        .cmp-table thead th {
          position: sticky; top: 0; z-index: 2; background: var(--surface-card-strong, var(--surface-card));
          padding: 14px 12px; text-align: center; font-family: var(--font-display); font-weight: 600;
          color: var(--text-muted); border-bottom: 2px solid var(--border-subtle); white-space: nowrap;
        }
        .cmp-feat-head { text-align: left !important; left: 0; z-index: 3 !important; }
        .cmp-bf-head { color: var(--coral-bright) !important; border-bottom-color: var(--coral-bright) !important; }

        .cmp-cat-row th {
          text-align: left; padding: 16px 14px 8px; background: transparent;
          border-bottom: 1px solid var(--border-subtle);
        }
        .cmp-cat-title { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; color: var(--text-primary); }
        .cmp-cat-blurb { display: block; font-weight: 400; font-size: 0.8rem; color: var(--text-muted); margin-top: 3px; }

        .cmp-table tbody tr:hover td, .cmp-table tbody tr:hover .cmp-feat { background: var(--surface-card-strong, rgba(255,255,255,0.02)); }
        .cmp-feat {
          position: sticky; left: 0; z-index: 1; text-align: left; padding: 11px 14px; font-weight: 500;
          color: var(--text-primary); background: var(--surface-card); border-bottom: 1px solid var(--border-subtle); min-width: 220px;
        }
        .cmp-note { display: block; font-weight: 400; font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; }
        .cmp-cell {
          text-align: center; padding: 11px 12px; color: var(--text-muted);
          border-bottom: 1px solid var(--border-subtle); white-space: nowrap;
        }
        .cmp-bf {
          text-align: center; padding: 11px 12px; font-weight: 700; color: var(--coral-bright);
          border-bottom: 1px solid var(--border-subtle); background: var(--surface-coral-soft, rgba(255,107,74,0.06)); white-space: nowrap;
        }

        .cmp-quote { max-width: 880px; margin: 36px auto 0; padding: 0 24px; }
        .cmp-quote-box {
          border-left: 3px solid var(--coral-bright); background: var(--surface-card); border-radius: 0 14px 14px 0;
          padding: 22px 26px; font-size: 1.05rem; line-height: 1.65; color: var(--text-primary); font-family: var(--font-display);
        }

        .cmp-faq { max-width: 820px; margin: 8px auto 0; padding: 36px 24px 8px; width: 100%; }
        .cmp-faq h2 { font-family: var(--font-display); font-weight: 700; font-size: 1.5rem; color: var(--text-primary); margin: 0 0 16px; }
        .cmp-faq details {
          border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px 18px; margin-bottom: 10px; background: var(--surface-card);
        }
        .cmp-faq summary { cursor: pointer; font-weight: 600; color: var(--text-primary); font-size: 0.95rem; }
        .cmp-faq details p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.65; margin: 12px 0 0; }

        .cmp-cta { max-width: 820px; margin: 0 auto; padding: 40px 24px 80px; }
        .cmp-cta-box {
          text-align: center; padding: 52px 40px; border-radius: 22px;
          border: 1px solid var(--border-accent); background: var(--surface-card); backdrop-filter: blur(16px);
        }
        .cmp-cta-title { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.5rem, 3.4vw, 2.1rem); color: var(--text-primary); margin: 0 0 12px; }
        .cmp-cta-desc { font-size: 0.97rem; color: var(--text-secondary); max-width: 520px; margin: 0 auto 28px; line-height: 1.65; }
        .cmp-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
        .cmp-btn-primary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: 13px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: #fff;
          font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; text-decoration: none;
          box-shadow: 0 6px 22px var(--shadow-coral-mid); transition: transform 0.22s ease, box-shadow 0.22s ease;
        }
        .cmp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 30px var(--shadow-coral-strong); }
        .cmp-btn-secondary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: 13px;
          border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary);
          font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; text-decoration: none;
        }
        .cmp-btn-secondary:hover { border-color: var(--border-accent); }

      `}</style>

      <div className="cmp">
        <main>
          <section className="cmp-hero">
            <div className="cmp-eyebrow">{COMPARE.hero.eyebrow}</div>
            <h1 className="cmp-title">{COMPARE.hero.title}</h1>
            <p className="cmp-sub">{COMPARE.hero.subtitle}</p>
          </section>

          <div className="cmp-pillars">
            {COMPARE.pillars.map((p) => (
              <div key={p.title} className="cmp-pillar">
                <div className="cmp-pillar-icon">{p.icon}</div>
                <h2 className="cmp-pillar-title">{p.title}</h2>
                <p className="cmp-pillar-desc">{p.desc}</p>
              </div>
            ))}
          </div>

          <section className="cmp-section">
            <p className="cmp-intro">{COMPARE.intro}</p>
            <div className="cmp-table-wrap">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th className="cmp-feat-head">Capability</th>
                    <th className="cmp-bf-head">Builderforce.ai</th>
                    {COMPETITORS.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPETITIVE_COMPARISON.map((cat) => (
                    <Fragment key={cat.id}>
                      <tr className="cmp-cat-row">
                        <th colSpan={COL_COUNT} scope="colgroup">
                          <span className="cmp-cat-title">{cat.title}</span>
                          <span className="cmp-cat-blurb">{cat.blurb}</span>
                        </th>
                      </tr>
                      {cat.rows.map((row) => (
                        <tr key={row.feature}>
                          <th scope="row" className="cmp-feat">
                            {row.feature}
                            {row.note && <span className="cmp-note">{row.note}</span>}
                          </th>
                          <td className="cmp-bf">{row.values.builderforce}</td>
                          {COMPETITORS.map((c) => (
                            <td key={c.key} className="cmp-cell">{row.values[c.key]}</td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="cmp-quote">
            <blockquote className="cmp-quote-box">{COMPARE.quotable}</blockquote>
          </section>

          <section className="cmp-faq">
            <h2>Builderforce.ai vs the field — FAQ</h2>
            {COMPARE_FAQ.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </section>

          <section className="cmp-cta">
            <div className="cmp-cta-box">
              <h2 className="cmp-cta-title">Outgrown autocomplete?</h2>
              <p className="cmp-cta-desc">
                Start free — self-hosted, MIT-licensed, and model-agnostic. Put a whole
                AI agent workforce to work, with approvals and an audit trail on every action.
              </p>
              <div className="cmp-actions">
                <Link href="/register" className="cmp-btn-primary">⚡ Get Started Free</Link>
                <Link href="/product" className="cmp-btn-secondary">👀 Tour the Platform</Link>
              </div>
            </div>
          </section>
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
