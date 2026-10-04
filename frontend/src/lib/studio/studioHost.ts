/**
 * The Studio app's addressing: `studio.builderforce.ai` serves the standalone IDE
 * from this same Next app, under the `/studio` route. The host itself is a row in
 * `lib/productHosts.ts`, which owns why its root redirects rather than rewrites.
 *
 * Import-free on purpose: the middleware ships in the Worker bundle.
 */

/** The route the Studio app lives under. */
export const STUDIO_ROUTE = '/studio';

/** The Studio IDE page for a project. */
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
