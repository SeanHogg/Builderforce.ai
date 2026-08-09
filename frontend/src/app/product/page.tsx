import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import {
  CardText,
  CardTitle,
  HomeButton,
  HomeCard,
  HomeGrid,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles,
} from '@/components/home/HomePatterns';
import { productSchema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import { STATS, PRODUCT_SECTIONS, PRODUCT_CAPABILITY_PROOF, PRODUCT_CAPABILITY_OPERATIONS, INTEGRATION_CAPABILITY_PROOF, WORKFLOW_PROOF_DEMOS } from '@/lib/content';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('product.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/product',
    ogTitle: t('ogTitle'),
  });
}

type ProductSection = { id: string; title: string; blurb: string; surfaces: { title: string; desc: string }[] };
type DiscoveryFeature = { title: string; longDesc: string };
type WorkflowProofCopy = { title: string; audience: string; outcome: string; steps: string[]; evidence: string };
type IntegrationProofCopy = { auth: string; limitation: string };

// Visible copy from the `product` catalog (localized in all 5 locales).
// content.ts STATS/PRODUCT_SECTIONS stays canonical English for the JSON-LD
// (productSchema); stat VALUES, section/surface ICONS and hrefs are paired from
// content by index, so the catalog arrays stay length/order-aligned with it.
export default async function ProductPage() {
  const t = await getTranslations();
  const statLabels = t.raw('product.statLabels') as string[];
  const sections = t.raw('product.sections') as ProductSection[];
  const integrationCopy = t.raw('product.integrationMatrix.items') as IntegrationProofCopy[];
  const workflowLimitations = t.raw('product.workflowLimitations') as string[];

  return (
    <>
      <JsonLd data={productSchema()} />

      <style>{`
        .pp { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        .pp-hero { text-align: center; padding: 44px 24px 40px; max-width: 820px; margin: 0 auto; }
        .pp-eyebrow {
          font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 14px;
        }
        .pp-title {
          font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.08;
          font-size: var(--font-size-page-title); color: var(--text-primary); margin: 0 0 18px;
        }
        .pp-sub { font-size: var(--font-size-lede); color: var(--text-secondary); line-height: 1.7; margin: 0; }
        .pp-stats {
          max-width: 900px; margin: 28px auto 0; padding: 0 24px;
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
          border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden;
        }
        @media (max-width: 640px) { .pp-stats { grid-template-columns: repeat(2, 1fr); } }
        .pp-stat { padding: 20px 14px; text-align: center; background: var(--surface-card); }
        .pp-stat-n {
          font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-section);
          color: var(--coral-bright); line-height: 1; margin-bottom: 5px;
        }
        .pp-stat-l { font-size: var(--font-size-small); color: var(--text-muted); line-height: 1.3; white-space: pre-line; }
        .pp-proof-note { max-width: 760px; margin: 14px auto 0; padding: 0 24px; text-align: center; color: var(--text-muted); font-size: var(--font-size-small); line-height: 1.55; }

        .pp-sections { max-width: 1100px; margin: 0 auto; padding: 40px 24px 24px; width: 100%; }
        .pp-section { margin-bottom: 56px; }
        .pp-section-head { margin-bottom: 20px; }
        .pp-section-title {
          font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-section); color: var(--text-primary); margin: 0 0 6px;
        }
        .pp-section-title .pp-accent { color: var(--coral-bright); margin-right: 8px; }
        .pp-section-blurb { font-size: var(--font-size-body); color: var(--text-secondary); margin: 0; }
        .pp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
        .pp-card {
          display: flex; flex-direction: column; background: var(--surface-card);
          border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); padding: 22px 20px;
          text-decoration: none; transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
        }
        .pp-card:hover {
          transform: translateY(-4px); border-color: var(--border-accent);
          box-shadow: 0 16px 40px var(--shadow-coral-soft);
        }
        .pp-card-icon { font-size: var(--font-size-section); margin-bottom: 12px; }
        .pp-card-proof { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 10px; }
        .pp-proof-chip { border: 1px solid var(--border-subtle); border-radius: var(--radius-full); padding: 3px 8px; color: var(--text-muted); font-size: var(--font-size-eyebrow); line-height: 1.2; }
        .pp-proof-chip[data-status="available"] { border-color: color-mix(in srgb, var(--success) 48%, var(--border-subtle)); color: var(--success-text); }
        .pp-proof-chip[data-status="beta"] { border-color: color-mix(in srgb, var(--coral-bright) 48%, var(--border-subtle)); color: var(--coral-bright); }
        .pp-proof-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
        .pp-proof-card { border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); background: var(--surface-card); padding: 20px; }
        .pp-proof-card h3 { color: var(--text-primary); font-size: var(--font-size-card-title); margin: 0 0 8px; }
        .pp-proof-card p, .pp-proof-card li { color: var(--text-secondary); font-size: var(--font-size-small); line-height: 1.55; }
        .pp-proof-card ol { padding-left: 20px; }
        .pp-integration { width: 100%; border-collapse: collapse; font-size: var(--font-size-small); min-width: 720px; }
        .pp-integration th, .pp-integration td { padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); text-align: left; vertical-align: top; color: var(--text-secondary); }
        .pp-integration th { color: var(--text-primary); }
        .pp-card-title { font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-card-title); color: var(--text-primary); margin: 0 0 6px; }
        .pp-card-desc { font-size: var(--font-size-small); color: var(--text-secondary); line-height: 1.6; margin: 0 0 14px; flex: 1; }
        .pp-disclosure { margin: 0 0 12px; color: var(--text-muted); font-size: var(--font-size-small); }
        .pp-disclosure summary { cursor: pointer; color: var(--text-secondary); }
        .pp-disclosure p { margin: 6px 0 0; line-height: 1.45; }
        .pp-card-cta { font-size: var(--font-size-small); font-weight: 600; color: var(--coral-bright); }

        .pp-cta { max-width: 820px; margin: 0 auto; padding: 0 24px 80px; }
        .pp-cta-box {
          text-align: center; padding: 52px 40px; border-radius: var(--radius-xl);
          border: 1px solid var(--border-accent); background: var(--surface-card); backdrop-filter: blur(16px);
        }
        .pp-cta-title { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-section); color: var(--text-primary); margin: 0 0 12px; }
        .pp-cta-desc { font-size: var(--font-size-body); color: var(--text-secondary); max-width: 480px; margin: 0 auto 28px; line-height: 1.65; }
        .pp-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
        .pp-btn-primary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: var(--radius-lg);
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: var(--text-on-accent);
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-body); text-decoration: none;
          box-shadow: 0 6px 22px var(--shadow-coral-mid); transition: transform 0.22s ease, box-shadow 0.22s ease;
        }
        .pp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 30px var(--shadow-coral-strong); }
        .pp-btn-secondary {
          display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: var(--radius-lg);
          border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary);
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-body); text-decoration: none;
        }
        .pp-btn-secondary:hover { border-color: var(--border-accent); }
      `}</style>

      <div className="pp">
        <main>
          <section className="pp-hero">
            <div className="pp-eyebrow">{t('product.eyebrow')}</div>
            <h1 className="pp-title">{t('product.title')}</h1>
            <p className="pp-sub">{t('product.sub')}</p>
          </section>

          <div className="pp-stats">
            {statLabels.map((label, i) => (
              <div key={i} className="pp-stat">
                <div className="pp-stat-n">{STATS.marketing[i]?.value}</div>
                <div className="pp-stat-l">{label}</div>
              </div>
            ))}
          </div>
          <p className="pp-proof-note">{t('product.proofNote')}</p>

          <HomeSection id="what-you-can-build" tone="soft">
            <HomeSectionHeader
              eyebrow={t('home.beat.breadth')}
              title={t('home.featuresHeading')}
              lead={t('home.featuresLead')}
            />
            <HomeGrid columns={3}>
              {(t.raw('features') as DiscoveryFeature[]).map((feature) => (
                <HomeCard key={feature.title}>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardText>{feature.longDesc}</CardText>
                </HomeCard>
              ))}
            </HomeGrid>
          </HomeSection>

          <HomeSection id="why-builderforce" tone="grid">
            <HomeSectionHeader
              centered
              eyebrow={t('home.beat.compare')}
              title={t('compare.teaser.title')}
              lead={t('compare.teaser.blurb')}
            />
            <HomeGrid columns={3}>
              {(t.raw('compare.teaser.highlightFeatures') as string[]).map((feature) => (
                <HomeCard key={feature}>
                  <CardText>{feature}</CardText>
                </HomeCard>
              ))}
            </HomeGrid>
            <div className={`${homePatternStyles.actions} ${homePatternStyles.actionsCenter}`}>
              <HomeButton href="/compare" primary arrow>{t('compare.teaser.ctaLabel')}</HomeButton>
            </div>
          </HomeSection>

          <div className="pp-sections">
            {sections.map((section, si) => (
              <section key={section.id} className="pp-section" id={section.id}>
                <div className="pp-section-head">
                  <h2 className="pp-section-title">
                    <span className="pp-accent">⟩</span>
                    {section.title}
                  </h2>
                  <p className="pp-section-blurb">{section.blurb}</p>
                </div>
                <div className="pp-grid">
                  {section.surfaces.map((surface, fi) => {
                    const canonical = PRODUCT_SECTIONS[si]?.surfaces[fi];
                    const proof = canonical ? PRODUCT_CAPABILITY_PROOF[canonical.title] : undefined;
                    const operations = canonical ? PRODUCT_CAPABILITY_OPERATIONS[canonical.title] : undefined;
                    return (
                      <Link key={surface.title} href={canonical?.href ?? '#'} className="pp-card">
                        <span className="pp-card-icon">{canonical?.icon}</span>
                        <h3 className="pp-card-title">{surface.title}</h3>
                        {proof ? (
                          <span className="pp-card-proof">
                            <span className="pp-proof-chip" data-status={proof.status}>{t(`product.capabilityStatus.${proof.status}`)}</span>
                            <span className="pp-proof-chip">{t(`product.dataBoundary.${proof.dataBoundary}`)}</span>
                          </span>
                        ) : null}
                        <p className="pp-card-desc">{surface.desc}</p>
                        {proof && operations ? <details className="pp-disclosure"><summary>{t('product.disclosure.label')}</summary><p><strong>{t('product.disclosure.owner')}:</strong> {operations.owner}</p><p><strong>{t('product.disclosure.prerequisites')}:</strong> {proof.prerequisites.length ? proof.prerequisites.join(', ') : t('product.disclosure.none')}</p><p><strong>{t('product.disclosure.limits')}:</strong> {operations.limitation}</p><p><strong>{t('product.disclosure.exports')}:</strong> {operations.exports.join(', ')}</p><p><strong>{t('product.disclosure.verified')}:</strong> {proof.lastVerified}</p><p><Link href={operations.exampleHref}>{t('product.disclosure.example')} →</Link></p></details> : null}
                        <span className="pp-card-cta">{t('product.exploreCta')} →</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <section className="pp-sections" id="workflow-proof">
            <div className="pp-section-head">
              <h2 className="pp-section-title"><span className="pp-accent">⟩</span>{t('home.workflowProof.heading')}</h2>
              <p className="pp-section-blurb">{t('home.workflowProof.lead')}</p>
            </div>
            <div className="pp-proof-grid">
              {(t.raw('home.workflowProof.demos') as WorkflowProofCopy[]).map((demo, index) => {
                const proof = WORKFLOW_PROOF_DEMOS[index];
                return <article className="pp-proof-card" key={proof.id}>
                  <div className="pp-card-proof"><span className="pp-proof-chip" data-status={proof.status}>{t(`product.capabilityStatus.${proof.status}`)}</span><span className="pp-proof-chip">{t(`product.dataBoundary.${proof.dataBoundary}`)}</span></div>
                  <h3>{demo.title}</h3>
                  <p><strong>{demo.audience}</strong> — {demo.outcome}</p>
                  <ol>{demo.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  <p>{demo.evidence}</p>
                  <p><strong>{t('product.limitationLabel')}:</strong> {workflowLimitations[index]}</p>
                </article>;
              })}
            </div>
          </section>

          <section className="pp-sections" id="integration-matrix">
            <div className="pp-section-head">
              <h2 className="pp-section-title"><span className="pp-accent">⟩</span>{t('product.integrationMatrix.title')}</h2>
              <p className="pp-section-blurb">{t('product.integrationMatrix.lead')}</p>
            </div>
            <div style={{overflowX:'auto'}}>
              <table className="pp-integration">
                <thead><tr><th>{t('product.integrationMatrix.integration')}</th><th>{t('product.integrationMatrix.status')}</th><th>{t('product.integrationMatrix.direction')}</th><th>{t('product.integrationMatrix.auth')}</th><th>{t('product.integrationMatrix.boundary')}</th><th>{t('product.integrationMatrix.limits')}</th><th>{t('product.integrationMatrix.verified')}</th></tr></thead>
                <tbody>{INTEGRATION_CAPABILITY_PROOF.map((integration, index) => <tr key={integration.name}><td>{integration.name}</td><td>{t(`product.capabilityStatus.${integration.status}`)}</td><td>{t(`product.integrationMatrix.directions.${integration.direction}`)}</td><td>{integrationCopy[index]?.auth}</td><td>{t('product.dataBoundary.connected-service')}</td><td>{integrationCopy[index]?.limitation}</td><td>{integration.lastVerified}</td></tr>)}</tbody>
              </table>
            </div>
          </section>

          <section className="pp-cta">
            <div className="pp-cta-box">
              <h2 className="pp-cta-title">{t('product.ctaTitle')}</h2>
              <p className="pp-cta-desc">{t('product.ctaDesc')}</p>
              <div className="pp-actions">
                <Link href="/register" className="pp-btn-primary">⚡ {t('marketing.ctaGetStartedFree')}</Link>
                <Link href="/creation-canvas" className="pp-btn-secondary">✦ {t('product.ctaBrowseWorkforce')}</Link>
              </div>
            </div>
          </section>

          <RelatedArticles surface="product" heading={t('product.relatedHeading')} />
        </main>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
