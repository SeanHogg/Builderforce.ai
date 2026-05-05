import Image from 'next/image';
import Link from 'next/link';
import QuickStart from './QuickStart';
import FeatureCard from './FeatureCard';
import NewsletterForm from './NewsletterForm';

const FEATURES = [
  {
    href: '/docs/getting-started',
    title: 'Agent & Sub-agent Manager',
    description:
      'CoderClaw runs and coordinates independent coding agents and sub-agents. Delegate work autonomously across your entire workflow.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/></svg>,
  },
  {
    href: '/',
    title: 'Mesh Orchestration',
    description: 'Builderforce.ai is the project management and mesh orchestrator — coordinating agents, tasks, and outcomes across your entire team.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="7" y1="6.5" x2="10" y2="10"/><line x1="17" y1="6.5" x2="14" y2="10"/><line x1="7" y1="17.5" x2="10" y2="14"/><line x1="17" y1="17.5" x2="14" y2="14"/></svg>,
  },
  {
    href: '/docs/getting-started',
    title: 'Business Outcome Focus',
    description: 'Transition from writing code to managing business outcomes. Let the agents handle execution while you focus on strategy.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  },
  {
    href: '/docs/coderclaw-overview',
    title: 'Self-Healing Runtime',
    description: 'Agents detect failures, fix themselves, and adapt over time. Persistent memory means context survives restarts — no re-explaining your codebase.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  },
  {
    href: '/approvals',
    title: 'Human-in-the-Loop Control',
    description: 'Approval gates block agent execution until a manager approves in the Builderforce.ai portal. Workflow visibility, auditability, and human sign-off — enforced, not optional.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
  {
    href: '/docs/coderclaw-link',
    title: 'Claw-to-Claw Mesh',
    description: <>Distribute work across a fleet of Claws. Use <code>remote:auto[caps]</code> to route tasks to the best-matched peer. All dispatch is HMAC-signed and Bearer-authenticated.</>,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  },
  {
    href: '/docs/browser',
    title: 'Full Automation',
    description: 'Agents can browse the web, control your browser, run shell commands, and interact with any tool or service on your behalf.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  },
  {
    href: '/docs/bash',
    title: 'Full System Access',
    description: 'Read and write files, run shell commands, execute scripts. Full access or sandboxed — your choice.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  },
  {
    href: '/coderclaw/skills',
    title: 'Skills & Plugins',
    description: 'Extend with community skills or build your own. Skills assigned in the Builderforce.ai portal are loaded automatically at startup.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/></svg>,
  },
  {
    href: '/docs/deep-understanding',
    title: 'Deep Codebase Understanding',
    description: 'AST parsing, semantic maps, dependency graphs and git history give agents real comprehension of your project.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  },
  {
    href: '/docs/coderclaw-workflows',
    title: 'Multi-Agent Workflows',
    description: 'Built-in patterns for planning, feature dev, bug fixes, refactors and adversarial reviews keep work moving.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  },
  {
    href: '/security',
    title: 'Security & RBAC',
    description: 'Role-based access control, device trust, and complete audit trails. HMAC-signed inter-Claw dispatch with Bearer authentication.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  },
  {
    href: '/observability',
    title: 'Workflow Telemetry',
    description: 'Every task and workflow emits structured JSONL spans locally and forwards to the Builderforce.ai portal timeline in real time.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  {
    href: 'https://github.com/seanhogg/coderclaw',
    title: 'Self-Hosted & Open Source',
    description: 'Run on your infrastructure under the MIT license — no vendor lock-in or subscription ceilings.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  },
];

export default function CoderClawHome() {
  return (
    <>
      <div className="cc-stars" aria-hidden />
      <div className="cc-nebula" aria-hidden />
      <div className="cc-page">
        <header className="cc-hero">
          <div className="cc-lobster">
            <Image src="/coderclaw.png" alt="CoderClaw logo" width={140} height={140} priority />
          </div>
          <h1 className="cc-title">CoderClaw</h1>
          <p className="cc-tagline">Self-hosted, developer-first multi-agent coding workflows.</p>
          <p className="cc-description">
            Transition from coding to managing business outcomes.<br />
            <strong>CoderClaw</strong> manages independent agents &amp; sub-agents with persistent memory &amp; self-repair.{' '}
            <strong>
              <Link href="/" className="cc-link">Builderforce.ai</Link>
            </strong>{' '}
            orchestrates projects across your entire mesh.
          </p>
        </header>

        <QuickStart />

        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-claw-accent">⟩</span> What It Does</h2>
          <div className="cc-features-grid">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </section>

        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-claw-accent">⟩</span> Why CoderClaw?</h2>
          <p className="cc-prose">
            Self-hosted, multi-agent orchestration built for developers — from startups (5–50 devs) to enterprises (100–1,000+).
            Key differentiators:
          </p>
          <ul className="cc-prose-list">
            <li>Deep codebase understanding (AST, semantic maps, git history, persistent context).</li>
            <li>Pre-built multi-agent workflows: planning, coding, review, testing, adversarial passes.</li>
            <li>Self-healing runtime: agents detect failures, fix themselves, and adapt over time.</li>
            <li>Persistent memory &amp; context-aware reasoning across sessions — no re-explaining your codebase.</li>
            <li>Staged diff review: all agent changes buffered for accept/reject.</li>
            <li>Claw-to-claw mesh: distribute tasks across a fleet; <code>remote:auto[caps]</code> routes to the best peer automatically.</li>
            <li>Workflow telemetry: every task emits JSONL spans locally and forwards to the Builderforce.ai timeline in real time.</li>
            <li>Enforced approval gates: <code>requestApproval()</code> blocks agent execution until a manager approves.</li>
            <li>Portal-managed skills loaded at startup; portal-managed cron jobs executed on schedule.</li>
            <li>Security &amp; governance: RBAC, device trust, HMAC-signed dispatch, and audit trails.</li>
            <li>CI/CD integration and private/self-hosted deployments.</li>
            <li>Works from any channel or CLI, with any model provider.</li>
            <li>Open source (MIT) with no vendor lock-in.</li>
          </ul>
          <p className="cc-prose">
            See the <a href="/docs/coderclaw-vs-alternatives" className="cc-link">comparison with Copilot, Cursor, Claude</a> or the{' '}
            <a href="/docs" className="cc-link">full docs</a>.
          </p>
        </section>

        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-claw-accent">⟩</span> Works With Everything</h2>
          <p className="cc-prose">50+ integrations across messaging, AI, dev, productivity and IoT.</p>
          <div className="cc-cta-row">
            <Link href="/coderclaw/integrations" className="cc-link-cta">View all integrations →</Link>
            <Link href="/coderclaw/showcase" className="cc-link-cta">See what people built →</Link>
          </div>
        </section>

        <nav className="cc-cta-grid">
          <Link href="/" className="cc-cta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cc-cta-icon">
              <circle cx="12" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><circle cx="5" cy="19" r="3"/>
              <line x1="12" y1="8" x2="12" y2="14"/><line x1="12" y1="14" x2="5" y2="19"/><line x1="12" y1="14" x2="19" y2="19"/>
            </svg>
            <span className="cc-cta-label">Builderforce.ai</span>
            <span className="cc-cta-sub">Orchestration platform</span>
          </Link>
          <a href="https://discord.gg/9gUsc2sNG6" target="_blank" rel="noopener" className="cc-cta">
            <svg viewBox="0 0 24 24" fill="currentColor" className="cc-cta-icon">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            <span className="cc-cta-label">Discord</span>
            <span className="cc-cta-sub">Join the community</span>
          </a>
          <a href="/docs" className="cc-cta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cc-cta-icon">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              <line x1="8" y1="7" x2="16" y2="7"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
            <span className="cc-cta-label">Documentation</span>
            <span className="cc-cta-sub">Learn the ropes</span>
          </a>
          <a href="https://github.com/seanhogg/coderclaw" target="_blank" rel="noopener" className="cc-cta">
            <svg viewBox="0 0 24 24" fill="currentColor" className="cc-cta-icon">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <span className="cc-cta-label">GitHub</span>
            <span className="cc-cta-sub">View the source</span>
          </a>
          <Link href="/coderclaw/skills" className="cc-cta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cc-cta-icon">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span className="cc-cta-label">Agent Skills</span>
            <span className="cc-cta-sub">Discover and share</span>
          </Link>
        </nav>

        <NewsletterForm />
      </div>

      <style>{`
        .cc-stars,
        .cc-nebula {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }
        .cc-stars {
          background-image:
            radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 80% 70%, rgba(255,255,255,0.3), transparent),
            radial-gradient(1px 1px at 50% 50%, rgba(255,255,255,0.25), transparent),
            radial-gradient(1px 1px at 10% 90%, rgba(255,255,255,0.3), transparent);
          background-size: 200% 200%;
          opacity: 0.5;
        }
        .cc-nebula {
          background:
            radial-gradient(ellipse at top right, color-mix(in srgb, var(--coral-bright) 10%, transparent), transparent 60%),
            radial-gradient(ellipse at bottom left, color-mix(in srgb, var(--cyan-bright) 8%, transparent), transparent 60%);
        }
        .cc-page {
          position: relative;
          z-index: 1;
          max-width: 1100px;
          margin: 0 auto;
          padding: 56px 24px 80px;
        }
        .cc-hero {
          text-align: center;
          padding: 24px 0 32px;
        }
        .cc-lobster {
          display: inline-block;
          margin-bottom: 16px;
          filter: drop-shadow(0 0 30px var(--logo-glow));
        }
        .cc-lobster img {
          width: clamp(96px, 18vw, 160px);
          height: auto;
        }
        .cc-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(2.25rem, 6vw, 4rem);
          margin: 0;
          background: linear-gradient(135deg, var(--coral-bright), var(--cyan-bright));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .cc-tagline {
          color: var(--text-secondary);
          font-size: clamp(1rem, 2vw, 1.2rem);
          margin: 16px auto 8px;
          max-width: 720px;
        }
        .cc-description {
          color: var(--text-secondary);
          line-height: 1.6;
          max-width: 720px;
          margin: 16px auto 0;
        }
        .cc-link {
          color: var(--coral-bright);
          text-decoration: none;
        }
        .cc-link:hover {
          text-decoration: underline;
        }
        .cc-section {
          max-width: 920px;
          margin: 64px auto 0;
        }
        .cc-h2 {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(1.5rem, 3vw, 2rem);
          margin-bottom: 24px;
          color: var(--text-primary);
        }
        .cc-claw-accent {
          color: var(--coral-bright);
          margin-right: 8px;
        }
        .cc-prose {
          color: var(--text-secondary);
          line-height: 1.7;
          margin: 0 0 16px;
        }
        .cc-prose-list {
          color: var(--text-secondary);
          line-height: 1.8;
          padding-left: 24px;
          margin: 0 0 16px;
        }
        .cc-prose-list code,
        .cc-prose code {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          background: rgba(77,158,255,0.1);
          color: var(--coral-bright);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.875em;
        }
        .cc-features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        .cc-feature-card {
          display: block;
          padding: 24px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          text-decoration: none;
          color: inherit;
          transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
        }
        .cc-feature-card:hover {
          transform: translateY(-2px);
          border-color: color-mix(in srgb, var(--coral-bright) 40%, transparent);
          background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
        }
        .cc-feature-icon {
          color: var(--coral-bright);
          margin-bottom: 12px;
        }
        .cc-feature-title {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 1.05rem;
          color: var(--text-primary);
          margin: 0 0 6px;
        }
        .cc-feature-desc {
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.55;
          margin: 0;
        }
        .cc-cta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 24px;
          margin-top: 8px;
        }
        .cc-link-cta {
          color: var(--coral-bright);
          text-decoration: none;
          font-weight: 600;
        }
        .cc-link-cta:hover { text-decoration: underline; }
        .cc-cta-grid {
          margin: 64px auto 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          max-width: 920px;
        }
        .cc-cta {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
          padding: 18px 20px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
          text-decoration: none;
          color: var(--text-primary);
          transition: transform 0.2s, border-color 0.2s;
        }
        .cc-cta:hover {
          transform: translateY(-2px);
          border-color: color-mix(in srgb, var(--coral-bright) 40%, transparent);
        }
        .cc-cta-icon {
          width: 24px;
          height: 24px;
          color: var(--coral-bright);
        }
        .cc-cta-label {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.95rem;
        }
        .cc-cta-sub {
          color: var(--text-secondary);
          font-size: 0.8rem;
        }
      `}</style>
    </>
  );
}
