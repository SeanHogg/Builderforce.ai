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
