'use client';

import { useEffect, useState } from 'react';
import { getStoredTenantToken } from '@/lib/auth';
import {
  enableDeployNotifications,
  isPushSupported,
  pushPermission,
  syncPushSubscription,
} from '@/lib/pushNotifications';

const DISMISS_KEY = 'bf_push_optin_dismissed';

/**
 * Manages OS-level deploy notifications for logged-in users:
 *   - On load, re-syncs the push subscription for anyone who already granted
 *     permission (covers VAPID rotation / a cleared server row).
 *   - If permission hasn't been decided yet, shows a one-time, session-dismissable
 *     opt-in toast. Browsers require a user gesture to prompt, so the actual
 *     Notification.requestPermission() fires from the button click.
 *
 * Decides its own visibility (renders null unless an opt-in is genuinely pending),
 * so it can be dropped into the layout unconditionally.
 */
export function DeployNotificationsManager() {
  const [showOptIn, setShowOptIn] = useState(false);

  useEffect(() => {
    if (!isPushSupported() || !getStoredTenantToken()) return;

    const perm = pushPermission();
    if (perm === 'granted') {
      void syncPushSubscription();
    } else if (perm === 'default' && sessionStorage.getItem(DISMISS_KEY) !== '1') {
      setShowOptIn(true);
    }
  }, []);

  if (!showOptIn) return null;

  const enable = async () => {
    setShowOptIn(false);
    await enableDeployNotifications();
  };

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setShowOptIn(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Enable update notifications"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9998, // just below the update banner (9999)
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px 12px 20px',
        background: 'var(--bg-surface, #1a1a24)',
        border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(16px)',
        maxWidth: 'calc(100vw - 48px)',
      }}
    >
      <span
        style={{
          fontSize: '0.875rem',
          color: 'var(--text-primary, #e8e8f0)',
          fontFamily: 'var(--font-body, sans-serif)',
        }}
      >
        🔔 Get notified when a new version ships?
      </span>

      <button
        type="button"
        onClick={enable}
        style={{
          padding: '6px 14px',
          background: 'linear-gradient(135deg, var(--coral-bright, #f4726e), var(--coral-dark, #c94f4b))',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontFamily: 'var(--font-display, sans-serif)',
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: 'pointer',
          letterSpacing: '0.02em',
          flexShrink: 0,
        }}
      >
        Enable
      </button>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted, #6b6b80)',
          cursor: 'pointer',
          fontSize: '1rem',
          lineHeight: 1,
          padding: '2px 4px',
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
