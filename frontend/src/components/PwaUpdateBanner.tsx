'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the service worker and shows a non-intrusive update toast
 * whenever a new version is waiting to activate.
 *
 * Flow:
 *   1. Registers /sw.js on mount
 *   2. Polls for updates every 60 s
 *   3. Detects waiting SW → shows banner
 *   4. "Update now" → posts SKIP_WAITING → reloads once controllerchange fires
 *   5. "×" dismisses the banner for the current session
 */
export function PwaUpdateBanner() {
  const [waitingSw, setWaitingSw] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const trackWaiting = (sw: ServiceWorker) => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        setWaitingSw(sw);
        return;
      }
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          setWaitingSw(sw);
        }
      });
    };

    let intervalId: ReturnType<typeof setInterval>;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Already waiting on page load (e.g. user has the app open in another tab)
        if (reg.waiting) trackWaiting(reg.waiting);

        // New update found after the page loaded
        reg.addEventListener('updatefound', () => {
          if (reg.installing) trackWaiting(reg.installing);
        });

        // Poll for updates every 60 s
        intervalId = setInterval(() => { void reg.update(); }, 60_000);
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });

    return () => clearInterval(intervalId);
  }, []);

  if (!waitingSw) return null;

  const handleUpdate = () => {
    waitingSw.postMessage('SKIP_WAITING');
    setWaitingSw(null);
    // Reload once the new SW takes control
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => { window.location.reload(); },
      { once: true },
    );
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px 12px 20px',
        background: 'var(--bg-surface, #1a1a24)',
        border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(16px)',
        whiteSpace: 'nowrap',
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
        A new version is ready.
      </span>

      <button
        type="button"
        onClick={handleUpdate}
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
        Update now
      </button>

      <button
        type="button"
        onClick={() => setWaitingSw(null)}
        aria-label="Dismiss update notification"
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
