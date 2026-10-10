import { useComponentProjectId } from '@/lib/components/scope';

/**
 * PM visualizer scope — project view vs segment-wide portfolio.
 *
 * Not a context of its own: the project comes from {@link useComponentProjectId},
 * the one resolution every mountable component uses, so a PM widget scopes the same
 * way on the projects page, a board, an embed and the editor, and never throws for
 * want of a provider. A mount that knows its project pins it with
 * `ComponentScopeProvider`.
 */
export interface PmScope {
  /** The project this view is scoped to, or null for the segment-wide portfolio. */
  projectId: number | null;
  /** True when no project is selected (portfolio rollup across the segment). */
  isPortfolio: boolean;
}

export function usePmScope(): PmScope {
  const projectId = useComponentProjectId();
  return { projectId, isPortfolio: projectId == null };
}
