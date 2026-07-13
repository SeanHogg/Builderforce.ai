'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

/**
 * PM visualizer scope — project view vs segment-wide portfolio.
 *
 * Single source of truth for "which project (if any) are we looking at" across
 * every PM visualizer, so no component prop-drills a project id or a
 * `isPortfolio` boolean (each reads it from context). Defaults to the global
 * {@link useProjectScope} (the TopBar tenant→project selector); the embed
 * surfaces pass an explicit `projectId` since they live outside the app shell
 * and have no global provider.
 */
export interface PmScope {
  /** The project this view is scoped to, or null for the segment-wide portfolio. */
  projectId: number | null;
  /** True when no project is selected (portfolio rollup across the segment). */
  isPortfolio: boolean;
}

const PmScopeContext = createContext<PmScope | null>(null);

export function PmScopeProvider({
  children,
  projectId,
}: {
  children: ReactNode;
  /** Explicit override; when omitted the scope follows the global project scope. */
  projectId?: number | null;
}) {
  const global = useOptionalProjectScope();
  const resolved = projectId !== undefined ? projectId : (global?.currentProjectId ?? null);
  return (
    <PmScopeContext.Provider value={{ projectId: resolved, isPortfolio: resolved == null }}>
      {children}
    </PmScopeContext.Provider>
  );
}

export function usePmScope(): PmScope {
  const ctx = useContext(PmScopeContext);
  if (!ctx) throw new Error('usePmScope must be used within a PmScopeProvider');
  return ctx;
}
