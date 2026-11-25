/**
 * The Studio app's addressing: `studio.builderforce.ai` serves the standalone IDE
 * from this same Next app, under the `/studio` route. The host itself is a row in
 * `lib/productHosts.ts`, which owns why its root redirects rather than rewrites.
 *
 * Import-free on purpose: the middleware ships in the Worker bundle.
 */

/** The route the Studio app lives under. */
export const STUDIO_ROUTE = '/studio';

/**
 * A creation session presented through the Studio lens — the SAME board as
 * `/create/<sessionId>` (same id, same mounted canvas), drawn as prompt + preview.
 * See `lib/canvasLens.ts`. Works for a guest's `local-<uuid>` and a server id alike.
 */
export function studioSessionPath(sessionId: string): string {
  return `${STUDIO_ROUTE}/${encodeURIComponent(sessionId)}`;
}

/**
 * The static page that opens a board HELD ON THIS DEVICE with no server page behind it
 * (`?board=<id>`): the service worker precaches it and redirects an offline `/studio/<id>`
 * to it (`public/sw.js` keeps its own copy of this route and of {@link isDeviceBoardId}).
 */
export const DEVICE_BOARD_ROUTE = `${STUDIO_ROUTE}/local`;
export const DEVICE_BOARD_PARAM = 'board';

const DEVICE_BOARD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A board id the device shell may open: a plain UUID (a legacy `local-<uuid>` is re-keyed first). */
export function isDeviceBoardId(value: string | null | undefined): value is string {
  return typeof value === 'string' && DEVICE_BOARD_ID_RE.test(value);
}

/** The board opened from the device shell (`/studio/local?board=<id>`). */
export function deviceBoardPath(sessionId: string): string {
  return `${DEVICE_BOARD_ROUTE}?${DEVICE_BOARD_PARAM}=${encodeURIComponent(sessionId)}`;
}

/**
 * Where a link to a board should go: its server page while online, the device shell while
 * offline (a fresh `/studio/<id>` URL has no cached page, the shell always does). The ONE
 * rule for every "open this board" link.
 */
export function studioBoardHref(sessionId: string, online: boolean): string {
  return online || !isDeviceBoardId(sessionId) ? studioSessionPath(sessionId) : deviceBoardPath(sessionId);
}

/** True unless the browser says it is offline (server rendering and unknown count as online). */
export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** The Studio IDE page for a durable project (legacy links and project-chat deep links). */
export function studioProjectPath(projectId: number | string): string {
  return `${STUDIO_ROUTE}/project/${projectId}`;
}

/**
 * The same project as an app on its canvas: the App surface on the board that holds
 * it (`BuildCanvasRedirect` resolves the board). The other half of
 * {@link studioProjectPath}, so a person can go back and forth between the two.
 */
export function canvasAppPath(projectRef: number | string, query?: string): string {
  return `/create/build/${projectRef}${query ? `?${query}` : ''}`;
}
