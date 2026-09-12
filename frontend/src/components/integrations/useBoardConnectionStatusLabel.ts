import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

/*
 * No `'use client'`, deliberately. A hook module marks no boundary, and this one is
 * `useTranslations` + `useCallback` — both render on the server too — so the directive
 * declared no runtime it needs. The `i18n/useErrorMessage.ts` shape.
 */

/**
 * A board connection's status (`active | degraded | disabled`, board_connections.status)
 * as a localized label. An unknown value renders as-is rather than as a dotted key.
 */
export function useBoardConnectionStatusLabel(): (status: string) => string {
  const t = useTranslations('boardConnections');
  return useCallback((status: string) => (t.has(`status.${status}`) ? t(`status.${status}`) : status), [t]);
}
