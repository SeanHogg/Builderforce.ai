'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { FEATURES, STATS, WORKFLOW_PROOF_DEMOS } from '@/lib/content';
import { BLOG_POSTS } from '@/lib/blogData';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';
import QuickStart from '@/components/QuickStart';
import { DemoShowcase } from '@/components/demo/DemoShowcase';
import { AUTH_API_URL } from '@/lib/auth';
import { LandingCanvasHero } from '@/components/home/LandingCanvasHero';
import { MeetCarousel } from '@/components/home/MeetCarousel';

// Visible copy is sourced from the `home`, `features`, `compare` and `evermind`
// catalog namespaces (localized in all 5 locales). `content.ts` (EVERMIND,
// FEATURES, HOMEPAGE_FAQ, COMPARE) stays canonical English for the crawler-facing
// JSON-LD (homepageSchema) — only non-translatable ICONS are read from it here,
// paired with the translated arrays by index, so the arrays stay length/order-aligned.
type TitleDesc = { title: string; desc: string };
type StatLabel = { label: string };
type FaqItem = { question: string; answer: string };
type PricingTeaser = { name: string; perks: string[] };
type WorkflowProofCopy = { title: string; audience: string; outcome: string; steps: string[]; evidence: string };

export default function LandingPage() {
  const t = useTranslations();
  const [nlEmail, setNlEmail] = useState('');
  const [nlStatus, setNlStatus] = useState<'idle'|'sending'|'ok'|'error'>('idle');
  const [publicPlanPrices, setPublicPlanPrices] = useState<{ pro: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${AUTH_API_URL}/api/tenants/pricing`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`${response.status}`)))
      .then((contract: { pricing: { pro: { monthly: number } } }) => { if (active) setPublicPlanPrices({ pro: contract.pricing.pro.monthly }); })
      .catch(() => { /* Pricing CTA remains available; never invent a fallback price. */ });
    return () => { active = false; };
  }, []);

  async function handleNewsletterSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nlEmail.trim()) return;
    setNlStatus('sending');
    try {
      const res = await fetch('/api/auth/newsletter/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nlEmail.trim(), action: 'subscribe', source: 'builderforce-landing' }),
      });
      if (!res.ok) throw new Error('subscribe failed');
      setNlStatus('ok');
    } catch {
      setNlStatus('error');
    }
  }

  return (
    <>
      <style>{`
        /* ── Scope all landing styles ── */
        .lp {
          position: relative;
          z-index: 1;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* The hero lives in <LandingCanvasHero> (CSS module) — it renders the
           seeded board, so it owns its own layout and theme tokens. */

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* CTA buttons */
        .lp-actions {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          justify-content: center;
          animation: fadeInUp 0.9s ease-out 0.45s both;
        }
        .lp-btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 15px 30px;
          border-radius: 14px;
          background: linear-gradient(135deg, var(--coral-bright) 0%, var(--coral-dark) 100%);
          color: #fff;
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.95rem;
          text-decoration: none;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 6px 22px var(--shadow-coral-mid);
        }
        .lp-btn-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px var(--shadow-coral-strong);
        }
        .lp-btn-secondary {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 15px 30px;
          border-radius: 14px;
          border: 1px solid var(--border-subtle);
          background: var(--surface-card);
          color: var(--text-primary);
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.95rem;
          text-decoration: none;
          backdrop-filter: blur(12px);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .lp-btn-secondary:hover {
          border-color: var(--border-accent);
          transform: translateY(-3px);
          box-shadow: 0 12px 32px var(--shadow-coral-soft);
        }

        .lp-actions { margin-top: 28px; }

        /* ════════ STATS STRIP ════════ */
        .lp-stats {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px 72px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          animation: fadeInUp 0.9s ease-out 0.55s both;
        }
        @media (max-width: 640px) {
          .lp-stats { grid-template-columns: repeat(2, 1fr); }
        }
        .lp-stats-wrap {
          border: 1px solid var(--border-subtle);
          border-radius: 20px;
          overflow: hidden;
          background: var(--surface-card);
          backdrop-filter: blur(12px);
          display: contents;
        }
        .lp-stat {
          padding: 28px 20px;
          text-align: center;
          border-right: 1px solid var(--border-subtle);
          background: var(--surface-card);
          backdrop-filter: blur(12px);
          transition: background 0.2s;
        }
        .lp-stat:first-child { border-radius: 20px 0 0 20px; }
        .lp-stat:last-child  { border-right: none; border-radius: 0 20px 20px 0; }
        @media (max-width: 640px) {
          .lp-stat:nth-child(2) { border-right: none; }
          .lp-stat:nth-child(2) ~ .lp-stat { border-top: 1px solid var(--border-subtle); }
          .lp-stat:first-child { border-radius: 20px 0 0 0; }
          .lp-stat:nth-child(2) { border-radius: 0 20px 0 0; }
          .lp-stat:nth-child(3) { border-radius: 0 0 0 20px; }
          .lp-stat:last-child  { border-radius: 0 0 20px 0; }
        }
        .lp-stat:hover { background: var(--surface-card-strong); }
        .lp-stat-number {
          font-family: var(--font-display);
          font-size: clamp(1.7rem, 3.5vw, 2.4rem);
          font-weight: 700;
          background: linear-gradient(135deg, var(--coral-bright), var(--cyan-bright));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1;
          margin-bottom: 6px;
        }
        .lp-stat-label {
          font-size: 0.8rem;
          color: var(--text-muted);
          line-height: 1.3;
        }

        /* ════════ FEATURES ════════ */
        .lp-features {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px 72px;
        }
        .lp-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 18px;
        }
        .lp-card {
          background: var(--surface-card);
          border: 1px solid var(--border-subtle);
          border-radius: 18px;
          padding: 28px 22px;
          backdrop-filter: blur(12px);
          transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .lp-card:hover {
          border-color: var(--border-accent);
          transform: translateY(-5px);
          box-shadow:
            0 20px 52px var(--shadow-coral-soft),
            inset 0 1px 0 var(--surface-inset-highlight);
        }
        .lp-card-icon {
          font-size: 1.6rem;
          display: block;
          margin-bottom: 14px;
          filter: drop-shadow(0 0 10px var(--cyan-glow));
        }
        .lp-card-title {
          font-family: var(--font-display);
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 7px;
        }
        .lp-card-desc {
          font-size: 0.84rem;
          color: var(--text-secondary);
          line-height: 1.62;
        }

        /* ════════ BOTTOM CTA ════════ */
        .lp-cta-section {
          max-width: 820px;
          margin: 0 auto;
          padding: 0 24px 88px;
        }
        .lp-cta-box {
          padding: 60px 48px;
          border-radius: 24px;
          border: 1px solid var(--border-accent);
          background: linear-gradient(
            135deg,
            rgba(77,158,255,0.08) 0%,
            rgba(10,15,26,0.9)    60%,
            rgba(0,229,204,0.06)  100%
          );
          backdrop-filter: blur(20px);
          text-align: center;
          box-shadow:
            0 0 60px rgba(77,158,255,0.07),
            inset 0 1px 0 var(--surface-inset-highlight);
        }
        .lp-cta-title {
          font-family: var(--font-display);
          font-size: clamp(1.6rem, 3.5vw, 2.3rem);
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 12px;
        }
        .lp-cta-desc {
          font-size: 0.97rem;
          color: var(--text-secondary);
          margin-bottom: 34px;
          max-width: 460px;
          margin-left: auto;
          margin-right: auto;
          line-height: 1.65;
        }

        @media (max-width: 640px) {
          .lp-cta-box { padding: 40px 24px; }
        }
      `}</style>

      <JsonLd data={homepageSchema()} />

      <div className="lp">
        <main>
        {/* ── Hero: the Creation Canvas itself, seeded and running. The visitor
            starts a real guest session from the board; everything below this is
            the marketing page they scrolled for (and what crawlers index). ── */}
        <LandingCanvasHero />

        {/* ── One rotating product story: Create → Evermind → governed delivery ── */}
        <MeetCarousel />

        {/* ── Quickstart install block ── */}
        <QuickStart />

        {/* ── Stats ── */}
        <div className="lp-stats">
          {(t.raw('home.stats') as StatLabel[]).map((s, i) => (
            <div key={i} className="lp-stat">
              <div className="lp-stat-number">{STATS.marketing[i]?.value}</div>
              <div className="lp-stat-label" style={{ whiteSpace: 'pre-line' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Evidence-backed workflows ── */}
        <section className="lp-section" id="workflow-proof" style={{ background: 'var(--surface-card-strong)', scrollMarginTop: '90px' }}>
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('home.workflowProof.heading')}
            </h2>
            <p style={{maxWidth:'none',margin:'0 0 32px',color:'var(--text-secondary)'}}>
              {t('home.workflowProof.lead')}
            </p>
            <div className="lp-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
              {(t.raw('home.workflowProof.demos') as WorkflowProofCopy[]).map((demo, index) => {
                const proof = WORKFLOW_PROOF_DEMOS[index];
                return (
                  <article className="lp-card" key={proof?.id ?? demo.title}>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                      <span style={{border:'1px solid var(--border-accent)',borderRadius:999,padding:'3px 8px',fontSize:'0.7rem',color:'var(--coral-bright)'}}>{t('product.capabilityStatus.beta')}</span>
                      <span style={{border:'1px solid var(--border-subtle)',borderRadius:999,padding:'3px 8px',fontSize:'0.7rem',color:'var(--text-muted)'}}>{t(`product.dataBoundary.${proof?.dataBoundary ?? 'hybrid'}`)}</span>
                    </div>
                    <h3 className="lp-card-title">{demo.title}</h3>
                    <p className="lp-card-desc"><strong>{demo.audience}</strong> — {demo.outcome}</p>
                    <ol style={{paddingLeft:20,color:'var(--text-secondary)',fontSize:'0.84rem',lineHeight:1.6}}>
                      {demo.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                    <p style={{fontSize:'0.78rem',color:'var(--text-muted)',lineHeight:1.5}}>{demo.evidence}</p>
                  </article>
                );
              })}
            </div>
            <div style={{marginTop:24}}><Link href="/product#workflow-proof" className="lp-btn-secondary">{t('home.workflowProof.cta')} →</Link></div>
          </div>
        </section>

        {/* ── Competitive teaser → /compare ── */}
        <section className="lp-section">
          <div className="lp-features" style={{textAlign:'center'}}>
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('compare.teaser.title')}
            </h2>
            <p style={{maxWidth:'none',margin:'0 auto 28px',color:'var(--text-secondary)'}}>
              {t('compare.teaser.blurb')}
            </p>
            <div className="lp-grid" style={{gap:'14px',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))'}}>
              {(t.raw('compare.teaser.highlightFeatures') as string[]).map((f)=>(
                <div key={f} className="lp-card" style={{display:'flex',gap:'10px',alignItems:'flex-start',textAlign:'left'}}>
                  <span aria-hidden style={{color:'var(--accent)',fontWeight:700,lineHeight:1.4}}>✅</span>
                  <span style={{fontSize:'0.88rem',color:'var(--text-primary)',lineHeight:1.45}}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop:'28px'}}>
              <Link href="/compare" className="lp-btn-primary">{t('compare.teaser.ctaLabel')} →</Link>
            </div>
          </div>
        </section>

        {/* ── Getting started steps ── */}
        <section className="lp-section">
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('home.stepsHeading')}
            </h2>
            <div className="lp-grid" style={{gap:'24px'}}>
              {(t.raw('home.steps') as TitleDesc[]).map((s,i)=>(
                <div key={i} className="lp-card" style={{textAlign:'center'}}>
                  <div style={{fontSize:'2rem',fontWeight:700,color:'var(--accent)',marginBottom:'8px'}}>{['01','02','03'][i]}</div>
                  <h3 className="lp-card-title">{s.title}</h3>
                  <p className="lp-card-desc">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Live demo accounts (try before signup) ── */}
        <DemoShowcase />

        {/* ── Features ── */}
        <section className="lp-features" id="features">
          <h2 className="section-title">
            <span className="agentHost-accent">⟩</span> {t('home.featuresHeading')}
          </h2>
          <div className="lp-grid">
            {(t.raw('features') as { title: string; longDesc: string }[]).map((f, i) => (
              <div key={f.title} className="lp-card">
                <span className="lp-card-icon">{FEATURES[i]?.icon}</span>
                <h3 className="lp-card-title">{f.title}</h3>
                <p className="lp-card-desc">{f.longDesc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing section ── */}
        <section className="lp-section" id="pricing" style={{background:'var(--surface-2)'}}>
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('home.pricingHeading')}
            </h2>
            <div className="lp-grid" style={{gap:'18px',marginTop:'24px'}}>
              {(t.raw('home.pricingTeaser') as PricingTeaser[]).map((p, index)=>(
                <div key={p.name} className="lp-card">
                  <h3 className="lp-card-title">{p.name}</h3>
                  <div style={{fontSize:'1.6rem',fontWeight:700,margin:'12px 0'}}>{index === 0 ? '$0' : publicPlanPrices ? `$${publicPlanPrices.pro}${t('home.pricePerSeat')}` : <Link href="/pricing">{t('home.currentPricing')}</Link>}</div>
                  <ul style={{paddingLeft:'16px',fontSize:'0.85rem',color:'var(--text-secondary)'}}>
                    {p.perks.map(perk=><li key={perk}>{perk}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Latest from the blog (SEO content) ── */}
        <section className="lp-section" id="blog">
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('home.blogHeading')}
            </h2>
            <p style={{maxWidth:'none',width:'100%',margin:'0 auto 32px',color:'var(--text-secondary)',textAlign:'center'}}>
              {t('home.blogLead')}
            </p>
            <ArticleCardGrid posts={BLOG_POSTS} limit={3} />
            <div style={{marginTop:'32px',textAlign:'center'}}>
              <Link href="/blog" className="lp-btn-secondary">📝 {t('home.blogReadAll')} →</Link>
            </div>
          </div>
        </section>

        {/* ── Newsletter ── */}
        <section className="lp-section">
          <div className="lp-features" style={{maxWidth:'700px',margin:'0 auto'}}>
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('home.newsletterHeading')}
            </h2>
            <p style={{color:'var(--text-secondary)',marginBottom:'24px'}}>{t('home.newsletterLead')}</p>
            <form onSubmit={handleNewsletterSubmit} style={{display:'flex',gap:'6px',flexWrap:'wrap',justifyContent:'center'}}>
              <input
                type="email"
                placeholder={t('home.newsletterPlaceholder')}
                required
                value={nlEmail}
                onChange={e=>setNlEmail(e.target.value)}
                disabled={nlStatus==='sending' || nlStatus==='ok'}
                style={{padding:'10px 14px',borderRadius:'8px',border:'1px solid var(--border)',width:'250px'}}
              />
              <button
                type="submit"
                disabled={nlStatus==='sending' || nlStatus==='ok'}
                className="lp-btn-primary"
              >
                {nlStatus==='sending'? t('home.newsletterSubscribing') : nlStatus==='ok'? t('home.newsletterSubscribed') : t('home.newsletterSubscribe')}
              </button>
            </form>
            {nlStatus==='ok' && <p style={{color:'var(--accent)',marginTop:'12px'}}>{t('home.newsletterSubscribedConfirm')}</p>}
            {nlStatus==='error' && <p style={{color:'var(--error)',marginTop:'12px'}}>{t('home.newsletterError')}</p>}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="lp-section" style={{background:'var(--surface-card-strong)'}}>
          <div className="lp-features" style={{maxWidth:'800px',margin:'0 auto'}}>
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('home.faqHeading')}
            </h2>
            {(t.raw('home.faq') as FaqItem[]).map((faq) => (
              <details key={faq.question}><summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="lp-cta-section">
          <div className="lp-cta-box">
            <h2 className="lp-cta-title">{t('home.ctaTitle')}</h2>
            <p className="lp-cta-desc">{t('home.ctaDesc')}</p>
            <div className="lp-actions">
              <Link href="/register" className="lp-btn-primary">⚡ {t('marketing.ctaGetStartedFree')}</Link>
              <Link href="/creation-canvas" className="lp-btn-secondary">✦ {t('home.ctaSeeLiveAgents')}</Link>
            </div>
          </div>
        </section>
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}

      </div>
    </>
  );
}
