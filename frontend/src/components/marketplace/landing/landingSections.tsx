import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import MarketingFaq from '@/components/marketing/MarketingFaq';
import { SocialProofBar } from '@/components/marketing/SocialProofBar';
import { ProofLinks } from '@/components/marketing/TrustSignals';
import type { LandingSection, LandingSectionKind } from '@/lib/marketplace/listingLandings';
import { LandingStartLink } from './LandingStartLink';
import { PricingCalculator } from './PricingCalculator';
import styles from './listingLanding.module.css';

/**
 * The landing section registry — ONE component per `LandingSection.kind`. A
 * landing is data (`LISTING_LANDINGS`); this maps each entry to what draws it.
 * Shared marketing pieces (`MarketingFaq`, `SocialProofBar`, `ProofLinks`) are
 * reused; the small ones below exist only where nothing fitted.
 */
type SectionOf<K extends LandingSectionKind> = Extract<LandingSection, { kind: K }>;
export type LandingSectionProps<K extends LandingSectionKind> = { section: SectionOf<K> };

/** Section copy lives at `<ns>.<kind>.<key>`; the namespace is data, so the key is too. */
function useSectionCopy(section: LandingSection) {
  const t = useTranslations(section.ns);
  return (key: string, values?: Record<string, string | number>) => t(`${section.kind}.${key}` as never, values as never);
}

export function ListingHero({ section }: LandingSectionProps<'hero'>) {
  const t = useSectionCopy(section);
  return (
    <header className={styles.hero}>
      <span className={styles.eyebrow}>{t('eyebrow')}</span>
      <h2 className={styles.heroTitle}>{t('title')}</h2>
      <p className={styles.lead}>{t('lead')}</p>
      <div className={styles.actions}>
        <LandingStartLink start={section.start} label={t('startFree')} />
        <span className={styles.note}>{t('freeNote')}</span>
      </div>
    </header>
  );
}

export function InstallStrip({ section }: LandingSectionProps<'install'>) {
  const t = useSectionCopy(section);
  return (
    <>
      <h2 className={styles.sectionTitle}>{t('title')}</h2>
      <ol className={styles.steps}>
        {section.steps.map((step) => (
          <li key={step} className={styles.step}>
            <h3 className={styles.cardTitle}>{t(`steps.${step}.title`)}</h3>
            <p className={styles.cardText}>{t(`steps.${step}.body`)}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

export function PillarsGrid({ section }: LandingSectionProps<'pillars'>) {
  const t = useSectionCopy(section);
  return (
    <>
      <h2 className={styles.sectionTitle}>{t('title')}</h2>
      <div className={styles.grid}>
        {section.items.map((item) => (
          <article key={item} className={styles.card}>
            <h3 className={styles.cardTitle}>{t(`items.${item}.title`)}</h3>
            <p className={styles.cardText}>{t(`items.${item}.body`)}</p>
          </article>
        ))}
      </div>
    </>
  );
}

export function CompareTable({ section }: LandingSectionProps<'compare'>) {
  const t = useSectionCopy(section);
  return (
    <>
      <h2 className={styles.sectionTitle}>{t('title')}</h2>
      <p className={styles.lead}>{t('lead')}</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('feature')}</th>
              {section.columns.map((column, index) => (
                <th scope="col" key={column} className={index === 0 ? styles.us : undefined}>{t(`columns.${column}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row}>
                <th scope="row">{t(`rows.${row}.feature`)}</th>
                {section.columns.map((column, index) => (
                  <td key={column} className={index === 0 ? styles.us : undefined}>{t(`rows.${row}.${column}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function LandingFaq({ section }: LandingSectionProps<'faq'>) {
  const t = useSectionCopy(section);
  const items = section.items.map((item) => ({ question: t(`items.${item}.q`), answer: t(`items.${item}.a`) }));
  return (
    <>
      <h2 className={styles.sectionTitle}>{t('title')}</h2>
      <MarketingFaq items={items} openFirst />
    </>
  );
}

export function LandingProof({ section }: LandingSectionProps<'proof'>) {
  const t = useSectionCopy(section);
  return (
    <>
      <h2 className={styles.sectionTitle}>{t('title')}</h2>
      <p className={styles.lead}>{t('lead')}</p>
      <SocialProofBar />
      <div className={styles.actions}>
        <LandingStartLink start={section.start} label={t('startFree')} />
      </div>
      <ProofLinks />
    </>
  );
}

export const LANDING_SECTION_COMPONENTS: { [K in LandingSectionKind]: ComponentType<LandingSectionProps<K>> } = {
  hero: ListingHero,
  install: InstallStrip,
  pillars: PillarsGrid,
  compare: CompareTable,
  pricing: PricingCalculator,
  faq: LandingFaq,
  proof: LandingProof,
};
