/**
 * Where the app is running and why — the target that ran it, and each target that
 * declined it on the way with its reason (PRD 31 §W9: "the decline reason is shown,
 * never a half-broken preview"). Presentational: it renders what the hook resolved.
 */

import { useTranslations } from 'next-intl';
import type { LivePreviewRun } from './useLivePreview';
import styles from './LivePreviewPanel.module.css';

export function RunTargetNote({ run }: { run: LivePreviewRun | null }) {
  const t = useTranslations('livePreview');
  if (!run) return null;
  const declined = run.declined.filter((decline) => decline.targetId !== run.targetId);
  if (!run.targetId && declined.length === 0) return null;
  return (
    <div className={styles.targetNote}>
      {run.targetId && <span className={styles.targetBadge}>{t(`target.${run.targetId}`)}</span>}
      {declined.length > 0 && (
        <ul className={styles.declines}>
          {declined.map((decline) => (
            <li key={`${decline.targetId}:${decline.code}`}>
              <span className={styles.declineTarget}>{t(`declinedBy.${decline.targetId}`)}</span>{' '}
              {t(`reason.${decline.code}`)}
              {decline.detail && <span className={styles.declineDetail}>{decline.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
