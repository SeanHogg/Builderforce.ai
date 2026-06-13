'use client';

import { useEffect, useRef, useState } from 'react';

/** Seconds before an available update auto-applies if the user doesn't act. */
const AUTORELOAD_SECONDS = 60;

/**
 * Registers the service worker and shows an update toast whenever a new version
 * is waiting to activate. The toast counts down and auto-reloads onto the new
 * build if the user doesn't act — so an idle/open tab still ends up current.
 *
 * Flow:
 *   1. Registers /sw.js on mount (updateViaCache:'none' so the script is always
 *      revalidated against the network).
 *   2. Checks for updates every 60 s AND on tab focus / regained visibility /
 *      reconnect — so a returning user is notified promptly, not up to 60 s later.
 *   3. Detects waiting SW → shows banner with a 60 s auto-reload countdown.
 *   4. "Update now" (or countdown hitting 0) → posts SKIP_WAITING → reloads once
 *      controllerchange fires.
 *   5. "×" cancels the countdown and dismisses the banner for the session.
 */
export function PwaUpdateBanner() {
  const [waitingSw, setWaitingSw] = useState<ServiceWorker | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTORELOAD_SECONDS);
  const reloadingRef = useRef(false);

  // --- Register + detect updates ------------------------------------------
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
    let registration: ServiceWorkerRegistration | null = null;
    const checkForUpdate = () => { void registration?.update(); };
    const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };

    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        if (reg.waiting) trackWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          if (reg.installing) trackWaiting(reg.installing);
        });

        // Poll, plus check whenever the user comes back to the tab or reconnects —
        // these fire far sooner than the 60 s poll for a returning user.
        intervalId = setInterval(checkForUpdate, 60_000);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', checkForUpdate);
        window.addEventListener('online', checkForUpdate);
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', checkForUpdate);
      window.removeEventListener('online', checkForUpdate);
    };
  }, []);

  const applyUpdate = () => {
    if (reloadingRef.current || !waitingSw) return;
    reloadingRef.current = true;
    waitingSw.postMessage('SKIP_WAITING');
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => { window.location.reload(); },
      { once: true },
    );
  };

  // --- Auto-reload countdown ----------------------------------------------
  useEffect(() => {
    if (!waitingSw) return;
    setSecondsLeft(AUTORELOAD_SECONDS);
    const tick = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          applyUpdate();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // applyUpdate reads the same waitingSw; re-running only when waitingSw changes is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingSw]);

  if (!waitingSw) return null;

  const dismiss = () => {
    reloadingRef.current = true; // block any in-flight countdown from firing after dismiss
    setWaitingSw(null);
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
        A new version is ready — updating in {secondsLeft}s.
      </span>

      <button
        type="button"
        onClick={applyUpdate}
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
        onClick={dismiss}
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
