import { useTranslations } from 'next-intl';
import { ProofLinks } from './TrustSignals';
import styles from './HonestMarketingSection.module.css';

type Lever = { title: string; description: string };

/**
 * "How we market" — the full statement `HonestyPledge` links to
 * (`/about#how-we-market`).
 *
 * Names the persuasion levers the site uses, how each is kept honest, and the
 * ones it refuses outright. Publishing the list is the point: a reader who knows
 * the techniques can check every other page against it.
 */
export function HonestMarketingSection() {
  const t = useTranslations('honestMarketing');
  const uses = t.raw('uses') as Lever[];
  const refuses = t.raw('refuses') as string[];

  return (
    <section id="how-we-market" className={styles.section} aria-labelledby="how-we-market-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h2 id="how-we-market-title">{t('title')}</h2>
        <p className={styles.lead}>{t('lead')}</p>
      </header>
      <div className={styles.columns}>
        <div>
          <h3>{t('usesTitle')}</h3>
          <ul className={styles.uses}>
            {uses.map((lever) => (
              <li key={lever.title}><strong>{lever.title}</strong><span>{lever.description}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <h3>{t('refusesTitle')}</h3>
          <ul className={styles.refuses}>
            {refuses.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
      <ProofLinks />
    </section>
  );
}
