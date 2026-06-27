import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import BrainBackdrop from '@/components/BrainBackdrop';
import { evermindSchema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import { EVERMIND, EVERMIND_FAQ } from '@/lib/content';

export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: EVERMIND.seo.title,
  description: EVERMIND.seo.description,
  path: '/evermind',
  ogTitle: EVERMIND.seo.ogTitle,
});

/** Frozen-frontier-model vs Evermind contrast — the core GEO/SEO argument. */
const CONTRAST: { aspect: string; frozen: string; evermind: string }[] = [
  { aspect: 'Knowledge updates', frozen: 'Frozen at training time — needs a retrain, fine-tune, RAG patch, or hand-edit', evermind: 'Written straight through — an update replaces what came before' },
  { aspect: 'Reconciliation', frozen: 'Stale and fresh facts coexist; something must merge them later', evermind: 'Upsert-by-key + invalidate — there is never a reconcile step' },
  { aspect: 'Currency', frozen: 'Goes out of date the moment it ships', evermind: 'Never stale — updates land the moment they happen' },
  { aspect: 'Footprint', frozen: 'Large; runs in the vendor cloud', evermind: 'Runs on WebGPU — in the browser, on-device, or inside every agent' },
  { aspect: 'Ownership', frozen: 'Third-party model, a knowledge cutoff you do not control', evermind: 'Yours end to end — open packages, your data' },
];

export default function EvermindPage() {
  return (
    <>
      <JsonLd data={evermindSchema()} />

      <style>{`
        .ev { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }

        .ev-hero {
          position: relative; overflow: hidden; isolation: isolate;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          text-align: center; min-height: 76vh; padding: 64px 24px 130px;
        }
        .ev-hero-content { position: relative; z-index: 1; width: 100%; max-width: 820px; display: flex; flex-direction: column; align-items: center; }
        .ev-eyebrow {
          display: inline-flex; align-items: center; gap: 8px;
          font-family: var(--font-display); font-size: 0.74rem; font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase; color: var(--cyan-bright);
          border: 1px solid var(--border-accent); border-radius: 999px; padding: 5px 16px;
          margin-bottom: 22px; background: rgba(0,229,204,0.06);
        }
        .ev-title {
          font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.06;
          font-size: clamp(2.4rem, 6vw, 3.8rem); margin: 0 0 18px;
          color: #f0f4ff;
        }
        .ev-title .ev-grad {
          background: linear-gradient(135deg, var(--coral-bright), var(--cyan-bright));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .ev-sub { font-size: clamp(1rem, 2vw, 1.18rem); color: rgba(222,230,246,0.92); line-height: 1.7; margin: 0 0 32px; }
        .ev-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
        .ev-btn-primary {
          display: inline-flex; align-items: center; gap: 8px; padding: 15px 30px; border-radius: 14px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: #fff;
          font-family: var(--font-display); font-weight: 600; font-size: 0.95rem; text-decoration: none;
          box-shadow: 0 6px 22px var(--shadow-coral-mid); transition: transform 0.22s ease, box-shadow 0.22s ease;
        }
        .ev-btn-primary:hover { transform: translateY(-3px); box-shadow: 0 12px 32px var(--shadow-coral-strong); }
        .ev-btn-secondary {
          display: inline-flex; align-items: center; gap: 8px; padding: 15px 30px; border-radius: 14px;
          border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary);
          font-family: var(--font-display); font-weight: 600; font-size: 0.95rem; text-decoration: none; backdrop-filter: blur(12px);
        }
        .ev-btn-secondary:hover { border-color: var(--border-accent); transform: translateY(-3px); }

        .ev-section { max-width: 1100px; margin: 0 auto; padding: 0 24px 64px; width: 100%; }
        .ev-h2 { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.5rem, 3.4vw, 2rem); color: var(--text-primary); margin: 0 0 10px; }
        .ev-h2 .ev-accent { color: var(--coral-bright); margin-right: 8px; }
        .ev-lead { font-size: 1rem; color: var(--text-secondary); line-height: 1.75; max-width: 820px; margin: 0 0 28px; }

        .ev-law {
          display: grid; grid-template-columns: 1fr; gap: 16px; align-items: center;
          border: 1px solid var(--border-accent); border-radius: 22px; padding: 32px;
          background: linear-gradient(135deg, rgba(77,158,255,0.07), rgba(0,229,204,0.05));
        }
        .ev-law-quote { font-family: var(--font-display); font-weight: 600; font-size: clamp(1.1rem, 2.4vw, 1.45rem); line-height: 1.5; color: var(--text-primary); margin: 0; }
        .ev-law-quote em { font-style: normal; color: var(--cyan-bright); }

        .ev-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
        .ev-card { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 16px; padding: 24px 22px; backdrop-filter: blur(12px); }
        .ev-card-icon { font-size: 1.6rem; display: block; margin-bottom: 12px; }
        .ev-card-title { font-family: var(--font-display); font-weight: 600; font-size: 1rem; color: var(--text-primary); margin: 0 0 7px; }
        .ev-card-desc { font-size: 0.86rem; color: var(--text-secondary); line-height: 1.62; margin: 0; }

        .ev-edges { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        @media (max-width: 720px) { .ev-edges { grid-template-columns: 1fr; } }
        .ev-edge { padding: 20px; border-radius: 16px; border: 1px solid var(--border-subtle); background: var(--surface-card); }
        .ev-edge-label { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem;
          background: linear-gradient(135deg, var(--coral-bright), var(--cyan-bright));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; display: block; margin-bottom: 6px; }
        .ev-edge-desc { font-size: 0.86rem; color: var(--text-secondary); line-height: 1.6; }

        .ev-table-wrap { overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 16px; }
        .ev-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; min-width: 640px; }
        .ev-table th { text-align: left; padding: 14px 16px; font-family: var(--font-display); font-weight: 600; border-bottom: 1px solid var(--border-subtle); }
        .ev-table th.ev-col-evermind { color: var(--cyan-bright); }
        .ev-table th.ev-col-frozen { color: var(--text-muted); }
        .ev-table td { padding: 13px 16px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); vertical-align: top; line-height: 1.5; }
        .ev-table td.ev-aspect { color: var(--text-primary); font-weight: 600; }
        .ev-table td.ev-yes { color: var(--text-primary); }
        .ev-table tr:last-child td { border-bottom: none; }

        .ev-faq details { border: 1px solid var(--border-subtle); border-radius: 12px; padding: 4px 18px; margin-bottom: 10px; background: var(--surface-card); }
        .ev-faq summary { cursor: pointer; padding: 14px 0; font-weight: 600; color: var(--text-primary); font-size: 0.98rem; list-style: none; }
        .ev-faq summary::-webkit-details-marker { display: none; }
        .ev-faq details[open] summary { border-bottom: 1px solid var(--border-subtle); }
        .ev-faq p { color: var(--text-secondary); line-height: 1.7; font-size: 0.9rem; padding: 14px 0 16px; margin: 0; }

        .ev-cta { max-width: 820px; margin: 0 auto; padding: 0 24px 80px; }
        .ev-cta-box { text-align: center; padding: 52px 40px; border-radius: 22px; border: 1px solid var(--border-accent); background: var(--surface-card); backdrop-filter: blur(16px); }
        .ev-cta-title { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.5rem, 3.4vw, 2.1rem); color: var(--text-primary); margin: 0 0 12px; }
        .ev-cta-desc { font-size: 0.97rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 28px; line-height: 1.65; }
      `}</style>

      <div className="ev">
        <main>
          {/* ── Hero (over the Evermind brain animation) ── */}
          <section className="ev-hero">
            <BrainBackdrop />
            <div className="ev-hero-content">
              <span className="ev-eyebrow">{EVERMIND.eyebrow}</span>
              <h1 className="ev-title">
                {EVERMIND.name} — the <span className="ev-grad">Builderforce.ai LLM</span>
              </h1>
              <p className="ev-sub">{EVERMIND.tagline}. {EVERMIND.blurb}</p>
              <div className="ev-actions">
                <Link href="/register" className="ev-btn-primary">⚡ Start building free</Link>
                <Link href="/product" className="ev-btn-secondary">Tour the platform →</Link>
              </div>
            </div>
          </section>

          {/* ── Governing law ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> Write-Through Cognition</h2>
            <p className="ev-lead">
              Every frozen frontier model shares one flaw: its knowledge is fixed at training time, and every
              update is a bolt-on. Evermind is governed by a single principle that removes the bolt-on entirely.
            </p>
            <div className="ev-law">
              <p className="ev-law-quote">{EVERMIND.quotable}</p>
            </div>
          </section>

          {/* ── Architecture (the key aspects the brain animation depicts) ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> One brain, three cooperating layers</h2>
            <p className="ev-lead">
              Evermind isn&apos;t a monolith. It&apos;s three layers working together — the same three the hero
              animation lights up as information travels through it.
            </p>
            <div className="ev-grid">
              {EVERMIND.pillars.map((p) => (
                <div key={p.title} className="ev-card">
                  <span className="ev-card-icon">{p.icon}</span>
                  <h3 className="ev-card-title">{p.title}</h3>
                  <p className="ev-card-desc">{p.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Evermind vs a frozen model ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> Evermind vs. a frozen frontier model</h2>
            <p className="ev-lead">
              Evermind isn&apos;t built to out-parameter the biggest models. It wins on the axes their
              architecture structurally trades away.
            </p>
            <div className="ev-table-wrap">
              <table className="ev-table">
                <thead>
                  <tr>
                    <th>Aspect</th>
                    <th className="ev-col-frozen">Frozen frontier model</th>
                    <th className="ev-col-evermind">Evermind</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRAST.map((row) => (
                    <tr key={row.aspect}>
                      <td className="ev-aspect">{row.aspect}</td>
                      <td>{row.frozen}</td>
                      <td className="ev-yes">{row.evermind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Why it wins ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> Why it wins — currency, footprint, ownership</h2>
            <div className="ev-edges">
              {EVERMIND.edges.map((e) => (
                <div key={e.label} className="ev-edge">
                  <span className="ev-edge-label">{e.label}</span>
                  <span className="ev-edge-desc">{e.desc}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── FAQ (GEO) ── */}
          <section className="ev-section ev-faq">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> Evermind FAQ</h2>
            {EVERMIND_FAQ.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </section>

          {/* ── CTA ── */}
          <section className="ev-cta">
            <div className="ev-cta-box">
              <h2 className="ev-cta-title">Build on a model that never goes stale</h2>
              <p className="ev-cta-desc">
                Start free — no credit card required. Put Evermind and your AI workforce to work entirely
                in your browser.
              </p>
              <div className="ev-actions" style={{ justifyContent: 'center' }}>
                <Link href="/register" className="ev-btn-primary">⚡ Get Started Free</Link>
                <Link href="/pricing" className="ev-btn-secondary">See pricing →</Link>
              </div>
            </div>
          </section>

          <RelatedArticles surface="evermind" heading="Go deeper" />
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
