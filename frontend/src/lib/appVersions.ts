'use client';

/**
 * Build/deploy versions — the ONE source for "which code am I actually running?".
 *
 * This exists because a support capture with no version on it is ambiguous in the
 * worst way: a diagnostics dump taken minutes before a deploy looks identical to
 * one taken after, so a fixed bug reads as unfixed. The footer already showed
 * `UI x · API y`; the Brain's diagnostics report needs the same two numbers, so
 * the fetch + cache live here and both surfaces read them.
 *
 * The UI version is baked at build time; the API version comes from `/health`
 * (public, unauthenticated) and is cached for the session — it only changes when
 * the worker redeploys, at which point the page is reloaded anyway.
 */

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

/** Build-time UI version, or '—' when the build didn't stamp one. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '—';

let cached: string | null = null;
let inflight: Promise<string | null> | null = null;

/**
 * The deployed API version. Cached for the session and coalesced across callers,
 * so the footer, the sidebar menu and a diagnostics capture cost one request
 * between them. Resolves null when /health is unreachable — a capture must never
 * fail because a version lookup did.
 */
export function fetchApiVersion(): Promise<string | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch(`${AUTH_API_URL}/health`, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { version?: string } | null) => {
      cached = data?.version ?? null;
      return cached;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

/** The API version if it has already been fetched this session, else null. */
export function getCachedApiVersion(): string | null {
  return cached;
}
