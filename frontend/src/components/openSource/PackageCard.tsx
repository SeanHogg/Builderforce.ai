import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/ui/Icon';
import { openSourcePath, type OpenSourcePackage } from '@/lib/openSourcePackages';
import CodeSnippet from './CodeSnippet';
import styles from './openSource.module.css';

/**
 * One package on the `/open-source` index: its name, the one-line value, the
 * licence and the line that installs it, with a way to the detail page and the
 * source. Facts come from the registry row; the sentences from
 * `openSource.packages.<key>` in the catalog.
 */
export default async function PackageCard({ entry }: { entry: OpenSourcePackage }) {
  const t = await getTranslations('openSource');

  return (
    <article className={styles.card} aria-labelledby={`os-${entry.key}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon}>
          <Icon name={entry.icon} size={20} />
        </span>
        <h3 id={`os-${entry.key}`} className={styles.cardName}>{entry.displayName}</h3>
      </div>

      <p className={styles.cardTagline}>{t(`packages.${entry.key}.tagline`)}</p>
      <p className={styles.tileText}>{t(`packages.${entry.key}.summary`)}</p>

      <dl className={styles.facts}>
        <dt>{t('card.license')}</dt>
        <dd>{entry.license}</dd>
        <dt>{t('card.language')}</dt>
        <dd>{entry.language}</dd>
        <dt>{t('card.packages')}</dt>
        <dd>{entry.packages.join(', ')}</dd>
      </dl>

      <CodeSnippet label={t('card.install')} code={entry.install} />

      <div className={styles.links}>
        <Link className={styles.btnPrimary} href={openSourcePath(entry)}>
          {t('card.details')}
        </Link>
        <a className={styles.btnSecondary} href={entry.repoUrl} target="_blank" rel="noopener noreferrer">
          {t('card.source')}
        </a>
      </div>
    </article>
  );
}
