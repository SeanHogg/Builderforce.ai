/**
 * React Hook for UI-facing Red Alert Notifications
 *
 * Consumes RedAlertNotificationCenter centrally and surfaces actionable in-app
 * notifications via push-toasts or indicators, satisfying FR-3 and AC-6/AC-8.
 */

import { useState, useCallback, useRef } from 'react';
// Import directly from the concrete module (not the barrel) to avoid a
// circular dependency: services/redAlert/index.ts re-exports this hook.
import {
  redAlertNotificationCenter,
  type AlertNotification,
  type NotificationChannel,
} from '../services/redAlertServices';

export interface UseRedAlertNotificationsOptions {
  /** Minimum channels that must be processed to count as 'delivered' per alert dispatch call */
  requiredChannels?: NotificationChannel[];
  /** Additional debounce/window duration in ms to filter newly-arrived history entries only */
  debounceWindowMs?: number;
  /** Whether to hide per-channel delivery details in notifications (appears as a single toast) */
  collapseAccounts?: boolean;
}

export interface UseRedAlertNotificationsReturn {
  /** All recent alerts, ordered newest first */
  notifications: AlertNotification[];
  /** Only unread (no receivedAt) */
  unreadCount: number;
  /** Load history (useful after a window lapse like modal expiration) */
  loadHistory: () => void;
  /** Mark an alert as read */
  markAsRead: (alertId: string) => void;
  /** Clear history entirely */
  clearHistory: () => void;
}

/**
 * Hook to surface Red alert notifications in the UI
 */
export function useRedAlertNotifications(
  options: UseRedAlertNotificationsOptions = {}
): UseRedAlertNotificationsReturn {
  const { requiredChannels = ['in-app', 'email'], debounceWindowMs = 60000 } = options;
  const lastLoadTimestampRef = useRef(0);

  const [notifications, setNotifications] = useState<AlertNotification[]>([]);

  /**
   * Pull new alerts within the debounce window after any lapse
   */
  const loadHistory = useCallback(() => {
    const now = Date.now();
    if (now - lastLoadTimestampRef.current < debounceWindowMs) {
      console.debug('[useRedAlertNotifications] loadHistory throttled within window');
      return;
    }
    const fresh = redAlertNotificationCenter.getAllRecentAlerts();
    setNotifications(fresh);
    lastLoadTimestampRef.current = now;
  }, [debounceWindowMs]);

  /** Mark an alert as read */
  const markAsRead = useCallback((alertId: string) => {
    redAlertNotificationCenter.markAsRead(alertId);
    setNotifications((prev) => prev.map((a) => (a.id === alertId ? { ...a, readAt: new Date().toISOString() } : a)));
  }, []);

  /** Clear history */
  const clearHistory = useCallback(() => {
    redAlertNotificationCenter.clearAlertState();
    setNotifications([]);
  }, []);

  // Initialize history
  const init = useCallback(() => {
    loadHistory();
  }, [loadHistory]);

  return {
    notifications,
    unreadCount: notifications.filter((a) => !a.readAt).length,
    loadHistory,
    markAsRead,
    clearHistory,
  };
}

export default useRedAlertNotifications;