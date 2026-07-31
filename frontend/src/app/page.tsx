'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { FEATURES, EVERMIND } from '@/lib/content';
import { savePendingPrompt } from '@/lib/brain';
import { pendingPromptsApi } from '@/lib/builderforceApi';
import { BLOG_POSTS } from '@/lib/blogData';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';
import QuickStart from '@/components/QuickStart';
import BrainBackdrop from '@/components/BrainBackdrop';
import { DemoShowcase } from '@/components/demo/DemoShowcase';

// Visible copy is sourced from the `home`, `features`, `compare` and `evermind`
// catalog namespaces (localized in all 5 locales). `content.ts` (EVERMIND,
// FEATURES, HOMEPAGE_FAQ, COMPARE) stays canonical English for the crawler-facing
// JSON-LD (homepageSchema) — only non-translatable ICONS are read from it here,
// paired with the translated arrays by index, so the arrays stay length/order-aligned.
type TitleDesc = { title: string; desc: string };
type RoleDesc = { role: string; desc: string };
type StatLabel = { label: string };
type FaqItem = { question: string; answer: string };
type PricingTeaser = { name: string; price: string; perks: string[] };

export default function LandingPage() {
  const router = useRouter();
  const t = useTranslations();
  const [prompt, setPrompt] = useState('');
  const [nlEmail, setNlEmail] = useState('');
  const [nlStatus, setNlStatus] = useState<'idle'|'sending'|'ok'|'error'>('idle');

  function handlePromptSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    // Answer the prompt immediately as a GUEST — no login wall. /brainstorm renders
    // the guest chat for logged-out visitors and auto-sends ?prompt=. We still stash
    // it (durable, cross-device) so if they later sign up mid-thought the authed
    // Brain can replay it. See GuestBrainstormPage + lib/brain/pendingPrompt.
    savePendingPrompt(text);
    pendingPromptsApi.save(text, '/');
    router.push(`/brainstorm?prompt=${encodeURIComponent(text)}`);
  }

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

        /* ════════════════════ HERO ════════════════════ */
        .lp-hero {
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          min-height: 84vh;
          padding: 56px 24px 170px;
          gap: 0;
          isolation: isolate; /* own stacking context so the wave sits behind content only */
        }
        /* Hero content rides above the Evermind brain backdrop. */
        .lp-hero-content {
          position: relative;
          z-index: 1;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        /* Hero headline — the single dominant line (bolt.new-clean). */
        .lp-hero-title {
          font-family: var(--font-display);
          font-size: clamp(2.4rem, 6vw, 4rem);
          font-weight: 700;
          line-height: 1.04;
          letter-spacing: -0.02em;
          color: rgba(236, 242, 255, 0.98);
          margin: 0 0 14px;
          max-width: 16ch;
          animation: fadeInUp 0.8s ease-out both;
        }
        .lp-hero-title em {
          font-style: italic;
          background: linear-gradient(135deg, var(--coral-bright), var(--cyan-bright));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .lp-hero-sub {
          font-size: clamp(1rem, 2.2vw, 1.2rem);
          color: rgba(214, 224, 244, 0.78);
          line-height: 1.55;
          max-width: 540px;
          margin: 0 0 34px;
          animation: fadeInUp 0.9s ease-out 0.15s both;
        }

        /* Prompt row — the prompt sits centred (the mascot now lives below it,
           centred on the page, rather than in a right-hand column). */
        .lp-prompt-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
        }
        .lp-prompt-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 640px;
        }

        /* Badge */
        .lp-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--surface-coral-soft);
          border: 1px solid var(--border-accent);
          border-radius: 999px;
          padding: 5px 16px;
          font-family: var(--font-display);
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--coral-bright);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 28px;
          animation: fadeInUp 0.6s ease-out both;
        }
        .lp-badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--cyan-bright);
          box-shadow: 0 0 8px var(--cyan-glow);
          animation: pulse 2.2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(0.75); opacity: 0.55; }
        }

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

        /* ════════ HERO PROMPT INPUT ════════ */
        .lp-prompt {
          width: 100%;
          max-width: 640px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px;
          border-radius: 18px;
          border: 1px solid var(--border-accent);
          background: var(--surface-card);
          backdrop-filter: blur(12px);
          box-shadow: 0 12px 40px var(--shadow-coral-soft), inset 0 1px 0 var(--surface-inset-highlight);
          animation: fadeInUp 0.9s ease-out 0.45s both;
        }
        .lp-prompt-input {
          width: 100%;
          resize: vertical;
          min-height: 64px;
          border: none;
          background: transparent;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 1rem;
          line-height: 1.6;
          outline: none;
        }
        .lp-prompt-input::placeholder { color: var(--text-muted); }
        .lp-prompt-send {
          align-self: flex-end;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 26px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--coral-bright) 0%, var(--coral-dark) 100%);
          color: #fff;
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          box-shadow: 0 6px 22px var(--shadow-coral-mid);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .lp-prompt-send:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px var(--shadow-coral-strong);
        }
        .lp-prompt-send:disabled { opacity: 0.5; cursor: not-allowed; }
        .lp-prompt-examples {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
          max-width: 640px;
          margin: 16px 0 4px;
          animation: fadeInUp 0.9s ease-out 0.55s both;
        }
        .lp-chip {
          padding: 7px 14px;
          border-radius: 999px;
          border: 1px solid var(--border-subtle);
          background: var(--surface-card);
          color: var(--text-secondary);
          font-size: 0.82rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .lp-chip:hover {
          border-color: var(--border-accent);
          color: var(--text-primary);
          background: var(--surface-interactive);
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

        /* ════════ EVERMIND ════════ */
        .lp-evermind-eyebrow {
          display: inline-block;
          font-family: var(--font-display);
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--cyan-bright);
          margin-bottom: 10px;
        }
        .lp-evermind-edges {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-top: 22px;
        }
        @media (max-width: 640px) {
          .lp-evermind-edges { grid-template-columns: 1fr; }
        }
        .lp-evermind-edge {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 16px 18px;
          border-radius: 14px;
          border: 1px solid var(--border-subtle);
          background: var(--surface-card);
          backdrop-filter: blur(12px);
        }
        .lp-evermind-edge-label {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.9rem;
          background: linear-gradient(135deg, var(--coral-bright), var(--cyan-bright));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .lp-evermind-edge-desc {
          font-size: 0.82rem;
          color: var(--text-secondary);
          line-height: 1.55;
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
          .lp-hero { padding: 28px 20px 48px; }
        }
      `}</style>

      <JsonLd data={homepageSchema()} />

      <div className="lp">
        <main>
        {/* ── Hero ── */}
        <section className="lp-hero">
          {/* Evermind — the platform's brain — behind the hero: information
              packets travel the synapses, hubs stand for the key aspects of the
              platform. Pure backdrop; content sits above via .lp-hero-content. */}
          <BrainBackdrop className="lp-hero-wave" />
          <div className="lp-hero-content">
          <div className="lp-badge">
            <span className="lp-badge-dot" />
            {t('home.heroBadge')}
          </div>

          {/* One dominant headline + one subline, then the prompt — the hero's
              single primary action (bolt.new-clean; no competing paragraphs). */}
          <h1 className="lp-hero-title">
            {t.rich('home.heroTitle', { em: (c) => <em>{c}</em> })}
          </h1>
          <p className="lp-hero-sub">{t('home.heroSub')}</p>

          <div className="lp-prompt-row">
            <div className="lp-prompt-col">
              <form onSubmit={handlePromptSubmit} className="lp-prompt">
                <textarea
                  className="lp-prompt-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePromptSubmit(e); }
                  }}
                  placeholder={t('home.heroPromptPlaceholder')}
                  rows={3}
                  aria-label={t('home.heroPromptAria')}
                />
                <button type="submit" className="lp-prompt-send" disabled={!prompt.trim()}>
                  {t('home.heroGetStarted')} →
                </button>
              </form>
              <div className="lp-prompt-examples">
                {(t.raw('home.heroExamples') as string[]).map((ex) => (
                  <button key={ex} type="button" className="lp-chip" onClick={() => setPrompt(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
          </div>
        </section>

        {/* ── Evermind: the brain behind the platform (what the hero animation depicts) ── */}
        <section className="lp-features" id="evermind" style={{ paddingTop: 0, scrollMarginTop: '90px' }}>
          <div className="lp-evermind">
            <span className="lp-evermind-eyebrow">{t('evermind.eyebrow')}</span>
            <h2 className="section-title" style={{ marginBottom: 8 }}>
              <span className="agentHost-accent">⟩</span> Evermind — {t('evermind.tagline')}
            </h2>
            <p style={{ maxWidth: '780px', margin: '0 0 28px', color: 'var(--text-secondary)' }}>
              {t('evermind.blurb')}
            </p>
            <div className="lp-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
              {(t.raw('evermind.architecture.pillars') as TitleDesc[]).map((p, i) => (
                <div key={p.title} className="lp-card">
                  <span className="lp-card-icon">{EVERMIND.pillars[i]?.icon}</span>
                  <h3 className="lp-card-title">{p.title}</h3>
                  <p className="lp-card-desc">{p.desc}</p>
                </div>
              ))}
            </div>
            <div className="lp-evermind-edges">
              {(t.raw('evermind.edges.items') as { label: string; desc: string }[]).map((e) => (
                <div key={e.label} className="lp-evermind-edge">
                  <span className="lp-evermind-edge-label">{e.label}</span>
                  <span className="lp-evermind-edge-desc">{e.desc}</span>
                </div>
              ))}
            </div>
            <div className="lp-actions" style={{ marginTop: 24 }}>
              <Link href="/evermind" className="lp-btn-primary">🧠 {t('evermind.exploreCta')} →</Link>
            </div>
          </div>
        </section>

        {/* ── Pillars: the human-in-the-loop, fully agentic framing ── */}
        <section className="lp-features" style={{ paddingTop: 0 }}>
          <h2 className="section-title">
            <span className="agentHost-accent">⟩</span> {t('home.pillarsHeading')}
          </h2>
          <p style={{ maxWidth: 'none', margin: '0 0 32px', color: 'var(--text-secondary)' }}>
            {t('home.pillarsLead')}
          </p>
          <div className="lp-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
            {(t.raw('home.pillars') as TitleDesc[]).map((p, i) => (
              <div key={p.title} className="lp-card">
                <span className="lp-card-icon">{['🔁', '▦', '🧩'][i]}</span>
                <h3 className="lp-card-title">{p.title}</h3>
                <p className="lp-card-desc">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Enterprise framing: one instrumented system → every role's operating picture ── */}
        <section className="lp-features" style={{ paddingTop: 0 }}>
          <h2 className="section-title">
            <span className="agentHost-accent">⟩</span> {t('home.rolesHeading')}
          </h2>
          <p style={{ maxWidth: 'none', margin: '0 0 32px', color: 'var(--text-secondary)' }}>
            {t('home.rolesLead')}
          </p>
          <div className="lp-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
            {(t.raw('home.roles') as RoleDesc[]).map((p, i) => (
              <div key={p.role} className="lp-card">
                <span className="lp-card-icon">{['🧭', '⚙️', '💰', '🗂️', '🛡️', '👥'][i]}</span>
                <h3 className="lp-card-title">{p.role}</h3>
                <p className="lp-card-desc">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Quickstart install block ── */}
        <QuickStart />

        {/* ── Stats ── */}
        <div className="lp-stats">
          {(t.raw('home.stats') as StatLabel[]).map((s, i) => (
            <div key={i} className="lp-stat">
              <div className="lp-stat-number">{['2B+', '<30s', 'WebGPU', '100%'][i]}</div>
              <div className="lp-stat-label" style={{ whiteSpace: 'pre-line' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Comparison vs conventional platforms ── */}
        <section className="lp-section" style={{ background: 'var(--surface-card-strong)' }}>
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {t('home.comparisonHeading')}
            </h2>
            <p style={{maxWidth:'none',margin:'0 0 32px',color:'var(--text-secondary)'}}>
              {t('home.comparisonLead')}
            </p>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px',minWidth:'560px'}}>
                <thead>
                  <tr>
                    <th style={{textAlign:'left',padding:'10px 14px',color:'var(--muted)',fontWeight:600,borderBottom:'2px solid var(--border)'}}>{t('home.comparisonColFeature')}</th>
                    <th style={{textAlign:'center',padding:'10px 14px',color:'var(--accent)',fontWeight:700,borderBottom:'2px solid var(--accent)'}}>{t('home.comparisonColBuilderforce')}</th>
                    <th style={{textAlign:'center',padding:'10px 14px',color:'var(--muted)',fontWeight:600,borderBottom:'2px solid var(--border)'}}>{t('home.comparisonColNotebooks')}</th>
                    <th style={{textAlign:'center',padding:'10px 14px',color:'var(--muted)',fontWeight:600,borderBottom:'2px solid var(--border)'}}>{t('home.comparisonColCloud')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(t.raw('home.comparisonRows') as string[]).map((feature,i)=>{
                    const marks = [['✅','❌','⚠️'],['✅','⚠️','❌'],['✅','❌','❌'],['✅','❌','❌'],['✅','❌','❌'],['✅','❌','⚠️']][i];
                    return (
                    <tr key={i} style={{background:i%2===0?'transparent':'var(--surface-2)'}}>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid var(--border)'}}>{feature}</td>
                      <td style={{textAlign:'center',padding:'9px 14px',borderBottom:'1px solid var(--border)',fontWeight:600,color:'var(--accent)'}}>{marks[0]}</td>
                      <td style={{textAlign:'center',padding:'9px 14px',borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>{marks[1]}</td>
                      <td style={{textAlign:'center',padding:'9px 14px',borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>{marks[2]}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
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
              {(t.raw('home.pricingTeaser') as PricingTeaser[]).map(p=>(
                <div key={p.name} className="lp-card">
                  <h3 className="lp-card-title">{p.name}</h3>
                  <div style={{fontSize:'1.6rem',fontWeight:700,margin:'12px 0'}}>{p.price}</div>
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
              <Link href="/marketplace" className="lp-btn-secondary">👀 {t('home.ctaSeeLiveAgents')}</Link>
            </div>
          </div>
        </section>
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}

      </div>
    </>
  );
}
