'use client';

import { useTranslations } from 'next-intl';
import { SourcedJobsList } from './SourcedJobsList';
import { JobSourcesPanel } from './JobSourcesPanel';
import styles from './sourcing.module.css';

/**
 * The composed Sourcing surface.
 *
 * COMPOSITION and nothing else: no state, no fetch, no branching. Both cards
 * decide their own visibility from their own reads — the listings hide without a
 * session, the sources panel hides without the manager role — so this file never
 * grows a condition when a card is added, and either card can be dropped
 * somewhere else on its own.
 */
export function SourcingView() {
  const t = useTranslations('sourcing');

  return (
    <div>
      <p className={styles.cardHint}>{t('view.intro')}</p>
      <div className={styles.grid}>
        <SourcedJobsList />
        <JobSourcesPanel />
      </div>
    </div>
  );
}
