import { AUTH_API_URL } from './auth';

/**
 * THE API, SPOKEN AS A WEBSOCKET — one place, because there were eight.
 *
 * `AUTH_API_URL.replace(/^http/, 'ws')` followed by a hand-built query string was
 * written out longhand in the agent-host relay, the execution stream, the canvas
 * live channel, the ceremony room, the embed room, the guest room, the platform
 * broadcast room and the meetings signaller. Eight copies of two rules — how an
 * http origin becomes a ws origin, and how a token reaches a socket that cannot
 * carry an Authorization header — is eight chances for one of them to drift, and
 * one already had: `(AUTH_API_URL || '')` in the agent-host copy guarded against
 * an empty origin nowhere else bothered with, because nowhere else could be empty.
 *
 * Adding a NINTH for real-time co-editing is what made this worth extracting
 * rather than continuing.
 *
 * ── WHY A PARAMS OBJECT AND NOT A STRING ─────────────────────────────────────
 * Every one of the eight interpolated its token with `encodeURIComponent`, and
 * every one had to remember to. A JWT does not usually contain a character that
 * needs escaping, which is exactly the property that makes forgetting invisible
 * until the day a value does. Here it is not possible to forget: values are
 * encoded by `URLSearchParams`, and a null/undefined value is DROPPED rather than
 * serialised as the string "undefined".
 */

/** The API origin as a WebSocket scheme — `https:` → `wss:`, `http:` → `ws:`. */
export function apiSocketOrigin(): string {
  return (AUTH_API_URL || '').replace(/^http/, 'ws').replace(/\/+$/, '');
}

/**
 * A WebSocket URL for an API path.
 *
 * @param path   Absolute API path, leading slash included (`/api/…`). Interpolated
 *               ids must already be encoded — this function cannot tell a path
 *               separator from a slash inside an id.
 * @param params Query parameters. `undefined`/`null` are omitted entirely.
 */
export function apiSocketUrl(
  path: string,
  params?: Readonly<Record<string, string | number | undefined | null>>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const search = query.toString();
  return `${apiSocketOrigin()}${path}${search ? `?${search}` : ''}`;
}
