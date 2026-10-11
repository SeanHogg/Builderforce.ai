/**
 * Visitor and visit ids — same tokens the rest of the product already mints.
 *
 * `bf_visitor_id` is the anonymous visitor (localStorage + first-party cookie).
 * `bf_visit_id` rotates after `VISIT_IDLE_MS` of silence. Both match
 * `VISITOR_ID_PATTERN` so ingest accepts them.
 */

import { VISIT_IDLE_MS, VISITOR_ID_PATTERN } from '@builderforce/interaction-contract';

export { VISIT_IDLE_MS, VISITOR_ID_PATTERN };

const VISITOR_KEY = 'bf_visitor_id';
const VISIT_KEY = 'bf_visit_id';
const VISIT_SEEN_KEY = 'bf_visit_last_seen';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function mintId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Stable anonymous visitor id. Null during SSR. */
export function getVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  let id = readStored(VISITOR_KEY) ?? readCookie(VISITOR_KEY);
  if (!id || !VISITOR_ID_PATTERN.test(id)) id = mintId();
  writeStored(VISITOR_KEY, id);
  writeCookie(VISITOR_KEY, id);
  return id;
}

/** Visit in progress, rotated after `VISIT_IDLE_MS` of idle. */
export function getVisitId(now: number = Date.now()): string | null {
  if (typeof window === 'undefined') return null;
  const lastSeen = Number(readStored(VISIT_SEEN_KEY) ?? '0');
  const existing = readStored(VISIT_KEY);
  const stale =
    !existing ||
    !VISITOR_ID_PATTERN.test(existing) ||
    !Number.isFinite(lastSeen) ||
    now - lastSeen > VISIT_IDLE_MS;
  const visitId = stale ? mintId() : existing;
  writeStored(VISIT_KEY, visitId);
  writeStored(VISIT_SEEN_KEY, String(now));
  return visitId;
}
