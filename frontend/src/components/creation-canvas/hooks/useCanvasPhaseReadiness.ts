/**
 * The board's phase readiness, derived from its nodes.
 *
 * `lib/canvasPhaseReadiness.ts` is pure and one O(n) pass over the board — a filter, a
 * kind check and a metric-definition read per card, no network — so this memoises on
 * the node array and nothing cleverer. A drag does produce a new array, and the pass is
 * still well under a frame for any board the canvas can draw; a hand-rolled identity key
 * to skip it would be more code than the work it saves. No `getOrSetCached`: nothing here
 * touches the network, and the input is already in memory.
 */
import { useMemo } from 'react';
import type { CanvasPhase } from '@/lib/canvasPhases';
import {
  frontierPhase,
  readinessByPhase,
  readinessSignals,
  type CanvasPhaseReadiness,
  type ReadinessNode,
  type ReadinessSignals,
} from '@/lib/canvasPhaseReadiness';

export interface CanvasPhaseReadinessState {
  signals: ReadinessSignals;
  byPhase: Readonly<Record<CanvasPhase, CanvasPhaseReadiness>>;
  frontier: CanvasPhase;
}

export function useCanvasPhaseReadiness(nodes: readonly ReadinessNode[]): CanvasPhaseReadinessState {
  const signals = useMemo(() => readinessSignals(nodes), [nodes]);
  // Keyed on the four booleans, so a drag that leaves them unchanged hands every reader
  // the SAME readiness object and nothing downstream re-renders for it.
  const { hasIdea, hasApp, isLive, hasMetric } = signals;
  return useMemo(() => {
    const stable = { hasIdea, hasApp, isLive, hasMetric };
    return { signals: stable, byPhase: readinessByPhase(stable), frontier: frontierPhase(stable) };
  }, [hasIdea, hasApp, isLive, hasMetric]);
}
