import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import {
  referenceAnchorId, ReferenceCard, ReferenceGrid, ReferenceGroup, ReferenceHero, ReferencePage, ReferenceSection,
} from '@/components/reference/ReferencePage';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbSchema } from '@/lib/structured-data';
import { INTEGRATION_CAPABILITY_PROOF, SEO_INTEGRATIONS } from '@/lib/content';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrationsIndex.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/integrations',
  });
}

const CATEGORIES = Array.from(new Set(SEO_INTEGRATIONS.map((i) => i.category)));

/**
 * Connectors the product proves but this page had no landing page for.
 *
 * `/product` renders `INTEGRATION_CAPABILITY_PROOF` as the integration matrix —
 * Jira, Confluence, Sentry, PostHog — while `/integrations` rendered only
 * `SEO_INTEGRATIONS`. Two public pages, two lists, one question, different
 * answers: somebody checking "do you support Jira?" on the page literally named
 * Integrations was told no. Derived by difference rather than retyped, so the
 * two can only agree — a connector added to either list appears here or there,
 * never nowhere.
 */
const SEO_NAMES = new Set(SEO_INTEGRATIONS.map((entry) => entry.name.toLowerCase()));
const PROVEN_ONLY = INTEGRATION_CAPABILITY_PROOF.filter((entry) => !SEO_NAMES.has(entry.name.toLowerCase()));

/**
 * The reference page PRD 21 §11.4.5 names first — and, until this pass, one of
 * three that each shipped a private stylesheet for the same hero, band and card
 * grid. It renders through the house marketing kit now
 * (`components/reference/ReferencePage` → `.mk-*`), the same one `/features`
 * and the tools hub use.
 */
export default async function IntegrationsIndexPage() {
  const t = await getTranslations('integrationsIndex');

  // The page's structure IS its categories, so it is also the panel's index
  // rail — one array, rendered as both, which is why the rail can never list a
  // group the page stopped having.
  const groups = [
    ...CATEGORIES.map((category) => ({ label: category, entries: SEO_INTEGRATIONS.filter((entry) => entry.category === category) })),
    ...(PROVEN_ONLY.length > 0 ? [{ label: t('provenCategory'), entries: [] as typeof SEO_INTEGRATIONS }] : []),
  ];

  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Home', url: 'https://builderforce.ai' },
          { name: 'Integrations', url: 'https://builderforce.ai/integrations' },
        ])}
      />

      <ReferencePage
        title={t('title')}
        sections={groups.map((group) => ({ id: referenceAnchorId(group.label), label: group.label }))}
      >
        <ReferenceHero eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />
        <ReferenceSection>
          {CATEGORIES.map((category) => (
            <ReferenceGroup key={category} id={referenceAnchorId(category)} title={category}>
              <ReferenceGrid>
                {SEO_INTEGRATIONS.filter((entry) => entry.category === category).map((entry) => (
                  <ReferenceCard key={entry.slug} href={`/integrations/${entry.slug}`} title={entry.name}>
                    {entry.tagline}
                  </ReferenceCard>
                ))}
              </ReferenceGrid>
            </ReferenceGroup>
          ))}
          {PROVEN_ONLY.length > 0 && (
            <ReferenceGroup id={referenceAnchorId(t('provenCategory'))} title={t('provenCategory')}>
              <ReferenceGrid>
                {PROVEN_ONLY.map((entry) => (
                  <ReferenceCard key={entry.name} title={entry.name}>{entry.limitation}</ReferenceCard>
                ))}
              </ReferenceGrid>
            </ReferenceGroup>
          )}
        </ReferenceSection>
      </ReferencePage>
    </>
  );
}
