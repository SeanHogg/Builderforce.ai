import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { Soc2AuditVisual } from '@/components/marketing/Soc2AuditVisual';
import { soc2Schema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('soc2.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/soc2',
    ogTitle: t('ogTitle'),
  });
}

type Criterion = { ref: string; label: string };
type Step = { title: string; desc: string };
type AuditCard = { icon: string; name: string; desc: string };
type Faq = { question: string; answer: string };

export default async function Soc2Page() {
  const t = await getTranslations();

  const criteria = t.raw('soc2.criteria.items') as Criterion[];
  const steps = t.raw('soc2.how.steps') as Step[];
  const audits = t.raw('soc2.family.items') as AuditCard[];
  const faq = t.raw('soc2.faq') as Faq[];

  // Labels for the report mockup (localized; the visual ships no hardcoded copy).
  const visualLabels = {
    title: t('soc2.visual.title'),
    scoreLabel: t('soc2.visual.scoreLabel'),
    scoreValue: '3.4 / 5',
    criteriaHeading: t('soc2.visual.criteriaHeading'),
    criteria: [
      { ref: 'CC1', label: t('soc2.visual.cc.cc1'), state: 'pass' as const },
      { ref: 'CC2', label: t('soc2.visual.cc.cc2'), state: 'partial' as const },
      { ref: 'CC6', label: t('soc2.visual.cc.cc6'), state: 'gap' as const },
      { ref: 'CC7', label: t('soc2.visual.cc.cc7'), state: 'pass' as const },
      { ref: 'CC8', label: t('soc2.visual.cc.cc8'), state: 'partial' as const },
    ],
    stateLabels: { pass: t('soc2.visual.state.pass'), partial: t('soc2.visual.state.partial'), gap: t('soc2.visual.state.gap') },
    findingsHeading: t('soc2.visual.findingsHeading'),
    findings: t.raw('soc2.visual.findings') as string[],
    prBadge: t('soc2.visual.prBadge'),
  };

  return (
    <>
      <JsonLd data={soc2Schema()} />

      <style>{`
        .s2 { color: var(--text-primary); }
        .s2-wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
        .s2-hero { text-align: center; padding: clamp(48px, 8vw, 88px) 20px clamp(28px, 5vw, 48px); }
        .s2-eyebrow {
          display: inline-flex; align-items: center; gap: 8px; font-size: 0.72rem; font-weight: 700;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--coral-bright);
          border: 1px solid var(--border-accent, var(--border-subtle)); border-radius: 999px; padding: 5px 14px; margin-bottom: 20px;
        }
        .s2-title { font-weight: 800; letter-spacing: -0.03em; line-height: 1.08; font-size: clamp(2.1rem, 5.4vw, 3.4rem); margin: 0 auto 16px; max-width: 15ch; }
        .s2-grad { background: linear-gradient(135deg, var(--coral-bright), var(--cyan-bright, #22d3ee)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .s2-sub { font-size: clamp(1rem, 2vw, 1.15rem); color: var(--text-secondary); line-height: 1.65; margin: 0 auto 28px; max-width: 62ch; }
        .s2-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
        .s2-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 13px 26px; border-radius: 12px; background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: #fff; font-weight: 600; font-size: 0.95rem; text-decoration: none; box-shadow: 0 6px 20px var(--shadow-coral-mid, rgba(244,114,110,0.28)); transition: transform 0.2s ease; }
        .s2-btn-primary:hover { transform: translateY(-2px); }
        .s2-btn-secondary { display: inline-flex; align-items: center; gap: 8px; padding: 13px 26px; border-radius: 12px; border: 1px solid var(--border-subtle); background: var(--surface-card, var(--bg-elevated)); color: var(--text-primary); font-weight: 600; font-size: 0.95rem; text-decoration: none; }
        .s2-section { padding: clamp(36px, 6vw, 64px) 0; }
        .s2-section-title { font-weight: 700; font-size: clamp(1.5rem, 3.4vw, 2.1rem); letter-spacing: -0.02em; text-align: center; margin: 0 0 8px; }
        .s2-section-sub { text-align: center; color: var(--text-secondary); font-size: 1rem; max-width: 60ch; margin: 0 auto 32px; line-height: 1.6; }
        .s2-grid { display: grid; gap: 14px; }
        .s2-grid.cc { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
        .s2-grid.steps { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); counter-reset: step; }
        .s2-grid.family { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
        .s2-card { background: var(--surface-card, var(--bg-elevated)); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 18px 18px; }
        .s2-cc-ref { font-weight: 800; color: var(--coral-bright); font-size: 0.82rem; letter-spacing: 0.04em; }
        .s2-cc-label { display: block; margin-top: 4px; color: var(--text-primary); font-size: 0.95rem; line-height: 1.4; }
        .s2-step { position: relative; padding-left: 4px; }
        .s2-step-n { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; background: rgba(244,114,110,0.14); color: var(--coral-bright); font-weight: 800; margin-bottom: 10px; }
        .s2-step-t { font-weight: 700; font-size: 1rem; margin: 0 0 4px; }
        .s2-step-d { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; margin: 0; }
        .s2-audit-icon { font-size: 1.6rem; }
        .s2-audit-name { font-weight: 700; font-size: 1.02rem; margin: 8px 0 4px; }
        .s2-audit-desc { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; margin: 0; }
        .s2-faq { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
        .s2-faq details { background: var(--surface-card, var(--bg-elevated)); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px 18px; }
        .s2-faq summary { font-weight: 600; cursor: pointer; color: var(--text-primary); list-style: none; }
        .s2-faq summary::-webkit-details-marker { display: none; }
        .s2-faq p { color: var(--text-secondary); font-size: 0.94rem; line-height: 1.6; margin: 10px 0 0; }
        .s2-cta { text-align: center; background: var(--surface-card, var(--bg-elevated)); border: 1px solid var(--border-subtle); border-radius: 18px; padding: clamp(28px, 5vw, 48px) 24px; margin: 24px 0 8px; }
        .s2-cta h2 { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 700; margin: 0 0 10px; }
        .s2-cta p { color: var(--text-secondary); margin: 0 auto 22px; max-width: 52ch; line-height: 1.6; }
      `}</style>

      <div className="s2">
        {/* Hero */}
        <section className="s2-hero">
          <div className="s2-wrap">
            <span className="s2-eyebrow">{t('soc2.eyebrow')}</span>
            <h1 className="s2-title">{t('soc2.titleLead')} <span className="s2-grad">{t('soc2.titleAccent')}</span></h1>
            <p className="s2-sub">{t('soc2.sub')}</p>
            <div className="s2-actions">
              <Link href="/register" className="s2-btn-primary">{t('soc2.ctaPrimary')} →</Link>
              <Link href="/tools" className="s2-btn-secondary">{t('soc2.ctaSecondary')}</Link>
            </div>
          </div>
        </section>

        {/* Audit visual */}
        <section className="s2-section" style={{ paddingTop: 0 }}>
          <div className="s2-wrap">
            <h2 className="s2-section-title">{t('soc2.visualSection.title')}</h2>
            <p className="s2-section-sub">{t('soc2.visualSection.sub')}</p>
            <Soc2AuditVisual labels={visualLabels} />
          </div>
        </section>

        {/* What it checks — CC1–CC9 */}
        <section className="s2-section">
          <div className="s2-wrap">
            <h2 className="s2-section-title">{t('soc2.criteria.title')}</h2>
            <p className="s2-section-sub">{t('soc2.criteria.sub')}</p>
            <div className="s2-grid cc">
              {criteria.map((c) => (
                <div key={c.ref} className="s2-card">
                  <span className="s2-cc-ref">{c.ref}</span>
                  <span className="s2-cc-label">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="s2-section">
          <div className="s2-wrap">
            <h2 className="s2-section-title">{t('soc2.how.title')}</h2>
            <p className="s2-section-sub">{t('soc2.how.sub')}</p>
            <div className="s2-grid steps">
              {steps.map((s, i) => (
                <div key={i} className="s2-step">
                  <span className="s2-step-n">{i + 1}</span>
                  <h3 className="s2-step-t">{s.title}</h3>
                  <p className="s2-step-d">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* System audits family */}
        <section className="s2-section">
          <div className="s2-wrap">
            <h2 className="s2-section-title">{t('soc2.family.title')}</h2>
            <p className="s2-section-sub">{t('soc2.family.sub')}</p>
            <div className="s2-grid family">
              {audits.map((a, i) => (
                <div key={i} className="s2-card">
                  <span className="s2-audit-icon">{a.icon}</span>
                  <h3 className="s2-audit-name">{a.name}</h3>
                  <p className="s2-audit-desc">{a.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="s2-section">
          <div className="s2-wrap">
            <h2 className="s2-section-title">{t('soc2.faqTitle')}</h2>
            <div className="s2-faq" style={{ marginTop: 24 }}>
              {faq.map((f, i) => (
                <details key={i}>
                  <summary>{f.question}</summary>
                  <p>{f.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="s2-section" style={{ paddingTop: 0 }}>
          <div className="s2-wrap">
            <div className="s2-cta">
              <h2>{t('soc2.finalCta.title')}</h2>
              <p>{t('soc2.finalCta.sub')}</p>
              <Link href="/register" className="s2-btn-primary">{t('soc2.finalCta.button')} →</Link>
            </div>
            <RelatedArticles surface="soc2" heading={t('soc2.relatedHeading')} />
          </div>
        </section>
      </div>
    </>
  );
}
