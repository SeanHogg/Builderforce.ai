'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { getActiveCanvasSync, subscribeActiveCanvasSync } from '@/lib/activeCanvasSyncStatus';

export interface CanvasSyncBadgeProps {
  /** The session this row names. Renders nothing when it is not the live canvas. */
  sessionId: string | null;
}

/**
 * The active canvas's own connection light — self-contained, so any row that
 * names a session can drop it in without also wiring a subscription to
 * `activeCanvasSyncStatus` and a translation lookup of its own. It decides
 * its own visibility: absent for every session that is not the one actually
 * on screen, including a local-only board with no connection to report.
 */
export function CanvasSyncBadge({ sessionId }: CanvasSyncBadgeProps) {
  const t = useTranslations('sessions');
  const state = useSyncExternalStore(
    subscribeActiveCanvasSync,
    () => getActiveCanvasSync(sessionId),
    () => undefined,
  );
  if (!state) return null;
  const label = state === 'online' ? t('synced')
    : state === 'offline' ? t('offlineRetry')
    : state === 'reconnecting' ? t('reconnecting')
    : t('connecting');
  return (
    <span className="nav-sessions__sync" role="status" aria-live="polite" data-state={state}>
      {label}
    </span>
  );
}
