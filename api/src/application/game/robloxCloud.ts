/**
 * Roblox Open Cloud — publishing a generated place into a real experience.
 *
 * Open Cloud can REPLACE the contents of an existing place; it cannot create an
 * experience. That asymmetry is the whole shape of this module and the reason the
 * setup steps read the way they do: the universe and the place must already exist
 * (made once, by hand, in Studio), after which every regeneration is a one-call
 * publish and the game updates for everyone already playing it.
 *
 * Pretending otherwise would be the expensive failure here — an "auto-publish"
 * that silently needed a place someone had not made yet would fail with a 404
 * that says nothing about what to do.
 *
 * The API key is a project secret, read server-side only and never returned. It
 * is sent as `x-api-key`, which is Open Cloud's scheme; it is NOT a bearer token
 * and must not be logged.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';

const OPEN_CLOUD_ORIGIN = 'https://apis.roblox.com';

/** The secrets the Roblox publish path needs, in the shared setup-step shape. */
export const ROBLOX_SECRETS = [
  {
    name: 'ROBLOX_API_KEY',
    label: 'Add your Roblox Open Cloud API key (ROBLOX_API_KEY)',
    detail:
      'Create a key in the Roblox Creator Dashboard with the "Place Management" API system, the '
      + 'write permission, and this experience added to it. Keys are scoped to the experiences you '
      + 'list on them, so a key that omits yours returns 403 rather than a useful message.',
    url: 'https://create.roblox.com/dashboard/credentials',
  },
] as const;

export interface RobloxPublishTarget {
  universeId: string;
  placeId: string;
}

export type RobloxPublishResult =
  | { ok: true; versionNumber: number; placeUrl: string }
  | { ok: false; status: number; error: string };

/** Both ids are numeric strings; a non-numeric one is a copy-paste of a URL. */
export function readPublishTarget(universeId: unknown, placeId: unknown): RobloxPublishTarget | null {
  const universe = String(universeId ?? '').trim();
  const place = String(placeId ?? '').trim();
  if (!/^\d{1,20}$/.test(universe) || !/^\d{1,20}$/.test(place)) return null;
  return { universeId: universe, placeId: place };
}

/**
 * Replace the published contents of a place with `rbxlx`.
 *
 * `versionType=Published` makes the new version live immediately, which is what
 * "publish my game" means; `Saved` would upload a version nobody can play and
 * look like a silent no-op.
 */
export async function publishRobloxPlace(
  apiKey: string,
  target: RobloxPublishTarget,
  rbxlx: string,
): Promise<RobloxPublishResult> {
  const url =
    `${OPEN_CLOUD_ORIGIN}/universes/v1/${target.universeId}`
    + `/places/${target.placeId}/versions?versionType=Published`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/xml' },
      body: rbxlx,
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/game/robloxCloud.ts', operation: 'publishRobloxPlace' });
    return { ok: false, status: 502, error: 'Could not reach Roblox Open Cloud.' };
  }

  if (!response.ok) {
    // The body may carry a useful message and may equally be HTML. It is read
    // defensively and truncated, and NEVER echoed with the key anywhere near it.
    const body = await response.text().catch(() => '');
    return { ok: false, status: response.status, error: describeFailure(response.status, body) };
  }

  const payload = (await response.json().catch(() => null)) as { versionNumber?: number } | null;
  return {
    ok: true,
    versionNumber: Number(payload?.versionNumber ?? 0),
    placeUrl: `https://www.roblox.com/games/${target.placeId}`,
  };
}

/**
 * Turn an Open Cloud status into something a person can act on.
 *
 * Every one of these is a distinct, common misconfiguration that presents
 * identically ("it didn't publish"), and the raw response distinguishes them
 * poorly — 403 in particular is returned both for a key that lacks the
 * permission and for a key that simply does not list this experience.
 */
function describeFailure(status: number, body: string): string {
  const detail = body.slice(0, 300).replace(/\s+/g, ' ').trim();
  if (status === 401) {
    return 'Roblox rejected the API key. Check that ROBLOX_API_KEY is the key itself, not its name or id.';
  }
  if (status === 403) {
    return 'The API key is not authorised for this experience. In the Creator Dashboard, add this experience '
      + 'to the key and give it the Place Management "write" permission.';
  }
  if (status === 404) {
    return 'Roblox has no such universe or place. Both ids come from an experience that already exists — '
      + 'create it once in Studio (File → Publish to Roblox), then copy the ids from its dashboard URL.';
  }
  if (status === 429) {
    return 'Roblox is rate-limiting publishes for this key. Wait a minute and publish again.';
  }
  return `Roblox Open Cloud returned ${status}.${detail ? ` ${detail}` : ''}`;
}
