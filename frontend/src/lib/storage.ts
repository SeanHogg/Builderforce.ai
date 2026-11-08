/**
 * THE localStorage door — the one place the browser's storage is touched.
 *
 * Every raw `localStorage.getItem` in this tree was a place that threw somewhere:
 * Safari private mode (`SecurityError` on access), a sandboxed frame, a server
 * render where `window` is undefined, and quota errors on write. The sidebar's
 * collapse preference threw on the first of those; the last-canvas pointer on
 * the third. A read that cannot happen returns `null`; a write that cannot
 * happen returns `false`. Nothing here ever escapes.
 *
 * No `'use client'`: this is a plain module that guards on `window` itself,
 * imported from both sides of the boundary.
 */

type StoreKind = 'localStorage' | 'sessionStorage';

/** A store, or `null` where there is none (server, private mode, sandbox). */
function webStore(kind: StoreKind): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[kind];
  } catch {
    return null;
  }
}

function readFrom(kind: StoreKind, key: string): string | null {
  const store = webStore(kind);
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function writeTo(kind: StoreKind, key: string, value: string): boolean {
  const store = webStore(kind);
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeFrom(kind: StoreKind, key: string): void {
  const store = webStore(kind);
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* a failed remove leaves nothing worse than what was there */
  }
}

/** The store, or `null` where there is none (server, private mode, sandbox). */
export const localStore = (): Storage | null => webStore('localStorage');

export const readLocal = (key: string): string | null => readFrom('localStorage', key);

/** `true` when the value is now stored; `false` on quota, private mode or the server. */
export const writeLocal = (key: string, value: string): boolean => writeTo('localStorage', key, value);

export const removeLocal = (key: string): void => removeFrom('localStorage', key);

/** Per-tab twins of the above (`sessionStorage`), with the same never-throws contract. */
export const readSession = (key: string): string | null => readFrom('sessionStorage', key);
export const writeSession = (key: string, value: string): boolean => writeTo('sessionStorage', key, value);
export const removeSession = (key: string): void => removeFrom('sessionStorage', key);

/** A JSON value, or `null` for absent, unparseable or unavailable. */
export function readLocalJson<T>(key: string): T | null {
  const raw = readLocal(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeLocalJson(key: string, value: unknown): boolean {
  return writeLocal(key, JSON.stringify(value));
}
