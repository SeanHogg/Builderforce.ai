'use client';

import { useTranslations } from 'next-intl';
import { usePoints } from '@/lib/usePoints';
import styles from './points.module.css';

/**
 * Balance + streak, as a standalone card.
 *
 * Self-gating: it reads the shared snapshot itself and returns null when there is
 * no tenant session or nothing has been earned yet. That is why it takes no props
 * — a `canShow` boolean or a passed-in summary would put the decision in every
 * consumer, and the second consumer would get it wrong.
 *
 * Drop it anywhere: sidebar, dashboard, profile. It brings its own data.
 */
export function PointsBalanceCard() {
  const t = useTranslations('points');
  const { summary } = usePoints();

  if (!summary) return null;

  return (
    <section className={styles.card} aria-labelledby="points-balance-heading">
      <h3 id="points-balance-heading" className={styles.cardTitle}>{t('balance.title')}</h3>

      <p className={styles.balance}>
        <span className={styles.balanceValue}>{summary.balance.toLocaleString()}</span>
        <span className={styles.balanceUnit}>{t('balance.unit')}</span>
      </p>

      {summary.streak.current > 0 && (
        <p className={styles.streak}>
          <span aria-hidden="true">🔥</span>{' '}
          {t('streak.current', { days: summary.streak.current })}
          {summary.streak.longest > summary.streak.current && (
            <span className={styles.streakBest}> · {t('streak.best', { days: summary.streak.longest })}</span>
          )}
        </p>
      )}

      {summary.suspended && (
        <p className={styles.suspended} role="status">{t('balance.suspended')}</p>
      )}
    </section>
  );
}
