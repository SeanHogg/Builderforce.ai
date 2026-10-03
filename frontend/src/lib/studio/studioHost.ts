/**
 * The Studio app's addressing: `studio.builderforce.ai` serves the standalone IDE
 * from this same Next app, under the `/studio` route.
 *
 * The studio host REDIRECTS its root to `/studio` rather than rewriting it. A
 * rewrite would leave the browser on `/`, and every path-based rule in the app
 * (the shell's chrome decision, the floating Brain, route marketing) reads the
 * browser path, so each would mistake Studio for the marketing home page. With a
 * redirect the path is the truth everywhere, and `/studio` works the same on the
 * apex and on localhost.
 *
 * Import-free on purpose: the middleware ships in the Worker bundle.
 */

/** The route the Studio app lives under. */
export const STUDIO_ROUTE = '/studio';

export function isStudioHost(hostname: string): boolean {
  return hostname.startsWith('studio.');
}

/** Where a studio-host request for `pathname` should go instead, or null to serve it as is. */
export function studioHostRedirect(pathname: string): string | null {
  return pathname === '/' ? STUDIO_ROUTE : null;
}

/** The Studio IDE page for a project. */
export function studioProjectPath(projectId: number | string): string {
  return `${STUDIO_ROUTE}/project/${projectId}`;
}
