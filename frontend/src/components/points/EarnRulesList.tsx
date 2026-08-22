'use client';

import { useTranslations } from 'next-intl';
import { usePoints } from '@/lib/usePoints';
import styles from './points.module.css';

/**
 * HOW to earn — the catalog, rendered from the server's own rules.
 *
 * The surface this replaces could show a balance and a history and had no answer
 * to "how do I get more", because its rules lived in server code with no read
 * path. Here the rules ARE data, `GET /api/points` returns them, and this list is
 * a projection of the same rows the award engine enforces — so a rule change
 * cannot leave the "how to earn" page describing last month's economy.
 */
export function EarnRulesList() {
  const t = useTranslations('points');
  const { summary } = usePoints();

  if (!summary || summary.earnRules.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="points-earn-heading">
      <h3 id="points-earn-heading" className={styles.cardTitle}>{t('earn.title')}</h3>
      <p className={styles.cardHint}>{t('earn.hint')}</p>

      <ul className={styles.earnList}>
        {summary.earnRules.map((rule) => (
          <li key={rule.key} className={styles.earnRow}>
            <span className={styles.earnLabel}>{rule.label}</span>
            <span className={styles.earnValue}>
              {t('earn.points', { points: rule.points.toLocaleString() })}
              {rule.dailyCapPoints != null && (
                <span className={styles.earnCap}>
                  {' '}· {t('earn.cap', { points: rule.dailyCapPoints.toLocaleString() })}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
