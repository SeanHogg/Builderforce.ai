'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * PM visualizer scope — project view vs segment-wide portfolio.
 *
 * Single source of truth for "which project (if any) are we looking at" across
 * every PM visualizer, so no component prop-drills a project id or a
 * `isPortfolio` boolean (each reads it from context). Mirrors the Projects page
 * convention of deriving scope from the `?project=<id>` URL param.
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
  /** Explicit override; when omitted the scope is read from `?project=<id>`. */
  projectId?: number | null;
}) {
  const searchParams = useSearchParams();
  const fromUrl = Number(searchParams.get('project'));
  const resolved =
    projectId != null ? projectId : Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : null;
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
