import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import BrainBackdrop from '@/components/BrainBackdrop';
import ModelApiSamples from '@/components/ModelApiSamples';
import { evermindSchema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import { EVERMIND } from '@/lib/content';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('evermind.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/evermind',
    ogTitle: t('ogTitle'),
  });
}

type Pillar = { title: string; desc: string };
type Edge = { label: string; desc: string };
type ContrastRow = { aspect: string; frozen: string; evermind: string };
type Faq = { question: string; answer: string };

export default async function EvermindPage() {
  const t = await getTranslations();
  // Visible copy is sourced from the `evermind` catalog (single source for UI,
  // localized in all 5 locales). `content.ts` EVERMIND stays canonical English
  // for the crawler-facing JSON-LD (evermindSchema) — pillar ICONS are paired
  // from it by index, so the two arrays must stay the same length and order.
  const pillars = t.raw('evermind.architecture.pillars') as Pillar[];
  const edges = t.raw('evermind.edges.items') as Edge[];
  const contrast = t.raw('evermind.contrast.rows') as ContrastRow[];
  const faq = t.raw('evermind.faq') as Faq[];

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

        .ev-figure { width: 100%; height: auto; display: block; border-radius: 16px; border: 1px solid var(--border-subtle); margin: 18px 0 6px; background: #0e1525; }
        .ev-figcap { font-size: 0.8rem; color: var(--text-muted); margin: 0 0 4px; text-align: center; }
        .ev-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 14px; counter-reset: ev-step; }
        @media (max-width: 760px) { .ev-steps { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 460px) { .ev-steps { grid-template-columns: 1fr; } }
        .ev-step { position: relative; padding: 22px 18px 18px; border-radius: 16px; border: 1px solid var(--border-subtle); background: var(--surface-card); }
        .ev-step::before { counter-increment: ev-step; content: counter(ev-step); display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 999px; font-family: var(--font-display); font-weight: 700; font-size: 0.85rem; color: #fff;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); margin-bottom: 12px; }
        .ev-step-title { font-family: var(--font-display); font-weight: 600; font-size: 0.95rem; color: var(--text-primary); margin: 0 0 6px; }
        .ev-step-desc { font-size: 0.82rem; color: var(--text-secondary); line-height: 1.55; margin: 0; }
        .ev-api { border: 1px solid var(--border-subtle); border-radius: 18px; padding: 24px; background: var(--surface-card); }
      `}</style>

      <div className="ev">
        <main>
          {/* ── Hero (over the Evermind brain animation) ── */}
          <section className="ev-hero">
            <BrainBackdrop />
            <div className="ev-hero-content">
              <span className="ev-eyebrow">{t('evermind.eyebrow')}</span>
              <h1 className="ev-title">
                {t.rich('evermind.title', { grad: (c) => <span className="ev-grad">{c}</span> })}
              </h1>
              {/* One clean subline — the full Write-Through Cognition blurb lives
                  in the section directly below, so the hero stays readable over
                  the brain animation (bolt.new-clean). */}
              <p className="ev-sub">{t('evermind.tagline')}.</p>
              <div className="ev-actions">
                <Link href="/register" className="ev-btn-primary">⚡ {t('marketing.ctaStartBuildingFree')}</Link>
                <Link href="/product" className="ev-btn-secondary">{t('marketing.ctaTourPlatform')} →</Link>
              </div>
            </div>
          </section>

          {/* ── Governing law ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.law.heading')}</h2>
            <p className="ev-lead">{t('evermind.law.lead')}</p>
            <div className="ev-law">
              <p className="ev-law-quote">{t('evermind.law.quote')}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ev-figure"
              src="/blog/aw-write-through.svg"
              alt={t('evermind.alt.writeThrough')}
              loading="lazy"
              width={1600}
              height={900}
            />
            <p className="ev-figcap">{t('evermind.law.figcap')}</p>
          </section>

          {/* ── Architecture (the key aspects the brain animation depicts) ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.architecture.heading')}</h2>
            <p className="ev-lead">{t('evermind.architecture.lead')}</p>
            <div className="ev-grid">
              {pillars.map((p, i) => (
                <div key={p.title} className="ev-card">
                  <span className="ev-card-icon">{EVERMIND.pillars[i]?.icon}</span>
                  <h3 className="ev-card-title">{p.title}</h3>
                  <p className="ev-card-desc">{p.desc}</p>
                </div>
              ))}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ev-figure"
              src="/blog/aw-architecture.svg"
              alt={t('evermind.alt.architecture')}
              loading="lazy"
              width={1600}
              height={900}
            />
            <p className="ev-figcap">{t('evermind.architecture.figcap')}</p>
          </section>

          {/* ── Evermind vs a frozen model ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.contrast.heading')}</h2>
            <p className="ev-lead">{t('evermind.contrast.lead')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ev-figure"
              src="/blog/aw-frozen-vs-evermind.svg"
              alt={t('evermind.alt.frozenVsEvermind')}
              loading="lazy"
              width={1600}
              height={900}
            />
            <p className="ev-figcap">{t('evermind.contrast.figcap')}</p>
            <div className="ev-table-wrap">
              <table className="ev-table">
                <thead>
                  <tr>
                    <th>{t('evermind.contrast.colAspect')}</th>
                    <th className="ev-col-frozen">{t('evermind.contrast.colFrozen')}</th>
                    <th className="ev-col-evermind">{t('evermind.contrast.colEvermind')}</th>
                  </tr>
                </thead>
                <tbody>
                  {contrast.map((row) => (
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
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.edges.heading')}</h2>
            <div className="ev-edges">
              {edges.map((e) => (
                <div key={e.label} className="ev-edge">
                  <span className="ev-edge-label">{e.label}</span>
                  <span className="ev-edge-desc">{e.desc}</span>
                </div>
              ))}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ev-figure"
              src="/blog/aw-three-edges.svg"
              alt={t('evermind.alt.threeEdges')}
              loading="lazy"
              width={1600}
              height={900}
            />
            <p className="ev-figcap">{t('evermind.edges.figcap')}</p>
          </section>

          {/* ── Lifecycle: train → validate → publish → call ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.lifecycle.heading')}</h2>
            <p className="ev-lead">{t('evermind.lifecycle.lead')}</p>
            <div className="ev-steps">
              {(t.raw('evermind.lifecycle.steps') as Pillar[]).map((s) => (
                <div key={s.title} className="ev-step">
                  <h3 className="ev-step-title">{s.title}</h3>
                  <p className="ev-step-desc">{s.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Call it over the API ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.api.heading')}</h2>
            <p className="ev-lead">{t('evermind.api.lead')}</p>
            <div className="ev-api">
              <ModelApiSamples />
            </div>
          </section>

          {/* ── FAQ (GEO) ── */}
          <section className="ev-section ev-faq">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.faqHeading')}</h2>
            {faq.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </section>

          {/* ── The adoption case: workforce + owned stack ── */}
          <section className="ev-section">
            <h2 className="ev-h2"><span className="ev-accent">⟩</span> {t('evermind.adoption.heading')}</h2>
            <p className="ev-lead">{t('evermind.adoption.lead')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ev-figure"
              src="/blog/aw-workforce.svg"
              alt={t('evermind.alt.workforce')}
              loading="lazy"
              width={1600}
              height={900}
            />
            <p className="ev-figcap">{t('evermind.adoption.figcapBoard')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ev-figure"
              src="/blog/aw-platform-stack.svg"
              alt={t('evermind.alt.platformStack')}
              loading="lazy"
              width={1600}
              height={900}
            />
            <p className="ev-figcap">{t('evermind.adoption.figcapStack')}</p>
            <div className="ev-actions" style={{ marginTop: 22 }}>
              <Link href="/blog/transitioning-to-an-agentic-workforce" className="ev-btn-secondary">
                {t('evermind.adoption.readLink')}
              </Link>
            </div>
          </section>

          {/* ── CTA ── */}
          <section className="ev-cta">
            <div className="ev-cta-box">
              <h2 className="ev-cta-title">{t('evermind.cta.title')}</h2>
              <p className="ev-cta-desc">{t('evermind.cta.desc')}</p>
              <div className="ev-actions" style={{ justifyContent: 'center' }}>
                <Link href="/register" className="ev-btn-primary">⚡ {t('marketing.ctaGetStartedFree')}</Link>
                <Link href="/pricing" className="ev-btn-secondary">{t('marketing.ctaSeePricing')} →</Link>
              </div>
            </div>
          </section>

          <RelatedArticles surface="evermind" heading={t('evermind.relatedHeading')} />
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
