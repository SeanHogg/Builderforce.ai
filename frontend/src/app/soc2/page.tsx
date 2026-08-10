import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { Soc2AuditVisual } from '@/components/marketing/Soc2AuditVisual';
import {
  ReferenceCard, ReferenceCta, ReferenceFaq, ReferenceGrid, ReferenceHero, ReferencePage, ReferenceSection,
} from '@/components/reference/ReferencePage';
import { soc2Schema } from '@/lib/structured-data';
import { pageMetadata } from '@/lib/seo';
import { Icon } from '@/components/ui/Icon';

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

/**
 * The page's anchored bands, in order — rendered as `<ReferenceSection id>` AND
 * handed to `ReferencePage` as the panel's index rail. One array for both, so
 * renaming a section cannot leave the rail scrolling nowhere.
 *
 * This used to live on the registry row in `publicDestinations.ts`, with
 * `check-destinations` asserting each id appeared in this file — a build-time
 * check standing in for a structural guarantee, and one that could not extend
 * to a page whose sections are data (`/integrations`). Labels stay under
 * `referencePanel.section` in all five catalogs.
 */
const SECTIONS = ['report', 'criteria', 'how', 'audits', 'faq'] as const;

/**
 * The reference page §11.4.5 is written about. It rendered through a private
 * `.s2-*` stylesheet declared inside this file — one of three copies of the
 * same hero, band and card grid — and renders through the house marketing kit
 * (`components/reference/ReferencePage` → `.mk-*`) now, so it lines up with
 * `/integrations` and `/tools/<id>` by construction.
 */
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

      <ReferencePage
        title={t('soc2.titleLead')}
        sections={SECTIONS.map((id) => ({ id, label: t(`referencePanel.section.${id}`) }))}
      >
        <ReferenceHero
          eyebrow={t('soc2.eyebrow')}
          title={t('soc2.titleLead')}
          titleAccent={t('soc2.titleAccent')}
          lede={t('soc2.sub')}
          actions={[
            { href: '/register', label: `${t('soc2.ctaPrimary')} →` },
            { href: '/tools', label: t('soc2.ctaSecondary'), variant: 'ghost' },
          ]}
        />

        {/* The `id`s from here down are the panel's index rail (PRD 21 §11.4.5) —
            declared on the registry row and asserted by `check-destinations`, so
            renaming one here fails the build rather than quietly emptying the
            rail. */}
        <ReferenceSection id="report" title={t('soc2.visualSection.title')} sub={t('soc2.visualSection.sub')}>
          <Soc2AuditVisual labels={visualLabels} />
        </ReferenceSection>

        <ReferenceSection id="criteria" tint title={t('soc2.criteria.title')} sub={t('soc2.criteria.sub')}>
          <ReferenceGrid>
            {criteria.map((criterion) => (
              <ReferenceCard key={criterion.ref} badge={criterion.ref} title={criterion.label} />
            ))}
          </ReferenceGrid>
        </ReferenceSection>

        <ReferenceSection id="how" title={t('soc2.how.title')} sub={t('soc2.how.sub')}>
          <ReferenceGrid>
            {steps.map((step, index) => (
              <ReferenceCard key={step.title} mark={index + 1} title={step.title}>{step.desc}</ReferenceCard>
            ))}
          </ReferenceGrid>
        </ReferenceSection>

        <ReferenceSection id="audits" tint title={t('soc2.family.title')} sub={t('soc2.family.sub')}>
          <ReferenceGrid wide>
            {audits.map((audit) => (
              <ReferenceCard key={audit.name} mark={<Icon source={audit.icon} size={22} />} title={audit.name}>
                {audit.desc}
              </ReferenceCard>
            ))}
          </ReferenceGrid>
        </ReferenceSection>

        <ReferenceSection id="faq" title={t('soc2.faqTitle')}>
          <ReferenceFaq items={faq} />
        </ReferenceSection>

        <ReferenceCta
          title={t('soc2.finalCta.title')}
          body={t('soc2.finalCta.sub')}
          actions={[{ href: '/register', label: `${t('soc2.finalCta.button')} →` }]}
        />

        <ReferenceSection>
          <RelatedArticles surface="soc2" heading={t('soc2.relatedHeading')} />
        </ReferenceSection>
      </ReferencePage>
    </>
  );
}
