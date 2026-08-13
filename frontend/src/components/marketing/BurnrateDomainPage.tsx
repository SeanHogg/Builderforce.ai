'use client';

/**
 * The nine domain explainers (`/business-intelligence`, `/sales-revenue`, …) —
 * one component, nine `copyId`s.
 *
 * It rendered through `.br-domain-*`, a fourth private marketing vocabulary
 * beside `/soc2`'s `.s2-*`, `/integrations`' `.intx-*` and the tool page's
 * `.tref-*`. All four now render through `components/reference/ReferencePage`,
 * i.e. the house `.mk-*` kit — so the nine explainers, the two standalone
 * reference pages and the diagnostics family are one surface rather than four
 * that look like each other from memory.
 *
 * It publishes its own panel chrome through `ReferencePage`, which is what gives
 * these nine an index rail: their sections are their FEATURES, which are copy,
 * so they could never have been declared on the registry row.
 */

import { useTranslations } from 'next-intl';
import {
  referenceAnchorId, ReferenceCard, ReferenceCta, ReferenceGrid, ReferenceHero, ReferencePage, ReferenceSection,
} from '@/components/reference/ReferencePage';
import { useAuth } from '@/lib/AuthContext';
import type {
  ReferenceDestination
} from '@/lib/publicDestinations';
import { seatHueVar } from '@/lib/seats';
import { Icon } from '@/components/ui/Icon';

export interface BurnrateDomainCopy {
  title: string;
  tagline: string;
  description: string;
  hero: string;
  features: Array<{ title: string; description: string }>;
}

export interface BurnrateSharedCopy {
  builtFor: string;
  poweredBy: string;
  publicCta: string;
  publicSecondaryCta: string;
  authenticatedCta: string;
  authenticatedEyebrow: string;
  featureHeading: string;
  publicClosing: string;
  authenticatedClosing: string;
}

export default function BurnrateDomainPage({
  domain,
  copy,
  shared,
}: {
  domain: ReferenceDestination;
  copy: BurnrateDomainCopy;
  shared: BurnrateSharedCopy;
}) {
  const t = useTranslations('referencePanel.section');
  const { isAuthenticated } = useAuth();
  const primaryHref = isAuthenticated ? domain.appHref : '/register';
  const featuresId = referenceAnchorId(shared.featureHeading);

  return (
    // The page carries its owner's hue from the one declaration (§11.10.1), so
    // the explainer, the features card and the roster chip agree about who this
    // domain belongs to instead of each picking a colour. `--seat` is what the
    // `.mk-*` kit reads for every accent on the page.
    <main style={{ '--seat': `var(${seatHueVar(domain.seat)})` } as React.CSSProperties}>
      <ReferencePage
        title={copy.title}
        sections={[
          { id: featuresId, label: shared.featureHeading },
          { id: 'ref-start', label: t('start') },
        ]}
      >
        <ReferenceHero
          eyebrow={shared.builtFor.replace('{persona}', domain.seat)}
          mark={<Icon source={domain.icon} size={40} />}
          title={copy.title}
          titleAccent={copy.hero}
          lede={copy.description}
          actions={[
            { href: primaryHref, label: `${isAuthenticated ? shared.authenticatedCta : shared.publicCta} →` },
            ...(isAuthenticated ? [] : [{ href: '/book-demo', label: shared.publicSecondaryCta, variant: 'ghost' as const }]),
          ]}
        />

        <ReferenceSection id={featuresId} title={shared.featureHeading} sub={isAuthenticated ? shared.authenticatedEyebrow : copy.tagline}>
          <ReferenceGrid wide>
            {copy.features.map((feature, index) => (
              <ReferenceCard key={feature.title} mark={String(index + 1).padStart(2, '0')} title={feature.title}>
                {feature.description}
              </ReferenceCard>
            ))}
          </ReferenceGrid>
        </ReferenceSection>

        <div id="ref-start">
          <ReferenceCta
            title={copy.hero}
            body={isAuthenticated ? shared.authenticatedClosing : shared.publicClosing}
            actions={[{ href: primaryHref, label: `${isAuthenticated ? shared.authenticatedCta : shared.publicCta} →` }]}
          />
        </div>
      </ReferencePage>
    </main>
  );
}
