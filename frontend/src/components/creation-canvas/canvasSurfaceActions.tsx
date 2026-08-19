// No 'use client' directive, for the reason `CanvasAppSurface.tsx`,
// `CanvasCommandBar.tsx` and `CanvasSessionActions.tsx` each state at the top of
// themselves: every importer sits inside the `CreationCanvas` client boundary
// already, so the directive marks nothing that has not already begun.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The seam that lets a SURFACE put its own controls in the ONE session bar.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────────
 * `canvasSessionActions.ts` answers "what can I do to this canvas" for the actions the
 * HOST owns — undo, share, publish, full screen. It cannot answer it for the ones a
 * surface owns, because Run/Stop, Preview·Code·Console and the preview width are the app
 * runtime's own state and nothing above it has any business holding them.
 *
 * The consequence, before this existed, was a SECOND toolbar: `CanvasAppSurface` drew its
 * own bar directly under the session bar, so the canvas had two rows of controls that
 * looked alike, sat 40px apart, and disagreed about which one you press to do something.
 * A third surface with a runtime would have made three.
 *
 * ── WHY A PORTAL-BY-STATE AND NOT A REACT PORTAL ─────────────────────────────────
 * A real `createPortal` would need a DOM node that exists before the surface renders, and
 * the session bar is drawn by the host in the same commit — so the first paint would be
 * a bar with a hole in it. Publishing a ReactNode into context instead means the host
 * renders it in its own tree, in its own place, with its own layout rules, and the surface
 * only says WHAT. The host never learns what an app surface is; the surface never learns
 * where the bar is.
 *
 * ── WHY THE SURFACE CLEARS ITS OWN CONTRIBUTION ──────────────────────────────────
 * On unmount, unconditionally. A surface that left its Run button in the bar after being
 * closed would give the board a control wired to a runtime that is gone, which is the one
 * failure mode a shared bar has that two separate bars do not.
 */

/**
 * A surface's contribution, split the way the bar splits.
 *
 * Not one node: a runtime contributes BOTH kinds. An app surface's Run/Stop and its
 * three readings are controls; the address it is running at is what the bar REPORTS, and
 * `canvasChrome.ts` says status survives a collapse while controls do not. Publishing one
 * opaque node would force the bar to guess, and it would guess the same way for both.
 */
export interface CanvasSurfaceContribution {
  /** Pressable things — hidden when the bar is folded away. */
  controls?: ReactNode;
  /** What the runtime is doing — survives a collapse, because that is the point. */
  status?: ReactNode;
}

export interface CanvasSurfaceActionsValue {
  /** What the active surface has contributed. Both halves are null until one does. */
  contribution: CanvasSurfaceContribution;
  /** Publish this surface's contribution. Pass an empty object to withdraw it. */
  publish: (contribution: CanvasSurfaceContribution) => void;
}

const EMPTY: CanvasSurfaceContribution = {};

const CanvasSurfaceActionsContext = createContext<CanvasSurfaceActionsValue | null>(null);

export function CanvasSurfaceActionsProvider({ children }: { children: ReactNode }) {
  const [contribution, setContribution] = useState<CanvasSurfaceContribution>(EMPTY);
  // Wrapped so a surface publishing on every render cannot make the host re-render on
  // every render: the setter identity is stable and the value only changes when the
  // contribution does.
  const publish = useCallback((next: CanvasSurfaceContribution) => setContribution(next), []);
  const value = useMemo(() => ({ contribution, publish }), [contribution, publish]);
  return <CanvasSurfaceActionsContext.Provider value={value}>{children}</CanvasSurfaceActionsContext.Provider>;
}

/**
 * Contribute this surface's controls to the session bar for as long as it is mounted.
 *
 * Deliberately a hook rather than a `<SurfaceActions>` component: the controls close over
 * the surface's own state, so they have to be re-published when that state changes, and a
 * component whose children are re-created every render would do the same work with a
 * lifecycle the caller has to reason about. `deps` is what the caller already knows.
 */
export function useCanvasSurfaceActions(build: () => CanvasSurfaceContribution, deps: readonly unknown[]): void {
  const context = useContext(CanvasSurfaceActionsContext);
  const publish = context?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(build());
    return () => publish(EMPTY);
    // The caller owns the dependency list; `build` is re-created every render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, ...deps]);
}

/**
 * What the active surface has contributed. Both halves are null outside a provider and
 * when no surface has contributed anything — so the host writes each half unconditionally
 * rather than asking which surface is on screen.
 */
export function useContributedSurfaceActions(): CanvasSurfaceContribution {
  return useContext(CanvasSurfaceActionsContext)?.contribution ?? EMPTY;
}
