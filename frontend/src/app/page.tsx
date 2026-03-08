'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggleButton } from './ThemeProvider';

export default function LandingPage() {
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

        /* ════════════════════ NAV ════════════════════ */
        .lp-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .lp-nav-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 24px;
          height: 62px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .lp-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--text-primary);
        }
        .lp-nav-logo img {
          width: 32px;
          height: 32px;
          object-fit: contain;
          filter: drop-shadow(0 0 10px var(--logo-glow));
          transition: filter 0.3s ease, transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
        }
        .lp-nav-logo:hover img {
          filter: drop-shadow(0 0 18px var(--logo-glow-hover));
          transform: scale(1.12) rotate(-6deg);
        }
        .lp-nav-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .lp-nav-link {
          font-size: 0.875rem;
          color: var(--text-secondary);
          text-decoration: none;
          padding: 6px 12px;
          border-radius: 8px;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .lp-nav-link:hover {
          color: var(--text-primary);
          background: var(--surface-interactive);
        }
        .lp-nav-cta {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 18px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark));
          color: #fff;
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.875rem;
          text-decoration: none;
          box-shadow: 0 4px 14px var(--shadow-coral-mid);
          transition: all 0.25s ease;
        }
        .lp-nav-cta:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 22px var(--shadow-coral-strong);
        }

        /* ════════════════════ HERO ════════════════════ */
        .lp-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 80px 24px 64px;
          gap: 0;
        }

        /* Claw mascot */
        .lp-hero-mascot {
          width: clamp(160px, 28vw, 240px);
          height: auto;
          margin-bottom: 28px;
          animation: float 4s ease-in-out infinite;
          filter: drop-shadow(0 0 28px var(--logo-glow));
          transition: filter 0.3s ease;
        }
        .lp-hero-mascot:hover {
          animation-play-state: paused;
          filter: drop-shadow(0 0 44px var(--logo-glow-hover));
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

        /* ════════ STATS STRIP ════════ */
        .lp-stats {
          max-width: 900px;
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
          max-width: 1100px;
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
          max-width: 1100px;
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
          .lp-hero { padding: 60px 20px 48px; }
        }
      `}</style>

      <div className="lp">

        {/* ── Nav ── */}
        <nav className="lp-nav">
          <div className="lp-nav-inner">
            <Link href="/" className="lp-nav-logo">
              <Image src="/claw.png" alt="" width={32} height={32} priority />
              Builderforce.ai
            </Link>
            <div className="lp-nav-right">
              <Link href="/workforce" className="lp-nav-link">Workforce</Link>
              <Link href="/login" className="lp-nav-link">Sign In</Link>
              <ThemeToggleButton />
              <Link href="/register" className="lp-nav-cta">
                Get Started Free →
              </Link>
            </div>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="lp-hero">
          {/* Floating claw mascot */}
          <Image
            src="/claw.png"
            alt="Builderforce AI"
            width={240}
            height={240}
            priority
            className="lp-hero-mascot"
          />

          <div className="lp-badge">
            <span className="lp-badge-dot" />
            AI Agent Training Platform
          </div>

          <h1 className="lp-title">Builderforce.ai</h1>

          <p className="lp-tagline">Build · Train · Deploy AI Agents</p>

          <p className="lp-desc">
            The end-to-end platform for creating custom AI agents.
            Generate datasets, run in-browser LoRA training with WebGPU,
            evaluate with AI judges, and publish to the global Workforce
            Registry — all from a single IDE.
          </p>

          <div className="lp-actions">
            <Link href="/register" className="lp-btn-primary">
              🚀 Start Building Free
            </Link>
            <Link href="/workforce" className="lp-btn-secondary">
              🤖 Browse Agents
            </Link>
          </div>
        </section>

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

        {/* ── Features ── */}
        <section className="lp-features">
          <h2 className="section-title">
            <span className="claw-accent">⟩</span> What You Can Build
          </h2>
          <div className="lp-grid">
            {[
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

        {/* ── Bottom CTA ── */}
        <section className="lp-cta-section">
          <div className="lp-cta-box">
            <h2 className="lp-cta-title">Ready to train your first agent?</h2>
            <p className="lp-cta-desc">
              Create a project, generate a dataset, run LoRA training in your
              browser, and publish to the Workforce in minutes — no credit card required.
            </p>
            <div className="lp-actions">
              <Link href="/register" className="lp-btn-primary">⚡ Get Started Free</Link>
              <Link href="/workforce" className="lp-btn-secondary">👀 See Live Agents</Link>
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <ul className="lp-footer-links">
              <li><Link href="/workforce">Workforce Registry</Link></li>
              <li><Link href="/login">Sign In</Link></li>
              <li><Link href="/register">Get Started</Link></li>
              <li><a href="https://coderclaw.ai" target="_blank" rel="noopener">CoderClaw</a></li>
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
