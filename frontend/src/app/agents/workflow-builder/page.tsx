import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import FeatureCard from '../FeatureCard';
import { NODE_KINDS, NODE_GROUPS } from '@/components/workflow-builder/nodeKinds';
import { INTEGRATIONS, INTEGRATION_CATEGORIES } from '@/components/workflow-builder/integrations';
import { Icon } from '@/components/ui/Icon';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agents.workflowBuilder');
  return pageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/agents/workflow-builder',
    ogTitle: t('metaTitle'),
  });
}

/**
 * The three steps, and the four capability cards.
 *
 * Only the STEP NUMBER, the destination and the icon live here — the title and body of
 * each are prose and come from `agents.workflowBuilder.steps` / `.capabilities` in the
 * catalogs. The icons stay in the page because an inline SVG is presentation, not copy.
 */
const STEP_NUMBERS = ['1', '2', '3'] as const;

type StepCopy = { title: string; body: string };
type CapabilityCopy = { title: string; description: string };

const CAPABILITY_LINKS: { href: string; icon: React.ReactNode }[] = [
  {
    href: '/workflows/builder',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M12 2a4 4 0 0 0-4 4 4 4 0 0 0-2 7.5A4 4 0 0 0 8 21a4 4 0 0 0 4-1 4 4 0 0 0 4 1 4 4 0 0 0 2-7.5A4 4 0 0 0 16 6a4 4 0 0 0-4-4z"/><path d="M12 6v15"/></svg>,
  },
  {
    href: '/workflows/builder',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/></svg>,
  },
  {
    href: '/workflows',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  {
    href: '/workflows/builder',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  },
];

/** The node group the page highlights. Compared against the builder registry's own
 *  group id, so it is an identifier — never a translated label. */
const HEADLINE_GROUP = 'LLM Logic';

export default async function WorkflowBuilderMarketingPage() {
  const t = await getTranslations('agents.workflowBuilder');
  const steps = t.raw('steps') as StepCopy[];
  const capabilities = t.raw('capabilities') as CapabilityCopy[];

  // Shared by every card on this page. It was a raw rgba(255,255,255,…) overlay, which
  // only reads as a card against the dark palette — in light mode it was white on white.
  const cardSurface: React.CSSProperties = {
    background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
  };

  return (
    <>
      <div className="cc-stars" aria-hidden />
      <div className="cc-nebula" aria-hidden />
      <div className="cc-page">
        <header className="cc-hero">
          <h1 className="cc-title">{t('heading')}</h1>
          <p className="cc-tagline">{t('tagline')}</p>
          <p className="cc-description">
            {t.rich('description', { term: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <div className="cc-cta-row" style={{ justifyContent: 'center', marginTop: 20 }}>
            <Link href="/workflows/builder" className="cc-link-cta">{t('openBuilder')}</Link>
            <Link href="/docs/agents-workflows" className="cc-link-cta">{t('readDocs')}</Link>
          </div>
        </header>

        {/* Node palette showcase — sourced from the real builder catalog so it always
            matches what is on the canvas. Node labels and blurbs stay registry data:
            the same words appear on the canvas itself, so they get translated THERE or
            not at all, never forked into a second marketing copy of the same string. */}
        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-agentHost-accent">⟩</span> {t('paletteHeading')}</h2>
          <p className="cc-prose">{t('paletteIntro')}</p>
          {NODE_GROUPS.map((group) => (
            <div key={group} style={{ marginTop: 22 }}>
              <h3
                style={{
                  fontSize: 'var(--font-size-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: group === HEADLINE_GROUP ? 'var(--cyan-bright)' : 'var(--text-muted)', margin: '0 0 10px',
                }}
              >
                {group}{group === HEADLINE_GROUP ? `  · ${t('differentiator')}` : ''}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {NODE_KINDS.filter((m) => m.group === group).map((m) => (
                  <div
                    key={m.kind}
                    style={{
                      ...cardSurface,
                      display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 14px',
                      borderLeft: `3px solid ${m.accent}`,
                    }}
                  >
                    <Icon source={m.icon} size={20} />
                    <div>
                      <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{m.label}</div>
                      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>{m.blurb}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Integration catalog — counts come straight from the builder registry. */}
        <section className="cc-section">
          <h2 className="cc-h2">
            <span className="cc-agentHost-accent">⟩</span> {t('catalogHeading', { count: INTEGRATIONS.length })}
          </h2>
          <p className="cc-prose">{t('catalogIntro')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 8 }}>
            {INTEGRATION_CATEGORIES.slice().sort((a, b) => a.order - b.order).map((cat) => {
              const items = INTEGRATIONS.filter((i) => i.category === cat.id);
              return (
                <div key={cat.id} style={{ ...cardSurface, padding: '14px 16px', borderLeft: `3px solid ${cat.accent}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}><Icon source={cat.icon} size={17} /> {cat.label}</span>
                    <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: cat.accent }}>{items.length}</span>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                    {items.slice(0, 8).map((i) => i.label).join(' · ')}
                    {items.length > 8 ? ` ${t('andMore', { count: items.length - 8 })}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-agentHost-accent">⟩</span> {t('howItWorksHeading')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {STEP_NUMBERS.map((n, i) => (
              <div key={n} style={{ ...cardSurface, padding: '18px 18px 20px' }}>
                <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-md)', background: 'var(--coral-bright)', color: 'var(--text-on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--font-size-body)' }}>{n}</div>
                <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', margin: '12px 0 6px' }}>{steps[i]?.title}</div>
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', lineHeight: 1.5 }}>{steps[i]?.body}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="cc-section">
          <h2 className="cc-h2"><span className="cc-agentHost-accent">⟩</span> {t('whatYouGetHeading')}</h2>
          <div className="cc-features-grid">
            {CAPABILITY_LINKS.map((link, i) => (
              <FeatureCard
                key={`${link.href}-${i}`}
                href={link.href}
                icon={link.icon}
                title={capabilities[i]?.title ?? ''}
                description={capabilities[i]?.description ?? ''}
              />
            ))}
          </div>
        </section>

        <section className="cc-section" style={{ textAlign: 'center' }}>
          <h2 className="cc-h2" style={{ justifyContent: 'center' }}><span className="cc-agentHost-accent">⟩</span> {t('finalCtaHeading')}</h2>
          <p className="cc-prose" style={{ maxWidth: 620, margin: '0 auto 18px' }}>{t('finalCtaBody')}</p>
          <div className="cc-cta-row" style={{ justifyContent: 'center' }}>
            <Link href="/workflows/builder" className="cc-link-cta">{t('openBuilder')}</Link>
            <Link href="/agents" className="cc-link-cta">{t('exploreAgents')}</Link>
          </div>
        </section>
      </div>
    </>
  );
}
