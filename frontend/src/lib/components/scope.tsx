'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { useEmbedProjectId } from '@/lib/embed/useEmbedProjectId';

/**
 * THE PROJECT A MOUNTED COMPONENT IS SCOPED TO — resolved once, for every mount.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * A component that can render on a dashboard, on a board and inside somebody's
 * published app has to answer "which project?" in three different worlds, and
 * before this there were three different answers hard-coded at three call sites:
 * the app shell's `ProjectScopeContext`, the embed route's `useEmbedProjectId()`
 * deep-link, and — on a board — nothing at all. A component that reached for any
 * one of them directly could only ever render where that one existed, which is
 * precisely why the surfaces behind `/embed/*` were unusable anywhere else.
 *
 * So the resolution order lives here, once, and every component asks the same
 * question regardless of where it was mounted:
 *
 *   1. An explicit {@link ComponentScopeProvider} above it. The mount KNOWS —
 *      a board card carries its own project link, and that must win over
 *      anything ambient.
 *   2. The embed deep-link (`?project=` / `#projectId=`). Present only when a
 *      host framed us and named a project.
 *   3. The app shell's global project scope. Null outside the shell rather than
 *      throwing, which is what lets the same component render on a public
 *      published page.
 *
 * Null means portfolio — every project the tenant owns — and that is a real
 * answer, not a missing one. Tenancy is NEVER resolved here: it comes from the
 * caller's token on every request, so a component cannot widen its own scope by
 * being mounted somewhere new.
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

/**
 * The project the surrounding component should read, or null for the portfolio.
 *
 * Every mountable component calls THIS rather than a mount-specific hook. Doing
 * so is what makes it droppable into a second surface with zero edits.
 */
export function useComponentProjectId(): number | null {
  const explicit = useContext(ComponentScopeContext);
  const fromEmbed = useEmbedProjectId();
  const shell = useOptionalProjectScope();
  if (explicit !== undefined) return explicit;
  return fromEmbed ?? shell?.currentProjectId ?? null;
}
