/**
 * Visitor and visit ids (PRD 33 §8 S2).
 *
 * On builderforce.ai (and its subdomains) the recorder shares the product's
 * own `bf_visitor_id` / `bf_visit_id` tokens, so a replay joins the visitor
 * journey on `visit_id`. Everywhere else it uses its own `bfr_` namespace and
 * never touches a customer's `bf_*` keys. A visit rotates after
 * `VISIT_IDLE_MS` of silence on both.
 */

import { VISIT_IDLE_MS, VISITOR_ID_PATTERN } from '@builderforce/interaction-contract';

export type IdNamespace = 'bf' | 'bfr';

export function idNamespace(hostname: string): IdNamespace {
  const host = hostname.toLowerCase();
  return host === 'builderforce.ai' || host.endsWith('.builderforce.ai') ? 'bf' : 'bfr';
}

export interface StorageKeys {
  visitor: string;
  visit: string;
  seen: string;
  /** The recorder's own per-visit state (seq, keep, counters). */
  state: string;
  /**
   * Epoch ms at which the host page minted the visitor id. On builderforce.ai the
   * product (`frontend/src/lib/visitor.ts`) mints `bf_visitor_id` before the
   * recorder loads, so "the recorder minted it" can never be true there; this key
   * is how the recorder still recognises a new visitor.
   */
  minted: string;
}

export function storageKeys(ns: IdNamespace): StorageKeys {
  return {
    visitor: `${ns}_visitor_id`,
    visit: `${ns}_visit_id`,
    seen: `${ns}_visit_last_seen`,
    state: `${ns}_replay_state`,
    minted: `${ns}_visitor_minted_at`,
  };
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function mintId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export interface VisitIdentity {
  visitorId: string;
  visitId: string;
  /** The visitor id was minted by this call, or by the host page within the current visit. */
  newVisitor: boolean;
}

/**
 * Did the host page mint this visitor within the visit in progress? A visit only
 * rotates after an idle gap longer than `VISIT_IDLE_MS`, and no such gap fits in
 * an interval no longer than it — so a mint at most `VISIT_IDLE_MS` ago belongs to
 * the current visit. (A recorder first started more than that into a continuous
 * first visit reads the visitor as returning; ingest only counts a new visitor on
 * the visit's first chunk, which is the recorder's first page load.)
 */
export function mintedThisVisit(mintedAt: string | null, now: number): boolean {
  if (mintedAt == null) return false;
  const at = Number(mintedAt);
  return Number.isFinite(at) && at > 0 && at <= now && now - at <= VISIT_IDLE_MS;
}

/** The visitor and the visit in progress (rotated after an idle gap); marks the visit seen now. */
export function resolveIdentity(ns: IdNamespace, now: number = Date.now()): VisitIdentity {
  const keys = storageKeys(ns);
  let visitorId = readStored(keys.visitor) ?? readCookie(keys.visitor);
  let newVisitor = false;
  if (!visitorId || !VISITOR_ID_PATTERN.test(visitorId)) {
    visitorId = mintId();
    newVisitor = true;
  } else {
    newVisitor = mintedThisVisit(readStored(keys.minted), now);
  }
  writeStored(keys.visitor, visitorId);
  writeCookie(keys.visitor, visitorId);

  const lastSeen = Number(readStored(keys.seen) ?? '0');
  const existing = readStored(keys.visit);
  const stale =
    !existing || !VISITOR_ID_PATTERN.test(existing) || !Number.isFinite(lastSeen) || now - lastSeen > VISIT_IDLE_MS;
  const visitId = stale || !existing ? mintId() : existing;
  writeStored(keys.visit, visitId);
  writeStored(keys.seen, String(now));
  return { visitorId, visitId, newVisitor };
}

/** Keep the visit alive (activity or a flush). */
export function touchVisit(ns: IdNamespace, now: number = Date.now()): void {
  writeStored(storageKeys(ns).seen, String(now));
}
