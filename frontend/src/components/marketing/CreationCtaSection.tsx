'use client';

import { useTranslations } from 'next-intl';
import {
  HomeButton,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles as styles,
} from '@/components/home/HomePatterns';

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
      </div>
    </HomeSection>
  );
}
