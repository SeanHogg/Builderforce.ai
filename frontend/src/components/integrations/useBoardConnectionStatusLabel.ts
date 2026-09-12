'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

/**
 * A board connection's status (`active | degraded | disabled`, board_connections.status)
 * as a localized label. An unknown value renders as-is rather than as a dotted key.
 */
export function useBoardConnectionStatusLabel(): (status: string) => string {
  const t = useTranslations('boardConnections');
  return useCallback((status: string) => (t.has(`status.${status}`) ? t(`status.${status}`) : status), [t]);
}
