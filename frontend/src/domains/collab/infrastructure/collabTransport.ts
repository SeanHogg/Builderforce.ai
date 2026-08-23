import { getStoredTenantToken } from '@/lib/auth';
import { apiSocketOrigin } from '@/lib/apiSocket';

/**
 * WHERE THE CO-EDITING ROOM IS, AND HOW A BROWSER PROVES WHO IT IS.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────
 * Real-time co-editing shipped as code and then sat inert for months, because
 * reaching it needed two things nobody did: a deploy of a second Worker script
 * (`worker/`, which has never been deployed) and an `NEXT_PUBLIC_COLLAB_WS_URL`
 * pointing at it. Two hooks each carried their own copy of a `getCollabWsUrl()`
 * that returned `null` when the variable was unset, and each documented the
 * inertness as a design ("collab is opt-in") rather than as the missing wiring
 * it was.
 *
 * The room now lives in the api Worker — the one that IS deployed, and the one
 * the browser is already authenticated against — so the URL is DERIVED. There is
 * nothing to set, and co-editing is on wherever the API is.
 *
 * ── THE ENV VAR SURVIVES, WITH A DIFFERENT JOB ───────────────────────────────
 * `NEXT_PUBLIC_COLLAB_WS_URL` is now an OVERRIDE, for a self-hoster running the
 * room somewhere other than their API origin. Unset is the ordinary case and
 * means "same place as the API", not "disabled".
 *
 * ── WHY A ROOM NAME IS SCOPED ────────────────────────────────────────────────
 * `y-websocket` appends the room name to the base URL as one path segment, so
 * the name IS the route parameter. The server admits `<scope>:<id>` and nothing
 * else (`api/src/application/collab/collabScopes.ts`), which is what stops a
 * browser naming an arbitrary Durable Object. Callers build one through
 * {@link collabRoom} rather than by hand, so a typo is a type error rather than
 * a 404 at runtime.
 */

/** The co-editable surfaces. Mirrors the server's scope registry exactly. */
export type CollabScope = 'knowledge' | 'project';

/** A room name the server will admit. */
export function collabRoom(scope: CollabScope, id: string | number): string {
  return `${scope}:${id}`;
}

/**
 * The base URL rooms hang off.
 *
 * Returns `null` only when there is no API origin to derive from at all (a build
 * with `NEXT_PUBLIC_AUTH_API_URL` explicitly blanked), which is the one case where
 * connecting could not possibly work.
 */
export function collabSocketBase(): string | null {
  const override = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  if (override && override.trim()) return override.trim().replace(/\/+$/, '');
  const origin = apiSocketOrigin();
  return origin ? `${origin}/api/collab` : null;
}

/**
 * The query parameters a provider connects with.
 *
 * The token is what `authMiddleware` reads — a browser cannot set an
 * Authorization header on a WebSocket. `name` and `color` are cosmetic: the room
 * takes the participant's IDENTITY from the header the authed route stamps, never
 * from these, so a doctored display name can mislabel a cursor and nothing else.
 *
 * Returns `null` when there is no tenant token, because an upgrade without one is
 * a guaranteed 401 and a reconnect loop against it is worse than staying offline.
 */
export function collabParams(profile: { name: string; color: string }): Record<string, string> | null {
  const token = getStoredTenantToken();
  if (!token) return null;
  return { token, name: profile.name, color: profile.color };
}

/**
 * A stable colour for a participant.
 *
 * Hashed from the user id rather than random, so the same person is the same
 * colour in every session and on everybody's screen — a random colour per
 * connection means a reconnect looks like a new person arriving.
 */
export function collabColorFor(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index++) hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  return `hsl(${hash % 360}, 65%, 55%)`;
}
