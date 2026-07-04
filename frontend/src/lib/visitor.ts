/**
 * Anonymous visitor identity for the free Diagnostics & Tools suite.
 *
 * A logged-out visitor who runs a free tool is a marketing lead. We mint a stable
 * `visitorId` (persisted in localStorage AND mirrored to a first-party cookie so
 * it survives across the tools) and capture first-touch attribution once. The id
 * is an opaque token — never PII — and is the whole key the marketing session is
 * tracked by (see MarketingService). Returns null during SSR (no window).
 */

const VISITOR_KEY = 'bf_visitor_id';
const TOUCH_KEY = 'bf_visitor_touch';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export interface FirstTouch {
  landingPath: string;
  referrer: string;
  utm: Record<string, string>;
}

function randomId(): string {
  // 24-char url-safe token (matches the API's /^[A-Za-z0-9_-]{8,64}$/ guard).
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Stable anonymous visitor id, created on first call. Null during SSR. */
export function getVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  let id: string | null = null;
  try {
    id = window.localStorage.getItem(VISITOR_KEY);
  } catch {
    /* private mode — fall through to cookie */
  }
  if (!id) id = readCookie(VISITOR_KEY);
  if (!id) {
    id = randomId();
    try { window.localStorage.setItem(VISITOR_KEY, id); } catch { /* ignore */ }
  }
  // Always (re)assert the cookie so the id survives a localStorage clear.
  writeCookie(VISITOR_KEY, id);
  return id;
}

/** First-touch attribution, captured once on the first tools visit. */
export function getFirstTouch(): FirstTouch {
  if (typeof window === 'undefined') return { landingPath: '', referrer: '', utm: {} };
  try {
    const stored = window.localStorage.getItem(TOUCH_KEY);
    if (stored) return JSON.parse(stored) as FirstTouch;
  } catch { /* ignore */ }

  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const [k, v] of params) {
    if (k.startsWith('utm_') && v) utm[k] = v.slice(0, 128);
  }
  const touch: FirstTouch = {
    landingPath: window.location.pathname.slice(0, 512),
    referrer: (document.referrer || '').slice(0, 512),
    utm,
  };
  try { window.localStorage.setItem(TOUCH_KEY, JSON.stringify(touch)); } catch { /* ignore */ }
  return touch;
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

function writeCookie(name: string, value: string): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}
