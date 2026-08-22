'use client';

/**
 * The homepage's objections band. A client section only because its copy is read
 * through `useTranslations` — which, on the homepage, is deliberate: reading it
 * server-side would touch the locale cookie and turn `/` from a prerendered page
 * into a per-request function. The post-hydration locale swap is the trade the
 * root `LocaleProvider` already makes for every other marketing string.
 */
import { useTranslations } from 'next-intl';
import MarketingFaq from '@/components/marketing/MarketingFaq';
import { HomeSection, HomeSectionHeader } from '@/components/home/HomePatterns';

type FaqItem = { question: string; answer: string };

export function HomeFaqSection() {
  const t = useTranslations();
  return (
    <HomeSection>
      <HomeSectionHeader eyebrow={t('home.beat.questions')} title={t('home.faqHeading')} />
      <MarketingFaq items={t.raw('home.homepageFaq') as FaqItem[]} openFirst />
    </HomeSection>
  );
}
