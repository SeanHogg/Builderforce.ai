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
 *
 * The session cache + in-flight coalescing live in the shared `fetchApiVersionVia`
 * helper, which the VS Code webview reuses through its own gateway-based read; only
 * the origin and the fetch mechanics differ per surface.
 */

import { fetchApiVersionVia } from '@seanhogg/builderforce-brain-embedded';

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

/** Build-time UI version, or '—' when the build didn't stamp one. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '—';

/**
 * The deployed API version. Cached for the session and coalesced across callers,
 * so the footer, the sidebar menu and a diagnostics capture cost one request
 * between them. Resolves null when /health is unreachable — a capture must never
 * fail because a version lookup did.
 */
export function fetchApiVersion(): Promise<string | null> {
  return fetchApiVersionVia(() =>
    fetch(`${AUTH_API_URL}/health`, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)),
  );
}
