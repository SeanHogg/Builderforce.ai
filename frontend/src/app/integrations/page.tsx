import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import {
  referenceAnchorId, ReferenceCard, ReferenceGrid, ReferenceGroup, ReferenceHero, ReferencePage, ReferenceSection,
} from '@/components/reference/ReferencePage';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbSchema } from '@/lib/structured-data';
import { INTEGRATION_CAPABILITY_PROOF } from '@/lib/content';
import { getIntegrationCatalog, leafPageFor, listingPageFor } from '@/lib/integrationCatalog';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrationsIndex.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/integrations',
  });
}

/**
 * The reference page PRD 21 §11.4.5 names first.
 *
 * Two things it no longer does. It no longer ships a private stylesheet for the
 * same hero/band/card grid three other pages already had — it renders through
 * the house marketing kit (`components/reference/ReferencePage` → `.mk-*`). And
 * it no longer answers "do you support X?" from an array typed into this repo:
 * the list comes from `GET /api/integrations/catalog`, which projects the five
 * ports that implement the connections. Shipping a provider now changes this
 * page, which is the only way a page like this stays true.
 */
export default async function IntegrationsIndexPage() {
  const t = await getTranslations('integrationsIndex');
  const tCategory = await getTranslations('integrationsIndex.category');

  const groups = await getIntegrationCatalog();

  // Connectors `/product` proves but no port backs — Confluence and PostHog are
  // in the capability-proof matrix without a registry entry. Derived by
  // difference rather than retyped, so the two public pages can only agree: an
  // integration named on either side appears here or there, never nowhere.
  const catalogNames = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.name.toLowerCase())));
  const provenOnly = INTEGRATION_CAPABILITY_PROOF.filter((entry) => !catalogNames.has(entry.name.toLowerCase()));

  // The page's structure IS its categories, so it is also the panel's index rail
  // — one array rendered as both, which is why the rail can never list a group
  // the page stopped having.
  const sections = [
    ...groups.map((group) => ({ id: referenceAnchorId(group.category), label: tCategory(group.category) })),
    ...(provenOnly.length > 0 ? [{ id: referenceAnchorId('proven'), label: t('provenCategory') }] : []),
  ];

  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Home', url: 'https://builderforce.ai' },
          { name: 'Integrations', url: 'https://builderforce.ai/integrations' },
        ])}
      />

      <ReferencePage title={t('title')} sections={sections}>
        <ReferenceHero eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />
        <ReferenceSection>
          {groups.map((group) => (
            <ReferenceGroup
              key={group.category}
              id={referenceAnchorId(group.category)}
              title={tCategory(group.category)}
            >
              <ReferenceGrid>
                {group.entries.map((entry) => {
                  // A curated leaf page gets the link and the written tagline; a
                  // registry-only entry states what the connection DOES, which is
                  // the honest card for a system nobody has written a page for yet.
                  // A PUBLISHED package has neither — it links to the portal where it
                  // can be installed, and says who ships it, because "by Acme" and
                  // "built in" are different answers to the buyer's actual question.
                  const leaf = leafPageFor(entry);
                  const listing = listingPageFor(entry);
                  const href = leaf?.href ?? listing;
                  return (
                    <ReferenceCard
                      key={entry.id}
                      {...(href ? { href } : {})}
                      title={entry.name}
                      badge={entry.publisher ? t('byPublisher', { publisher: entry.publisher.name }) : t(`direction.${entry.direction}`)}
                    >
                      {leaf ? leaf.tagline : t(`surface.${entry.surfaces[0]}`)}
                    </ReferenceCard>
                  );
                })}
              </ReferenceGrid>
            </ReferenceGroup>
          ))}
          {provenOnly.length > 0 && (
            <ReferenceGroup id={referenceAnchorId('proven')} title={t('provenCategory')}>
              <ReferenceGrid>
                {provenOnly.map((entry) => (
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
