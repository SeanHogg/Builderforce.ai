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
import { apiRequest } from './apiClient';

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

/** Build-time UI version, or '—' when the build didn't stamp one. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '—';

/**
 * How long the `/health` probe may take before it is abandoned.
 *
 * Unreachable and SLOW are different failures, and only the first one was handled.
 * A rejected fetch resolves null and the report says `apiVersion: (none)` honestly —
 * but a fetch that never settles (offline with a live socket, a captive portal, a
 * stalled connection) left the awaiting caller hanging forever. That is what turns a
 * "Copy diagnostics" button into a button that does nothing at all: the click is
 * received, the report is never built, and nothing is ever shown to say so. The stamp
 * is the least important line in a diagnostics report and must never be able to hold
 * the rest of it hostage, so the probe is bounded and an over-run is just a null.
 */
const HEALTH_PROBE_TIMEOUT_MS = 2_500;

/**
 * The deployed API version. Cached for the session and coalesced across callers,
 * so the footer, the sidebar menu and a diagnostics capture cost one request
 * between them. Resolves null when /health is unreachable OR too slow — a capture
 * must never fail, and must never STALL, because a version lookup did.
 */
export function fetchApiVersion(): Promise<string | null> {
  return fetchApiVersionVia(() => {
    const probe = apiRequest<{ version?: string } | null>('/health', {
      auth: 'none',
      credentials: 'omit',
      // Aborts the request itself, not just the wait: a probe nobody is listening to
      // any more should not stay on the connection pool either. The race below is what
      // GUARANTEES the bound — the signal is the courtesy that also frees the socket.
      ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) }
        : {}),
      // A version probe must never toast: it is ambient and its failure is
      // already handled by resolving null.
      expectedErrors: [400, 401, 403, 404, 429, 500, 502, 503],
    }).catch(() => null);
    return Promise.race([
      probe,
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), HEALTH_PROBE_TIMEOUT_MS); }),
    ]);
  });
}
