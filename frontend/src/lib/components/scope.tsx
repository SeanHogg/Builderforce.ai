import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { readLocationProject, resolveProjectId } from '@/lib/projectScopeResolution';

/**
 * THE PROJECT A MOUNTED COMPONENT IS SCOPED TO — the React face of
 * {@link resolveProjectId}, which owns the order.
 *
 * A component that can render on a dashboard, on a board, in the editor and inside
 * somebody's published app asks THIS, never a mount-specific hook. That is what makes
 * it droppable into a second surface with zero edits. This hook only collects the
 * sources the surface has:
 *
 *   - pinned   — a {@link ComponentScopeProvider} above it (a board card's own link).
 *   - selected — the ambient {@link ProjectScopeProvider}, which has already folded
 *                in the host's selection, the URL deep-link and the persisted pick.
 *   - location — the URL deep-link, read here ONLY where no ambient provider exists
 *                (a framed `/embed/*` page). Under a provider the URL is already
 *                folded in and is rewritten on every pick, so reading it a second
 *                time would let a stale link outrank a fresh choice.
 *
 * Null means portfolio. Tenancy is never resolved here.
 */

const ComponentScopeContext = createContext<number | null | undefined>(undefined);

/**
 * Pin the components below to one project, overriding anything ambient.
 *
 * `projectId` of `null` is meaningful — it pins to the portfolio view — which is
 * why the context's "nothing here" value is `undefined` and not `null`.
 */
export function ComponentScopeProvider({ projectId, children }: { projectId: number | null; children: ReactNode }) {
  return <ComponentScopeContext.Provider value={projectId}>{children}</ComponentScopeContext.Provider>;
}

/** The project the surrounding component should read, or null for the portfolio. */
export function useComponentProjectId(): number | null {
  const pinned = useContext(ComponentScopeContext);
  const ambient = useOptionalProjectScope();
  const location = useLocationProjectId(ambient == null);
  return resolveProjectId({
    pinned,
    selected: ambient?.currentProjectId,
    location: ambient ? undefined : location,
  });
}

/**
 * The URL's deep-linked project, kept live. The hash is not part of the server
 * render, so it is read after mount, and again whenever the host rewrites it.
 */
function useLocationProjectId(enabled: boolean): number | null {
  const [projectId, setProjectId] = useState<number | null>(() => (enabled ? readLocationProject() : null));
  useEffect(() => {
    if (!enabled) return;
    const sync = () => setProjectId(readLocationProject());
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [enabled]);
  return enabled ? projectId : null;
}
