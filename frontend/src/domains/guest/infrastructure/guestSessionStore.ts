'use client';

/**
 * THE GUEST SESSION — one id per browser, and the edits made against it.
 *
 * `localCanvasStore` is this same idea for BOARDS, and it stays the owner of
 * boards: a canvas has its own schema, its own index and its own claim. This is
 * the store for everything else a signed-out visitor touches — the sample
 * workspace's rows once they have changed them — so the two do not become one
 * module that knows about both.
 *
 * ── KEYED BY BUILD ID, WHICH IS THE WHOLE POINT ──────────────────────────────
 * The sample workspace ships in the bundle. A visitor who edited it three
 * deploys ago is holding rows shaped for code that no longer exists, and the
 * failure mode is the worst kind: not an error, but a chart that silently draws
 * the wrong thing. So every key carries `APP_VERSION`, and a deploy simply
 * stops finding the old entries — the fixture is refreshed by the deploy, which
 * is exactly the contract the operator asked for. Stale builds are swept on
 * first access rather than left to accumulate.
 *
 * ── WHY THE SESSION ID IS NOT THE BUILD ID ───────────────────────────────────
 * The session id survives deploys. It is what the visitor's work is claimed
 * under when they sign up (`pendingWork`), and what the funnel joins a prompt to
 * — so a deploy must refresh the DATA without making the visitor a different
 * person halfway through their first session.
 */

import { APP_VERSION } from '@/lib/buildVersion';

const SESSION_KEY = 'builderforce:guest:session';
const EDIT_PREFIX = 'builderforce:guest:edit:';

/** Every key this module writes, so the sweep can recognise its own. */
function editKey(slice: string): string {
  return `${EDIT_PREFIX}${APP_VERSION}:${slice}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode, blocked site data, or a sandboxed frame. A guest with no
    // storage still gets the sample workspace — they just cannot keep an edit.
    return null;
  }
}

/**
 * This browser's guest session id, minted on first read.
 *
 * Returns `null` on the server and wherever storage is unavailable, because a
 * server-rendered guest id would be a different id in every response and the
 * first hydrated frame would replace it — a session that changes identity on
 * hydration is worse than no session.
 */
export function guestSessionId(): string | null {
  const store = storage();
  if (!store) return null;
  const existing = store.getItem(SESSION_KEY);
  if (existing) return existing;
  const minted = `guest-${crypto.randomUUID()}`;
  try {
    store.setItem(SESSION_KEY, minted);
  } catch {
    return null;
  }
  return minted;
}

/**
 * Drop every edit written by a DIFFERENT build.
 *
 * Called once per page load from {@link readGuestEdits}. Cheap — it scans the
 * key list, not the values — and it is what stops a visitor who has been around
 * for six deploys from carrying six dead copies of the sample workspace.
 */
function sweepStaleBuilds(store: Storage): void {
  const live = `${EDIT_PREFIX}${APP_VERSION}:`;
  const stale: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(EDIT_PREFIX) && !key.startsWith(live)) stale.push(key);
  }
  for (const key of stale) {
    try {
      store.removeItem(key);
    } catch {
      /* a quota error on a REMOVE is not worth failing a page load over */
    }
  }
}

let swept = false;

/**
 * The visitor's edits to one slice of the sample workspace, or `null` when they
 * have not changed it.
 *
 * `null` rather than an empty object, deliberately: "unedited" and "edited back
 * to empty" are different states, and only the caller knows which one matters
 * to it.
 */
export function readGuestEdits<T>(slice: string): T | null {
  const store = storage();
  if (!store) return null;
  if (!swept) {
    swept = true;
    sweepStaleBuilds(store);
  }
  const raw = store.getItem(editKey(slice));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A half-written value from a killed tab. Drop it rather than letting every
    // later read fail on the same parse.
    try {
      store.removeItem(editKey(slice));
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Record the visitor's edits to one slice. Silently a no-op without storage. */
export function writeGuestEdits(slice: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(editKey(slice), JSON.stringify(value));
  } catch {
    /* out of quota: the edit is lost, the page is not */
  }
}

/**
 * Forget everything this browser holds as a guest.
 *
 * Called after a successful claim, so a visitor who signs up does not keep a
 * shadow copy of a workspace they now have a real one of.
 */
export function clearGuestSession(): void {
  const store = storage();
  if (!store) return;
  const mine: string[] = [SESSION_KEY];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(EDIT_PREFIX)) mine.push(key);
  }
  for (const key of mine) {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** Which slices this browser has edits for — the claim's input. */
export function editedGuestSlices(): string[] {
  const store = storage();
  if (!store) return [];
  const live = `${EDIT_PREFIX}${APP_VERSION}:`;
  const slices: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(live)) slices.push(key.slice(live.length));
  }
  return slices;
}
