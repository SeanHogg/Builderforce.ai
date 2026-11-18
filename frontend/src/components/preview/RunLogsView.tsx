/**
 * The tail of the shown service's output. Presentational over {@link useRunLogs}.
 */

import { useTranslations } from 'next-intl';
import type { RunSession } from '@/lib/runTarget/runTarget';
import { useRunLogs } from './useRunLogs';
import styles from './LivePreviewPanel.module.css';

export function RunLogsView({ session, serviceId }: { session: RunSession | null; serviceId: string | null }) {
  const t = useTranslations('livePreview');
  const lines = useRunLogs(session, serviceId);
  return (
    <pre className={styles.logs} aria-label={t('logsLabel')} aria-live="polite">
      {lines.length === 0 ? t('logsEmpty') : lines.map((line) => line.text).join('\n')}
    </pre>
  );
}
