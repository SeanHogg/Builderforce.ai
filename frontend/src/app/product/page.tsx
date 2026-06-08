import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/JsonLd';
import { productSchema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import {
  BRAND,
  STATS,
  PRODUCT_SECTIONS,
  FOOTER_LINKS,
} from '@/lib/content';

export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: 'Product — Build, Train, Orchestrate & Govern Your AI Workforce',
  description:
    'Tour everything Builderforce.ai ships: in-browser WebGPU LoRA training, an AI evaluation engine, a skills & personas marketplace, workflow orchestration, a workforce mesh, and full approvals + audit. See the whole platform before you sign up.',
  path: '/product',
  ogTitle: 'The Builderforce.ai Platform — Build, Train, Orchestrate & Govern',
});

export default function ProductPage() {
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

        .pp-footer { border-top: 1px solid var(--border-subtle); padding: 32px 24px; text-align: center; }
        .pp-footer-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px; list-style: none; padding: 0; margin: 0 0 14px; }
        .pp-footer-links a { font-size: 0.82rem; color: var(--text-muted); text-decoration: none; padding: 4px 10px; border-radius: 6px; }
        .pp-footer-links a:hover { color: var(--text-secondary); }
        .pp-footer-copy { font-size: 0.78rem; color: var(--text-muted); }
      `}</style>

      <div className="pp">
        <main>
          <section className="pp-hero">
            <div className="pp-eyebrow">The Platform</div>
            <h1 className="pp-title">Everything your AI workforce needs, in one place</h1>
            <p className="pp-sub">
              Builderforce.ai is your AI CTO, CIO &amp; Security Officer. It builds and trains
              your agents, orchestrates them across a mesh of hosts, and governs every action
              with approvals and an audit trail. Here&apos;s the whole platform — explore any
              part before you sign up.
            </p>
          </section>

          <div className="pp-stats">
            {STATS.marketing.map((s) => (
              <div key={s.label} className="pp-stat">
                <div className="pp-stat-n">{s.value}</div>
                <div className="pp-stat-l">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="pp-sections">
            {PRODUCT_SECTIONS.map((section) => (
              <section key={section.id} className="pp-section" id={section.id}>
                <div className="pp-section-head">
                  <h2 className="pp-section-title">
                    <span className="pp-accent">⟩</span>
                    {section.title}
                  </h2>
                  <p className="pp-section-blurb">{section.blurb}</p>
                </div>
                <div className="pp-grid">
                  {section.surfaces.map((surface) => (
                    <Link key={surface.title} href={surface.href} className="pp-card">
                      <span className="pp-card-icon">{surface.icon}</span>
                      <h3 className="pp-card-title">{surface.title}</h3>
                      <p className="pp-card-desc">{surface.desc}</p>
                      <span className="pp-card-cta">Explore →</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="pp-cta">
            <div className="pp-cta-box">
              <h2 className="pp-cta-title">Put your AI workforce to work</h2>
              <p className="pp-cta-desc">
                Start free — no credit card required. Build, train, and deploy your first
                agent in minutes, entirely in your browser.
              </p>
              <div className="pp-actions">
                <Link href="/register" className="pp-btn-primary">⚡ Get Started Free</Link>
                <Link href="/marketplace" className="pp-btn-secondary">👀 Browse the Workforce</Link>
              </div>
            </div>
          </section>
        </main>

        <footer className="pp-footer">
          <ul className="pp-footer-links">
            {FOOTER_LINKS.map((l) => (
              <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
            ))}
          </ul>
          <p className="pp-footer-copy">Builderforce.ai © {BRAND.year}</p>
        </footer>
      </div>
    </>
  );
}
