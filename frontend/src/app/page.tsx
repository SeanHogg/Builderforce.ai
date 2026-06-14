'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { HOMEPAGE_FAQ, FOOTER_LINKS, COMPARE } from '@/lib/content';
import { savePendingPrompt } from '@/lib/brain';
import { pendingPromptsApi } from '@/lib/builderforceApi';
import { BLOG_POSTS } from '@/lib/blogData';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';
import QuickStart from '@/components/QuickStart';

const HERO_PROMPT_EXAMPLES = [
  'Audit my repo for security issues',
  'Connect Jira and summarize this sprint',
  'Build & train a customer-support agent',
];

export default function LandingPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [nlEmail, setNlEmail] = useState('');
  const [nlStatus, setNlStatus] = useState<'idle'|'sending'|'ok'|'error'>('idle');

  function handlePromptSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    // Stash the prompt, send the visitor through auth; the Brain replays it
    // once they're inside the app (see lib/brain/pendingPrompt + FloatingBrain).
    savePendingPrompt(text);
    pendingPromptsApi.save(text, '/'); // durable, cross-device fallback
    router.push('/register');
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
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 40px 24px 64px;
          gap: 0;
        }

        /* Prompt + mascot row. The prompt is the left column; the agentHost mascot
           sits in a right column on tablet/desktop and is hidden on mobile. */
        .lp-prompt-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 32px;
          width: 100%;
        }
        .lp-prompt-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1 1 auto;
          width: 100%;
          max-width: 640px;
        }

        /* AgentHost mascot — hidden on mobile, shown as the right column ≥820px */
        .lp-hero-mascot {
          display: none;
          width: clamp(180px, 22vw, 260px);
          height: auto;
          flex: 0 0 auto;
          animation: float 4s ease-in-out infinite;
          filter: drop-shadow(0 0 28px var(--logo-glow));
          transition: filter 0.3s ease;
        }
        .lp-hero-mascot:hover {
          animation-play-state: paused;
          filter: drop-shadow(0 0 44px var(--logo-glow-hover));
        }
        @media (min-width: 820px) {
          .lp-prompt-row { flex-direction: row; align-items: center; gap: 48px; }
          .lp-hero-mascot { display: block; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-10px); }
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

        /* Title */
        .lp-title {
          font-family: var(--font-display);
          font-size: clamp(2.6rem, 7.5vw, 5rem);
          font-weight: 700;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin-bottom: 20px;
          background: linear-gradient(
            135deg,
            var(--hero-title-start) 0%,
            var(--coral-bright)     46%,
            var(--hero-title-end)   100%
          );
          background-size: 200% 200%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: gradientShift 7s ease infinite, fadeInUp 0.9s ease-out both;
        }
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50%       { background-position: 100% 50%; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Sub-tagline */
        .lp-tagline {
          font-family: var(--font-display);
          font-size: clamp(0.8rem, 2vw, 0.95rem);
          font-weight: 600;
          color: var(--coral-bright);
          letter-spacing: 0.18em;
          text-transform: uppercase;
          margin-bottom: 20px;
          animation: fadeInUp 0.9s ease-out 0.15s both;
        }

        /* Description */
        .lp-desc {
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          color: var(--text-secondary);
          max-width: 620px;
          line-height: 1.75;
          margin-bottom: 44px;
          animation: fadeInUp 0.9s ease-out 0.3s both;
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

        /* ════════ FOOTER ════════ */
        .lp-footer {
          border-top: 1px solid var(--border-subtle);
          padding: 36px 24px;
          text-align: center;
        }
        .lp-footer-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        .lp-footer-links {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 2px;
          list-style: none;
        }
        .lp-footer-links a {
          font-size: 0.82rem;
          color: var(--text-muted);
          text-decoration: none;
          padding: 4px 10px;
          border-radius: 6px;
          transition: color 0.2s;
        }
        .lp-footer-links a:hover { color: var(--text-secondary); }
        .lp-footer-copy {
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .lp-footer-copy a {
          color: var(--coral-bright);
          text-decoration: none;
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
          <div className="lp-badge">
            <span className="lp-badge-dot" />
            AI CTO · CIO · Security Officer
          </div>

          <h1 className="lp-title">Builderforce.ai</h1>

          <p className="lp-tagline">Your AI CTO, CIO &amp; Security Officer</p>

          <p className="lp-desc">
            One AI brain that runs your technology like an executive team —
            it builds, trains and deploys your AI agent workforce, connects to
            your systems and data, and governs every action with approvals and
            an audit trail. Tell it what you need; it gets to work.
          </p>

          {/* Prompt input (primary action) + agentHost mascot as a right-hand
              column on tablet/desktop; the mascot is hidden on mobile. */}
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
                  placeholder="Describe what you want your AI workforce to do…"
                  rows={3}
                  aria-label="Describe what you want your AI workforce to do"
                />
                <button type="submit" className="lp-prompt-send" disabled={!prompt.trim()}>
                  Get started →
                </button>
              </form>
              <div className="lp-prompt-examples">
                {HERO_PROMPT_EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="lp-chip" onClick={() => setPrompt(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <Image
              src="/agentHost.png"
              alt="Builderforce AI"
              width={240}
              height={240}
              priority
              className="lp-hero-mascot"
            />
          </div>

          <div className="lp-actions">
            <Link href="/register" className="lp-btn-secondary">
              🚀 Start Building Free
            </Link>
            <Link href="/marketplace" className="lp-btn-secondary">
              🤖 Browse Agents
            </Link>
          </div>
        </section>

        {/* ── Quickstart install block ── */}
        <QuickStart />

        {/* ── Stats ── */}
        <div className="lp-stats">
          {[
            { n: '2B+', l: 'Parameters\nin-browser' },
            { n: '<30s', l: 'Dataset\ngeneration' },
            { n: 'WebGPU', l: 'Hardware\naccelerated' },
            { n: '100%', l: 'Private — runs\nin your browser' },
          ].map(s => (
            <div key={s.l} className="lp-stat">
              <div className="lp-stat-number">{s.n}</div>
              <div className="lp-stat-label" style={{ whiteSpace: 'pre-line' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* ── Comparison vs conventional platforms ── */}
        <section className="lp-section" style={{ background: 'var(--surface-card-strong)' }}>
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> Builderforce vs. Conventional Workflows
            </h2>
            <p style={{maxWidth:'none',margin:'0 0 32px',color:'var(--text-secondary)'}}>
              Purpose‑built for AI agents from the ground up — not another cloud notebook or plugin.
            </p>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px',minWidth:'560px'}}>
                <thead>
                  <tr>
                    <th style={{textAlign:'left',padding:'10px 14px',color:'var(--muted)',fontWeight:600,borderBottom:'2px solid var(--border)'}}>Feature</th>
                    <th style={{textAlign:'center',padding:'10px 14px',color:'var(--accent)',fontWeight:700,borderBottom:'2px solid var(--accent)'}}>Builderforce</th>
                    <th style={{textAlign:'center',padding:'10px 14px',color:'var(--muted)',fontWeight:600,borderBottom:'2px solid var(--border)'}}>Generic notebooks</th>
                    <th style={{textAlign:'center',padding:'10px 14px',color:'var(--muted)',fontWeight:600,borderBottom:'2px solid var(--border)'}}>Cloud training</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['In‑browser LoRA training', '✅','❌','⚠️'],
                    ['Dataset generation wizard', '✅','⚠️','❌'],
                    ['AI evaluation engine', '✅','❌','❌'],
                    ['Agent registry & skills', '✅','❌','❌'],
                    ['Global Workforce marketplace', '✅','❌','❌'],
                    ['Zero GPU bills', '✅','❌','⚠️'],
                  ].map((row,i)=>(
                    <tr key={i} style={{background:i%2===0?'transparent':'var(--surface-2)'}}>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid var(--border)'}}>{row[0]}</td>
                      <td style={{textAlign:'center',padding:'9px 14px',borderBottom:'1px solid var(--border)',fontWeight:600,color:'var(--accent)'}}>{row[1]}</td>
                      <td style={{textAlign:'center',padding:'9px 14px',borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>{row[2]}</td>
                      <td style={{textAlign:'center',padding:'9px 14px',borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>{row[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Competitive teaser → /compare ── */}
        <section className="lp-section">
          <div className="lp-features" style={{textAlign:'center'}}>
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> {COMPARE.teaser.title}
            </h2>
            <p style={{maxWidth:'none',margin:'0 auto 28px',color:'var(--text-secondary)'}}>
              {COMPARE.teaser.blurb}
            </p>
            <div className="lp-grid" style={{gap:'14px',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))'}}>
              {COMPARE.teaser.highlightFeatures.map((f)=>(
                <div key={f} className="lp-card" style={{display:'flex',gap:'10px',alignItems:'flex-start',textAlign:'left'}}>
                  <span aria-hidden style={{color:'var(--accent)',fontWeight:700,lineHeight:1.4}}>✅</span>
                  <span style={{fontSize:'0.88rem',color:'var(--text-primary)',lineHeight:1.45}}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop:'28px'}}>
              <Link href="/compare" className="lp-btn-primary">{COMPARE.teaser.ctaLabel} →</Link>
            </div>
          </div>
        </section>

        {/* ── Getting started steps ── */}
        <section className="lp-section">
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> Up and running in three steps
            </h2>
            <div className="lp-grid" style={{gap:'24px'}}>
              {[
                { num:'01', title:'Create an account', desc:'Sign up with your email and start a free workspace. 14‑day Pro trial, no credit card required.' },
                { num:'02', title:'Generate a dataset', desc:'Use the wizard to author an instruction‑tuning dataset from a single capability prompt.' },
                { num:'03', title:'Train & publish', desc:'Run LoRA training in your browser, evaluate results, and publish your agent to the Workforce Registry.' },
              ].map(s=>(
                <div key={s.num} className="lp-card" style={{textAlign:'center'}}>
                  <div style={{fontSize:'2rem',fontWeight:700,color:'var(--accent)',marginBottom:'8px'}}>{s.num}</div>
                  <h3 className="lp-card-title">{s.title}</h3>
                  <p className="lp-card-desc">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section className="lp-features" id="features">
          <h2 className="section-title">
            <span className="agentHost-accent">⟩</span> Your AI executive team
          </h2>
          <div className="lp-grid">
            {[
              { icon: '🧠', title: 'AI CTO', desc: 'Builds, trains and deploys your AI agent workforce — in-browser WebGPU LoRA fine-tuning, evaluation, and one-click publish to the Workforce Registry.' },
              { icon: '🔗', title: 'AI CIO', desc: 'Connects to your systems — GitHub, Jira, Confluence and more via encrypted credentials — and orchestrates work through the Brain’s tool registry.' },
              { icon: '🛡️', title: 'AI Security Officer', desc: 'Governs every action: human-in-the-loop approval gates, a full audit trail, per-tenant isolation, and AES-256-GCM encrypted secrets.' },
              { icon: '🗂️', title: 'AI Dataset Generation', desc: 'Generate instruction-tuning datasets from a single capability prompt using any OpenRouter model. Export as JSONL, stored in R2.' },
              { icon: '🧠', title: 'In-Browser LoRA Training', desc: 'Fine-tune models up to 2B parameters directly in Chrome with WebGPU. No cloud GPU bills, zero round-trips, total privacy.' },
              { icon: '🔬', title: 'AI Evaluation Engine', desc: 'Score your model outputs with an independent AI judge. Get structured quality metrics: correctness, reasoning, hallucination rate.' },
              { icon: '🤖', title: 'Agent Registry', desc: 'Publish your trained agent to the public Workforce Registry with a profile, skills, and eval score. Others can hire it instantly.' },
              { icon: '💾', title: 'R2 Artifact Storage', desc: 'LoRA adapter weights are serialised from WebGPU buffers and automatically persisted to Cloudflare R2 with signed URLs.' },
              { icon: '⚡', title: 'Full IDE Workspace', desc: 'Monaco editor, terminal, AI chat, file explorer — everything you need in one collaborative project workspace.' },
              { icon: '🔐', title: 'Secure Multi-Tenant', desc: 'JWT auth with tenant isolation. Projects, datasets, models, and agents are private and scoped per tenant by default.' },
              { icon: '🌐', title: 'Cloudflare Edge', desc: 'Zero cold-start Worker API with global distribution. COOP/COEP headers enable SharedArrayBuffer for Transformers.js.' },
            ].map(f => (
              <div key={f.title} className="lp-card">
                <span className="lp-card-icon">{f.icon}</span>
                <h3 className="lp-card-title">{f.title}</h3>
                <p className="lp-card-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing section ── */}
        <section className="lp-section" id="pricing" style={{background:'var(--surface-2)'}}>
          <div className="lp-features">
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> Pricing
            </h2>
            <div className="lp-grid" style={{gap:'18px',marginTop:'24px'}}>
              {[
                { name:'Free', price:'$0', perks:['WebGPU training','Workforce browse','Community support'] },
                { name:'Pro', price:'$29/seat', perks:['Unlimited agents','Private models','Priority support'] },
              ].map(p=>(
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
              <span className="agentHost-accent">⟩</span> Latest from the blog
            </h2>
            <p style={{maxWidth:'none',width:'100%',margin:'0 auto 32px',color:'var(--text-secondary)',textAlign:'center'}}>
              Deep dives, tutorials, and best practices for building and deploying
              AI agents — from WebGPU LoRA training to multi-agent orchestration.
            </p>
            <ArticleCardGrid posts={BLOG_POSTS} limit={3} />
            <div style={{marginTop:'32px',textAlign:'center'}}>
              <Link href="/blog" className="lp-btn-secondary">📝 Read all articles →</Link>
            </div>
          </div>
        </section>

        {/* ── Newsletter ── */}
        <section className="lp-section">
          <div className="lp-features" style={{maxWidth:'700px',margin:'0 auto'}}>
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> Stay in the loop
            </h2>
            <p style={{color:'var(--text-secondary)',marginBottom:'24px'}}>Get updates on new features, agents, and platform improvements. No spam, unsubscribe anytime.</p>
            <form onSubmit={handleNewsletterSubmit} style={{display:'flex',gap:'6px',flexWrap:'wrap',justifyContent:'center'}}>
              <input
                type="email"
                placeholder="your@email.com"
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
                {nlStatus==='sending'? 'Subscribing…' : nlStatus==='ok'? 'Subscribed' : 'Subscribe'}
              </button>
            </form>
            {nlStatus==='ok' && <p style={{color:'var(--accent)',marginTop:'12px'}}>Subscribed ✓</p>}
            {nlStatus==='error' && <p style={{color:'var(--error)',marginTop:'12px'}}>Unable to subscribe. Try again.</p>}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="lp-section" style={{background:'var(--surface-card-strong)'}}>
          <div className="lp-features" style={{maxWidth:'800px',margin:'0 auto'}}>
            <h2 className="section-title">
              <span className="agentHost-accent">⟩</span> Frequently asked questions
            </h2>
            {HOMEPAGE_FAQ.map((faq) => (
              <details key={faq.question}><summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="lp-cta-section">
          <div className="lp-cta-box">
            <h2 className="lp-cta-title">Put your AI CTO to work</h2>
            <p className="lp-cta-desc">
              Describe what you need, sign in, and your AI brain gets to work —
              building agents, connecting your systems, and governing every
              action. No credit card required.
            </p>
            <div className="lp-actions">
              <Link href="/register" className="lp-btn-primary">⚡ Get Started Free</Link>
              <Link href="/marketplace" className="lp-btn-secondary">👀 See Live Agents</Link>
            </div>
          </div>
        </section>
        </main>

        {/* ── Footer ── */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <ul className="lp-footer-links">
              {FOOTER_LINKS.map((l) => (
                <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
              ))}
            </ul>
            <p className="lp-footer-copy">
              Built by{' '}
              <a href="https://myvideoresu.me/resumes/seanhogg" target="_blank" rel="noopener">
                Sean Hogg
              </a>
              {' '}· Builderforce.ai © 2026
            </p>
          </div>
        </footer>

      </div>
    </>
  );
}
