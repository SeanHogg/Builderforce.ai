import type { Metadata } from 'next';
import Link from 'next/link';
import FeatureCard from '../FeatureCard';
import { NODE_KINDS, NODE_GROUPS } from '@/components/workflow-builder/nodeKinds';
import { INTEGRATIONS, INTEGRATION_CATEGORIES, integrationIcon } from '@/components/workflow-builder/integrations';

export const metadata: Metadata = {
  title: 'Agentic Workflow Builder — Builderforce.ai',
  description:
    'Drag-and-drop, IPAAS-style canvas for composing your own LLM logic — memory, knowledge-base and training nodes — wired to your agents and run on your own hosts. Visual workflows that actually execute.',
  alternates: { canonical: '/agents/workflow-builder' },
  openGraph: {
    title: 'Agentic Workflow Builder — Builderforce.ai',
    description:
      'Compose LLM logic (memory, knowledge base, training) and agents on a drag-and-drop canvas, then run it on your hosts.',
    url: 'https://builderforce.ai/agents/workflow-builder',
    type: 'website',
  },
};

const HOW_IT_WORKS = [
  {
    n: '1',
    title: 'Drag in your nodes',
    body: 'Pull triggers, LLM-logic, agents and ETL steps onto the canvas. Every node is configurable in a side panel — no code.',
  },
  {
    n: '2',
    title: 'Wire the flow',
    body: 'Connect nodes to declare dependencies. The graph compiles to a dependency-ordered execution plan automatically.',
  },
  {
    n: '3',
    title: 'Run on your hosts',
    body: 'Hit Run and the workflow is claimed by one of your agent hosts, executed, and streamed back to the live monitoring graph.',
  },
];

const CAPABILITIES = [
  {
    href: '/workflows/builder',
    title: 'Your LLM logic, as nodes',
    description:
      'Memory recall/write, knowledge-base query/ingest, and model training are first-class nodes — compose them like any other step.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M12 2a4 4 0 0 0-4 4 4 4 0 0 0-2 7.5A4 4 0 0 0 8 21a4 4 0 0 0 4-1 4 4 0 0 0 4 1 4 4 0 0 0 2-7.5A4 4 0 0 0 16 6a4 4 0 0 0-4-4z"/><path d="M12 6v15"/></svg>,
  },
  {
    href: '/workflows/builder',
    title: 'Your agents as executors',
    description:
      'Drop an Agent Run node, pick a role, runtime and model, and your configured agents do the work — local, cloud, browser or remote mesh.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/></svg>,
  },
  {
    href: '/workflows',
    title: 'Runs you can watch',
    description:
      'Every run instantiates a tracked execution record — task statuses, the live dependency graph, durations and cost land in the monitoring view for free.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  {
    href: '/workflows/builder',
    title: 'Import, export, version',
    description:
      'Every workflow round-trips to human-authorable YAML — hand-edit it, check it into git, or import a hand-written flow straight onto the canvas.',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  },
];

export default function WorkflowBuilderMarketingPage() {
  return (
    <>
      <div className="cc-stars" aria-hidden />
      <div className="cc-nebula" aria-hidden />
      <div className="cc-page">
        <header className="cc-hero">
          <h1 className="cc-title">Agentic Workflow Builder</h1>
          <p className="cc-tagline">Compose your LLM logic. Wire your agents. Watch it run.</p>
          <p className="cc-description">
            A drag-and-drop, IPAAS-style canvas where <strong>memory</strong>, <strong>knowledge base</strong> and{' '}
            <strong>training</strong> are nodes you snap together with your agents — then run on your own hosts.
            Not a diagram tool: every workflow actually executes.
          </p>
          <div className="cc-cta-row" style={{ justifyContent: 'center', marginTop: 20 }}>
            <Link href="/workflows/builder" className="cc-link-cta">Open the builder →</Link>
            <Link href="/docs/agents-workflows" className="cc-link-cta">Read the docs →</Link>
          </div>
        </header>

        {/* Node palette showcase — sourced from the real builder catalog so it
            always matches what's on the canvas. */}
        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-agentHost-accent">⟩</span> A palette for agentic work</h2>
          <p className="cc-prose">
            Most workflow builders stop at HTTP calls and if/else. This one adds the primitives that make agents useful —
            the LLM-logic nodes are the headline.
          </p>
          {NODE_GROUPS.map((group) => (
            <div key={group} style={{ marginTop: 22 }}>
              <h3
                style={{
                  fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: group === 'LLM Logic' ? '#00e5cc' : 'var(--text-muted, #8a8f9c)', margin: '0 0 10px',
                }}
              >
                {group}{group === 'LLM Logic' ? '  · the differentiator' : ''}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {NODE_KINDS.filter((m) => m.group === group).map((m) => (
                  <div
                    key={m.kind}
                    style={{
                      display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 14px',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                      borderLeft: `3px solid ${m.accent}`, borderRadius: 10,
                    }}
                  >
                    <span style={{ fontSize: 20, lineHeight: 1 }}>{m.icon}</span>
                    <div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary, #e2e5ec)' }}>{m.label}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #8a8f9c)', marginTop: 3, lineHeight: 1.45 }}>{m.blurb}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Integration catalog — counts come straight from the builder registry. */}
        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-agentHost-accent">⟩</span> {INTEGRATIONS.length}+ integrations, ready to drop in</h2>
          <p className="cc-prose">
            MCP servers, LLM platforms, databases, CRMs and data-collection sources — drag any of them onto the canvas.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 8 }}>
            {INTEGRATION_CATEGORIES.slice().sort((a, b) => a.order - b.order).map((cat) => {
              const items = INTEGRATIONS.filter((i) => i.category === cat.id);
              return (
                <div key={cat.id} style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderLeft: `3px solid ${cat.accent}`, borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary, #e2e5ec)' }}>{cat.icon} {cat.label}</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: cat.accent }}>{items.length}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #8a8f9c)', marginTop: 6, lineHeight: 1.5 }}>
                    {items.slice(0, 8).map((i) => `${integrationIcon(i)} ${i.label}`).join(' · ')}
                    {items.length > 8 ? ` +${items.length - 8} more` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-agentHost-accent">⟩</span> How it works</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {HOW_IT_WORKS.map((s) => (
              <div key={s.n} style={{ padding: '18px 18px 20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--coral-bright, #f4726e)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>{s.n}</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary, #e2e5ec)', margin: '12px 0 6px' }}>{s.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #8a8f9c)', lineHeight: 1.5 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-agentHost-accent">⟩</span> What you get</h2>
          <div className="cc-features-grid">
            {CAPABILITIES.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </section>

        <section className="cc-section" style={{ textAlign: 'center' }}>
          <h2 className="cc-h2" style={{ justifyContent: 'center' }}><span className="cc-agentHost-accent">⟩</span> Build your first workflow</h2>
          <p className="cc-prose" style={{ maxWidth: 620, margin: '0 auto 18px' }}>
            Open a blank canvas, drop a trigger, an agent and a memory node, wire them up, and run it on a host — in under a minute.
          </p>
          <div className="cc-cta-row" style={{ justifyContent: 'center' }}>
            <Link href="/workflows/builder" className="cc-link-cta">Open the builder →</Link>
            <Link href="/agents" className="cc-link-cta">Explore BuilderForce Agents →</Link>
          </div>
        </section>
      </div>
    </>
  );
}
