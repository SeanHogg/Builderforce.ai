'use client';

import { useTranslations } from 'next-intl';
import { usePoints } from '@/lib/usePoints';
import styles from './points.module.css';

/**
 * What was earned, spent and refused, newest first.
 *
 * ── THE ZERO ROWS ARE THE POINT ──────────────────────────────────────────────
 * An entry worth 0 is an action that qualified but paid nothing — the daily
 * ceiling was reached, or the self-authored-task gate is still closed. Those are
 * rendered, with the reason, rather than filtered out. Hiding them is how a
 * person concludes the platform did not notice what they did, which was the most
 * common complaint against the surface this replaces; showing them turns a silent
 * refusal into a legible rule.
 */
export function PointsActivityList() {
  const t = useTranslations('points');
  const { summary } = usePoints();

  if (!summary) return null;

  return (
    <section className={styles.card} aria-labelledby="points-activity-heading">
      <h3 id="points-activity-heading" className={styles.cardTitle}>{t('activity.title')}</h3>

      {summary.activity.length === 0 ? (
        <p className={styles.empty}>{t('activity.empty')}</p>
      ) : (
        <ul className={styles.activityList}>
          {summary.activity.map((entry) => {
            const blocked = entry.amount === 0;
            const sign = entry.amount > 0 ? '+' : '';
            return (
              <li key={entry.id} className={styles.activityRow}>
                <span className={styles.activityLabel}>
                  {entry.memo ?? entry.action}
                  {blocked && <span className={styles.activityNote}> · {t('activity.noPoints')}</span>}
                </span>
                <span
                  className={
                    blocked ? styles.activityZero
                      : entry.amount > 0 ? styles.activityGain
                        : styles.activitySpend
                  }
                >
                  {blocked ? '—' : `${sign}${entry.amount.toLocaleString()}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
