/**
 * The Create library's remembered layout — card gallery or table rows.
 *
 * ── WHY THIS IS A STORE AND NOT A `useState` + `useEffect` ───────────────────────
 * The panel server-renders, so the preference cannot be read in a lazy initializer
 * (the first client render would disagree with the server's and break hydration), and
 * reading it in an effect means a `setState` in an effect body — a cascading render,
 * and a visible flash of the layout the reader did not choose.
 *
 * `useSyncExternalStore` is the primitive for exactly this: a client snapshot, a
 * SEPARATE server snapshot, and a subscription. React reconciles the two itself.
 * `storage` events are part of the subscription on purpose — two tabs of the library
 * are two views of one preference, and the loser of a race should not keep showing the
 * layout the reader has since changed.
 *
 * Mirrors `lib/sessionListPreferences.ts`, the sibling convention for a stored bit of
 * canvas chrome.
 */

/** `table` IS the list view — the canonical `components/ViewToggle` vocabulary. */
export type CreationLibraryView = 'card' | 'table';

export const CREATION_LIBRARY_VIEW_KEY = 'builderforce.dashboard.creationLibraryView';

const DEFAULT_VIEW: CreationLibraryView = 'card';

/** Listeners for writes made in THIS tab; `storage` only fires in the others. */
const listeners = new Set<() => void>();

/** Cached so `getSnapshot` is referentially stable — returning a fresh value each
 *  call makes React re-render forever. Invalidated by every write path. */
let snapshot: CreationLibraryView | null = null;

/**
 * Whether `localStorage` has proved usable. A hardened context (private window,
 * site data blocked) THROWS on access rather than answering null, so once a write
 * has failed the store stops going back — the choice still applies for this session,
 * it just will not survive a reload, and re-throwing on every read to learn that
 * again is noise.
 */
let persistable = true;

export function subscribeCreationLibraryView(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CREATION_LIBRARY_VIEW_KEY) {
      snapshot = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function readCreationLibraryView(): CreationLibraryView {
  if (snapshot !== null) return snapshot;
  if (!persistable) return DEFAULT_VIEW;
  try {
    const stored = window.localStorage.getItem(CREATION_LIBRARY_VIEW_KEY);
    // Older browsers hold `list` under this key, so the read normalises it rather
    // than silently resetting somebody's choice to the default.
    snapshot = stored === 'table' || stored === 'list' ? 'table' : DEFAULT_VIEW;
  } catch {
    // Storage can be unavailable in hardened contexts; the default is not a failure.
    persistable = false;
    snapshot = DEFAULT_VIEW;
  }
  return snapshot;
}

/** The server has no reader and therefore no preference. Constant, so React's
 *  hydration comparison is against a stable value. */
export function serverCreationLibraryView(): CreationLibraryView {
  return DEFAULT_VIEW;
}

export function writeCreationLibraryView(view: CreationLibraryView): void {
  // The snapshot is set FIRST, so the reader's choice takes effect even where it
  // cannot be persisted — the toggle is never dead, it just forgets on reload.
  snapshot = view;
  try {
    window.localStorage.setItem(CREATION_LIBRARY_VIEW_KEY, view);
  } catch {
    persistable = false;
  }
  for (const listener of listeners) listener();
}
