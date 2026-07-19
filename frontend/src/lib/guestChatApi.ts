'use client';

/**
 * Guest (logged-out) Brain chat — client-side session + usage.
 *
 * A logged-out visitor can try the Brain before signing up. We mint a short-lived
 * guest token (bound to their anonymous `visitorId`) from `/api/guest/session` and
 * store it in localStorage; the Brain's guest transport sends it as the Bearer so
 * the gateway can meter the call (tiny per-visitor + per-IP cap). Signing up
 * unlocks the real free tier — the existing marketing `convert` flow stamps the
 * same visitorId, so their lead carries over.
 */

import { AUTH_API_URL } from './auth';
import { getVisitorId, getFirstTouch } from './visitor';

const GUEST_TOKEN_KEY = 'bf_guest_token';
const GUEST_TOKEN_EXP_KEY = 'bf_guest_token_exp'; // unix ms

export interface GuestUsage {
  /** Messages left today for this visitor. */
  remaining: number;
  /** The per-visitor daily limit. */
  limit: number;
  /** False when the kill switch has disabled guest chat entirely. */
  enabled: boolean;
}

/** The stored guest token if present and not expired, else null. */
export function getStoredGuestToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    const exp = Number(window.localStorage.getItem(GUEST_TOKEN_EXP_KEY) ?? '0');
    if (!token) return null;
    // Refresh a minute early so an in-flight request never rides an expiring token.
    if (exp && Date.now() > exp - 60_000) return null;
    return token;
  } catch {
    return null;
  }
}

export function clearGuestToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUEST_TOKEN_KEY);
    window.localStorage.removeItem(GUEST_TOKEN_EXP_KEY);
  } catch { /* ignore */ }
}

/**
 * Mint (or refresh) a guest session: records the lead and returns a token +
 * the guest's remaining allowance. Returns null when guest chat is disabled or
 * the request fails.
 */
export async function mintGuestSession(): Promise<GuestUsage | null> {
  const visitorId = getVisitorId();
  if (!visitorId) return null;
  const touch = getFirstTouch();
  try {
    const res = await fetch(`${AUTH_API_URL}/api/guest/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, touch }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token: string; expiresInSeconds: number; remaining: number; limit: number };
    try {
      window.localStorage.setItem(GUEST_TOKEN_KEY, data.token);
      window.localStorage.setItem(GUEST_TOKEN_EXP_KEY, String(Date.now() + data.expiresInSeconds * 1000));
    } catch { /* private mode — token lives only for this page load */ }
    return { remaining: data.remaining, limit: data.limit, enabled: true };
  } catch {
    return null;
  }
}

/** Ensure a valid guest token exists (mint on demand). Returns the token or null. */
export async function ensureGuestToken(): Promise<string | null> {
  const existing = getStoredGuestToken();
  if (existing) return existing;
  await mintGuestSession();
  return getStoredGuestToken();
}

/** The guest's current remaining allowance (for the composer's "N left"). */
export async function getGuestUsage(): Promise<GuestUsage | null> {
  const visitorId = getVisitorId();
  if (!visitorId) return null;
  try {
    const res = await fetch(`${AUTH_API_URL}/api/guest/usage/${encodeURIComponent(visitorId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { remaining: number; limit: number; enabled: boolean };
    return { remaining: data.remaining, limit: data.limit, enabled: data.enabled };
  } catch {
    return null;
  }
}
