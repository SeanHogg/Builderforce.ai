/**
 * Routes that already own a spatial/full-screen execution surface. Wrapping one
 * canvas in another makes navigation and zoom gestures ambiguous, so these are
 * considered native while every other authenticated application route is
 * rendered as a movable canvas artifact by the app shell.
 */
const NATIVE_CANVAS_ROUTES = [
  '/dashboard',
  '/projects',
  '/insights',
  '/insights/ai',
  '/brainstorm',
  '/workflows/builder',
] as const;
const NATIVE_CANVAS_PREFIXES = ['/create'] as const;

export function isNativeCanvasRoute(pathname: string): boolean {
  return NATIVE_CANVAS_ROUTES.includes(pathname as typeof NATIVE_CANVAS_ROUTES[number])
    || NATIVE_CANVAS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function shouldRenderRouteAsCanvasArtifact(pathname: string): boolean {
  return pathname.startsWith('/') && !isNativeCanvasRoute(pathname);
}
