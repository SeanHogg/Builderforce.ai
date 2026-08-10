/**
 * `next/navigation` shim for the VS Code canvas bundle.
 *
 * A webview has no URL bar, no history stack and no router — but the canvas tree
 * contains components that call `useRouter()` / `usePathname()` on the web. Rather
 * than fork those components, this shim gives them a router whose navigations are
 * handed to the extension host, which owns what "go to /create/abc" means in an
 * editor (reveal that Canvas panel) versus a browser (change the URL).
 *
 * Routing goes through `canvasNavigate` from the shared host port, so the panel
 * decision lives in ONE place (`canvas/hostActions.ts`) and is not re-implemented
 * per hook here.
 */

import { canvasNavigate } from '@/lib/canvasHost';

/**
 * Next's router takes an options bag (`{ scroll }`) on push/replace and real
 * call sites pass it — `ProjectScopeContext` calls
 * `router.replace(url, { scroll: false })`. Accepting it keeps the shim
 * signature-compatible; there is nothing to scroll in a webview, so it is
 * ignored rather than reinterpreted.
 */
export interface NavigateOptions {
  scroll?: boolean;
}

export interface ShimRouter {
  push(path: string, options?: NavigateOptions): void;
  replace(path: string, options?: NavigateOptions): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(path: string): void;
}

const router: ShimRouter = {
  push: (path) => canvasNavigate(path),
  // A webview has no history entry to replace — the host decides what to reveal,
  // and reopening the same panel is idempotent, so replace and push coincide.
  replace: (path) => canvasNavigate(path),
  // There is no in-webview history to walk. VS Code's own editor navigation
  // (Ctrl+Alt+-) already moves between panels, so these are deliberate no-ops
  // rather than a second, competing history model.
  back: () => {},
  forward: () => {},
  refresh: () => {},
  prefetch: () => {},
};

export function useRouter(): ShimRouter {
  return router;
}

/** The canvas is the whole surface in this webview, so the path is fixed. */
export function usePathname(): string {
  return '/create';
}

/** No query string exists here; an empty set keeps `get()` callers returning null. */
export function useSearchParams(): URLSearchParams {
  return EMPTY_PARAMS;
}

const EMPTY_PARAMS = new URLSearchParams();

/** Present for import compatibility; a webview never renders a route segment. */
export function useParams(): Record<string, string> {
  return {};
}

export function redirect(path: string): never {
  canvasNavigate(path);
  throw new Error(`redirect(${path})`);
}

export function notFound(): never {
  throw new Error('notFound()');
}
