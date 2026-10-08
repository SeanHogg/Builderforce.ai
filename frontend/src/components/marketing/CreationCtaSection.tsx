'use client';

import { useTranslations } from 'next-intl';
import {
  HomeButton,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles as styles,
} from '@/components/home/HomePatterns';
import { SocialProofBar } from './SocialProofBar';
import { ProofLinks, TrustLine } from './TrustSignals';

/**
 * THE ask on every marketing page. It repeats the one promise (`home.ctaTitle`)
 * and carries the persuasion layer — live social proof, what starting costs,
 * and where to check our claims — so no page re-invents its own trust copy.
 */
export function CreationCtaSection() {
  const t = useTranslations();

  return (
    <HomeSection tone="grid">
      <div className={styles.cta}>
        <HomeSectionHeader title={t('home.ctaTitle')} lead={t('home.ctaDesc')} />
        <div className={styles.actions}>
          <HomeButton href="/register" primary arrow>{t('marketing.ctaGetStartedFree')}</HomeButton>
          <HomeButton href="/creation-canvas" arrow>{t('home.ctaSeeLiveAgents')}</HomeButton>
        </div>
        <SocialProofBar />
        <TrustLine />
        <ProofLinks />
      </div>
    </HomeSection>
  );
}
