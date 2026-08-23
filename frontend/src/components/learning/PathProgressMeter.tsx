'use client';

import { useTranslations } from 'next-intl';
import type { PathProgress } from '@/lib/learningApi';
import styles from './learning.module.css';

/**
 * How far through a path somebody is.
 *
 * Its own component because it is drawn in three places that share nothing else —
 * the path detail panel, a learner's own dashboard row, and a manager's roster —
 * and each of them would otherwise re-derive "0 of 0 is 0%, not complete" from
 * the same numbers.
 *
 * It takes the progress, not an id: the caller already has it from the enrolment
 * or the progress call, and fetching it again here would be a request per row.
 */
export function PathProgressMeter({ progress }: { progress: PathProgress }) {
  const t = useTranslations('learning');
  const percent = Math.max(0, Math.min(100, progress.percent));

  return (
    <div>
      <div className={styles.meterLabel}>
        <span>{t(`status.${progress.status}`)}</span>
        <span>
          {t('progress.count', {
            completed: progress.completedCourses,
            total: progress.totalCourses,
          })}
        </span>
      </div>
      <div
        className={styles.meter}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('progress.label')}
      >
        <div className={styles.meterFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
