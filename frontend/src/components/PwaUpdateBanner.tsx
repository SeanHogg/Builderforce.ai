'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AppToast, AppToastDismissButton, AppToastPrimaryButton, AppToastText } from './AppToast';
import { useAppToastSlot } from './appToastStack';

/** Seconds before an available update auto-applies if the user doesn't act. */
const AUTORELOAD_SECONDS = 60;
/** How long "Update now" waits for the new worker to take control before reloading anyway. */
const ACTIVATION_FALLBACK_MS = 3000;

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
 *   4. "Update now" (or countdown hitting 0) → posts SKIP_WAITING to the
 *      registration's current waiting worker → reloads once controllerchange
 *      fires, or straight away / after a short fallback when there is nothing
 *      left to activate (another tab already did it).
 *   5. "×" cancels the countdown and dismisses the banner for the session.
 */
export function PwaUpdateBanner() {
  const t = useTranslations('pwa');
  const [waitingSw, setWaitingSw] = useState<ServiceWorker | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTORELOAD_SECONDS);
  const reloadingRef = useRef(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // --- Register + detect updates ------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Promote a waiting SW into the banner and (re)start its countdown. Resetting
    // secondsLeft here — in a callback, not synchronously in an effect body — keeps
    // the countdown effect free of setState-in-effect (cascading renders).
    const promote = (sw: ServiceWorker) => {
      setWaitingSw(sw);
      setSecondsLeft(AUTORELOAD_SECONDS);
    };
    const trackWaiting = (sw: ServiceWorker) => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        promote(sw);
        return;
      }
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          promote(sw);
        }
      });
    };

    let intervalId: ReturnType<typeof setInterval>;
    let registration: ServiceWorkerRegistration | null = null;
    // registration.update() rejects on a transient sw.js fetch failure ("An
    // unknown error occurred when fetching the script"). It fires on every poll
    // AND on each visibilitychange/focus/online, so an unhandled rejection here
    // spams the console with "Uncaught (in promise)" on every tab focus. Swallow
    // it the same way we handle a failed initial register() — a missed update
    // check is non-fatal; the next tick retries.
    const checkForUpdate = () => {
      registration?.update().catch((err) => {
        console.warn('[SW] Update check failed (will retry):', err);
      });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };

    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        registrationRef.current = reg;
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

  // The click must ALWAYS end in a reload. Waiting on controllerchange alone left
  // the button dead whenever the worker held in state had already moved on: another
  // tab (or its countdown) activated it, or a newer deploy superseded it. Then
  // SKIP_WAITING went to a worker with nothing to skip, controllerchange never
  // fired again, and the latched reloadingRef also disarmed the countdown. So:
  // message the registration's CURRENT waiting worker, reload outright when there
  // is none, and reload on a timer if activation never reports back. A reload is
  // always safe here — navigations are network-first and chunks are content-hashed.
  const applyUpdate = () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    const reload = () => { window.location.reload(); };
    const waiting = registrationRef.current?.waiting ?? null;
    if (!waiting) {
      reload();
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    window.setTimeout(reload, ACTIVATION_FALLBACK_MS);
    waiting.postMessage('SKIP_WAITING');
  };

  // --- Auto-reload countdown ----------------------------------------------
  // secondsLeft is reset to AUTORELOAD_SECONDS in promote() when the waiting SW
  // is detected, so this effect only owns the 1 s tick — no setState in its body.
  useEffect(() => {
    if (!waitingSw) return;
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

  // Register in the shared bottom-center stack while the banner is live so the
  // install prompt offsets above it instead of overlapping (slot 0 = bottom).
  const slot = useAppToastSlot('update', waitingSw != null);

  if (!waitingSw) return null;

  const dismiss = () => {
    reloadingRef.current = true; // block any in-flight countdown from firing after dismiss
    setWaitingSw(null);
  };

  return (
    <AppToast slot={slot}>
      <AppToastText>{t('updateReady', { seconds: secondsLeft })}</AppToastText>
      <AppToastPrimaryButton onClick={applyUpdate}>{t('updateNow')}</AppToastPrimaryButton>
      <AppToastDismissButton onClick={dismiss} />
    </AppToast>
  );
}
