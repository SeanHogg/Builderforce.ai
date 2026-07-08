/**
 * Recovery for webpack ChunkLoadError / stale-asset crashes.
 *
 * Symptom: `Loading chunk 466 failed. (missing: .../466.undefined.js)`. The
 * literal `undefined` where the content-hash belongs means the webpack runtime
 * currently in memory has NO hash-map entry for that chunk id — i.e. the loaded
 * `webpack-*.js` runtime and the page bundle requesting the chunk are from
 * DIFFERENT builds. Our cache-first service worker (public/sw.js) can serve a
 * stale runtime across a deploy, which produces exactly this skew.
 *
 * The reliable cure is to drop the stale caches + service worker and hard-reload
 * onto the current build. A time-window guard prevents an infinite reload loop
 * when the reload doesn't fix it (genuinely broken deploy) — after one attempt
 * within the window we stop auto-reloading and surface a manual retry instead.
 */

const RELOAD_AT_KEY = 'bf-chunk-reload-at';
/** How long a just-happened auto-reload suppresses another one (loop guard). */
const RELOAD_WINDOW_MS = 30_000;

/** True when `err` is a webpack chunk-load / stale-asset failure. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name;
  if (name === 'ChunkLoadError') return true;
  const message = String((err as { message?: string }).message ?? err);
  return (
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    // `NN.undefined.js` / a hashed chunk that 404'd — the stale-runtime signature.
    /\.undefined\.js/i.test(message) ||
    /importScripts|Failed to fetch dynamically imported module/i.test(message)
  );
}

/**
 * True when an auto-recovery reload already fired within the loop-guard window.
 * The boundary uses this to decide "recovering" (auto-reload) vs "failed"
 * (show manual retry) without needing to clear a flag on success — the window
 * naturally lapses, so a genuinely-new chunk error minutes later still heals.
 */
export function chunkRecoveryAlreadyAttempted(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_AT_KEY) || '0');
    return at > 0 && Date.now() - at < RELOAD_WINDOW_MS;
  } catch {
    return false;
  }
}

/** Purge the SW caches + registrations so the next load fetches fresh JS. */
async function purgeStaleAssets(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* cache API unavailable — non-fatal */
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* SW API unavailable — non-fatal */
  }
}

/**
 * Recover from a chunk-load error: purge stale caches/SW, then hard-reload onto
 * the current build. No-ops if a reload already fired inside the loop-guard
 * window, unless `force` (a user explicitly clicking "Reload").
 */
export async function recoverFromChunkError(force = false): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!force && chunkRecoveryAlreadyAttempted()) return;
  try {
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  } catch {
    /* private mode — proceed to reload anyway */
  }
  await purgeStaleAssets();
  window.location.reload();
}

/**
 * Install a window-level listener that heals async chunk errors surfaced as
 * unhandled promise rejections (router prefetch, event-handler imports) — those
 * never reach a React error boundary. Returns a cleanup fn. Loop-guarded via
 * recoverFromChunkError, so at most one auto-reload per window.
 */
export function installChunkErrorRecovery(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onRejection = (e: PromiseRejectionEvent) => {
    if (isChunkLoadError(e.reason)) void recoverFromChunkError();
  };
  const onError = (e: ErrorEvent) => {
    if (isChunkLoadError(e.error ?? e.message)) void recoverFromChunkError();
  };
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError);
  return () => {
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onError);
  };
}
