'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { PwaToast, PwaToastDismissButton, PwaToastPrimaryButton, PwaToastText } from './PwaToast';
import { usePwaToastSlot } from './pwaToastStack';

/**
 * Surfaces an "Install app" affordance for the Builderforce PWA.
 *
 * Browsers no longer pop an automatic install modal, so without this the only
 * way to install is the (easily missed) address-bar icon / browser menu. This
 * component:
 *   1. Captures `beforeinstallprompt` (Chrome/Edge/Android), stashes it, and
 *      shows a one-tap "Install" button that calls the stashed event's prompt().
 *   2. Falls back to manual "Add to Home Screen" guidance on iOS Safari, which
 *      never fires `beforeinstallprompt` and cannot be prompted programmatically.
 *   3. Stays hidden when already installed (standalone display-mode / iOS
 *      navigator.standalone) or recently dismissed.
 *
 * Dismissal is remembered in localStorage for DISMISS_DAYS so we don't nag.
 */

/** Minimal shape of the non-standard beforeinstallprompt event. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'bf-pwa-install-dismissed';
const DISMISS_DAYS = 14;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari exposes installed state here, not via display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; disambiguate by touch support.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

/** True when the user dismissed within the last DISMISS_DAYS. now() is injected for testability. */
function recentlyDismissed(now: number): boolean {
  if (typeof localStorage === 'undefined') return false;
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return now - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

// The "should we stay hidden?" gate depends on browser-only, time-dependent
// state (display-mode, localStorage, the clock). Reading it through
// useSyncExternalStore keeps it out of the render body — which would otherwise
// trip react-hooks/purity (Date.now) — and is SSR-safe: the server snapshot is
// `true` (hidden), so SSR + the hydration render both produce null, no mismatch.
const subscribeNoop = () => () => {};
const getHiddenSnapshot = () => isStandalone() || recentlyDismissed(Date.now());
const getServerHiddenSnapshot = () => true;

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const externallyHidden = useSyncExternalStore(subscribeNoop, getHiddenSnapshot, getServerHiddenSnapshot);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone() || recentlyDismissed(Date.now())) return;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault(); // stop the mini-infobar so our button drives the prompt
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      // Installed (via our button or the browser UI) — stop prompting and clear
      // any stored dismissal so a future re-install scenario can prompt again.
      setDeferredPrompt(null);
      setDismissed(true);
      try {
        localStorage.removeItem(DISMISS_KEY);
      } catch {
        /* storage may be unavailable (private mode) — non-fatal */
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The event can only be used once. Drop it regardless of outcome; if the
    // user declined, suppress for DISMISS_DAYS so we don't re-nag immediately.
    setDeferredPrompt(null);
    if (outcome === 'dismissed') persistDismiss();
  };

  const persistDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  };

  const dismiss = () => {
    setDismissed(true);
    persistDismiss();
  };

  // Hidden until hydrated, or when already installed / recently dismissed
  // (externallyHidden is the SSR-safe snapshot above); dismissed is this session's "✕".
  const hidden = dismissed || externallyHidden;
  // We can offer install via the deferred prompt (Chrome/Edge/Android) or the iOS
  // manual steps. Compute visibility up-front so the stack slot reflects it (the
  // install toast yields to the update banner — it takes the upper slot).
  const visible = !hidden && (deferredPrompt != null || isIos());
  const slot = usePwaToastSlot('install', visible);

  if (!visible) return null;

  // Chrome/Edge/Android: real one-tap install.
  if (deferredPrompt) {
    return (
      <PwaToast slot={slot}>
        <PwaToastText>Install Builderforce for a faster, full-screen app.</PwaToastText>
        <PwaToastPrimaryButton onClick={install}>Install</PwaToastPrimaryButton>
        <PwaToastDismissButton onClick={dismiss} />
      </PwaToast>
    );
  }

  // iOS Safari: never fires beforeinstallprompt and can't be prompted
  // programmatically — show the manual Add-to-Home-Screen steps instead.
  return (
    <PwaToast nowrap={false} slot={slot}>
      <PwaToastText>
        Install Builderforce: tap the Share icon, then “Add to Home Screen”.
      </PwaToastText>
      <PwaToastDismissButton onClick={dismiss} />
    </PwaToast>
  );
}
