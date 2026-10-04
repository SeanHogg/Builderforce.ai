// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import type { RunPhase } from './useWorkspaceRun';
import styles from './workspaceChrome.module.css';

const LABEL: Record<RunPhase, 'statusRunning' | 'statusStarting' | 'statusStopped' | 'statusIdle'> = {
  live: 'statusRunning',
  starting: 'statusStarting',
  failed: 'statusStopped',
  blocked: 'statusStopped',
  idle: 'statusIdle',
};

const TONE: Partial<Record<RunPhase, 'ok' | 'error'>> = { live: 'ok', failed: 'error', blocked: 'error' };

/** Whether the app is running — the first fact on the workspace's status bar. */
export function RunStatusItem({ phase }: { phase: RunPhase }) {
  const t = useTranslations('ide.workspace');
  const tone = TONE[phase];
  return (
    <span role="status" className={styles.statusItem} data-tone={tone} style={{ fontWeight: 600 }}>
      <span className={styles.dot} data-muted={phase === 'idle' || undefined} data-tone={tone === 'error' ? 'error' : phase === 'starting' ? 'busy' : undefined} />
      {t(LABEL[phase])}
    </span>
  );
}
