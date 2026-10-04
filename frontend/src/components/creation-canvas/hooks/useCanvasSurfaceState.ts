/** Which surface the board shows, and the per-viewer chrome preferences beside it — bar, prompt placement, phase. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeModelComparisonIds } from '@/lib/modelComparisonRequest';
import { canvasSurfaceDefinition, type CanvasSurfaceId, writeCanvasSurface } from '@/lib/canvasSurfaces';
import { readCanvasBarCollapsed, writeCanvasBarCollapsed } from '@/lib/canvasChrome';
import { type CanvasPromptPlacement, DEFAULT_CANVAS_PROMPT_PLACEMENT, readCanvasPromptPlacement, writeCanvasPromptPlacement } from '@/lib/canvasPromptPlacement';
import { type CanvasPhase, DEFAULT_CANVAS_PHASE, readCanvasPhase, surfacesForPhase, writeCanvasPhase } from '@/lib/canvasPhases';

export interface UseCanvasSurfaceStateDeps {
  initialModelComparisonIds: readonly string[];
  initialSurface: CanvasSurfaceId | undefined;
}

export function useCanvasSurfaceState({ initialModelComparisonIds, initialSurface }: UseCanvasSurfaceStateDeps) {
  /**
   * WHICH SURFACE this canvas is being read through — the board, the 3D space, or the
   * conversation. Every surface but the board replaces the flat view rather than
   * floating over it: two live views of the same objects would compete for the same
   * pointer, and the point of a surface is to read the work one way without distraction.
   *
   * ONE state, because it is one question. 3D used to keep its own boolean beside this
   * (`useCanvasThreeD`, which the three other spatial canvases still use), and a second
   * answer to "what am I looking at?" is a second control that can disagree with the
   * first. The rail and the phone stack both drive THIS, and `data-view` publishes it to
   * the stylesheet — see `lib/canvasSurfaces.ts`.
   *
   * A model comparison opens straight into the space: the whole point of running two
   * models side by side is to read the results in depth.
   */
  const comparisonModelIds = useMemo(() => normalizeModelComparisonIds(initialModelComparisonIds), [initialModelComparisonIds]);
  const [surface, setSurfaceState] = useState<CanvasSurfaceId>(comparisonModelIds.length >= 2 ? 'room' : initialSurface ?? 'graph');
  /**
   * The object an object-scoped surface is about. Null for every board surface, and
   * the reason a surface can be `page` at all: a page is a page OF something.
   */
  const [surfaceTarget, setSurfaceTarget] = useState<string | null>(null);
  const surfaceDef = canvasSurfaceDefinition(surface);
  /**
   * Whether the session bar is folded to what the canvas IS DOING.
   *
   * Read from storage in an effect rather than as the initial state, the way the surface
   * preference is: reading `localStorage` during render is a hydration mismatch, and the
   * bar arriving expanded for one frame is the safe direction to be wrong in.
   */
  const [barCollapsed, setBarCollapsedState] = useState(false);
  useEffect(() => { setBarCollapsedState(readCanvasBarCollapsed()); }, []);
  /**
   * Where the prompt lives — floating, docked into Brain, or closed. Read in an effect
   * for the same reason the folded bar is: reading storage during render is a hydration
   * mismatch, and a prompt that arrives floating for one frame is the safe direction.
   */
  const [promptPlacement, setPromptPlacementState] = useState<CanvasPromptPlacement>(DEFAULT_CANVAS_PROMPT_PLACEMENT);
  useEffect(() => { setPromptPlacementState(readCanvasPromptPlacement()); }, []);
  const setPromptPlacement = useCallback((next: CanvasPromptPlacement) => {
    setPromptPlacementState(next);
    writeCanvasPromptPlacement(next);
  }, []);
  const setBarCollapsed = useCallback((next: boolean) => {
    setBarCollapsedState(next);
    writeCanvasBarCollapsed(next);
  }, []);
  /**
   * Where an object surface's way back goes. Null — the board — for every entry except
   * one made FROM a surface that asked to be returned to: a creation opened from the
   * room goes back into the room rather than dropping the reader on the board.
   */
  const [surfaceOrigin, setSurfaceOrigin] = useState<CanvasSurfaceId | null>(null);
  const setSurface = useCallback((next: CanvasSurfaceId, targetId: string | null = null, origin: CanvasSurfaceId | null = null) => {
    setSurfaceState(next);
    // Only an object-scoped surface keeps a target (and an origin); the rail's switcher
    // never passes either.
    const objectScoped = canvasSurfaceDefinition(next).scope === 'object';
    setSurfaceTarget(objectScoped ? targetId : null);
    setSurfaceOrigin(objectScoped ? origin : null);
    // The registry decides what is worth remembering — a PLACE the user chose, never a
    // projection of the board they were already on, and never a surface that cannot be
    // restored without the object it was about.
    writeCanvasSurface(next);
  }, []);
  /** Leave an object surface: back to wherever it was opened from, else the board. */
  const exitSurface = useCallback(() => setSurface(surfaceOrigin ?? 'graph'), [setSurface, surfaceOrigin]);
  /**
   * Which stage of ITS OWN methodology this session is in — see `lib/canvasPhases.ts`
   * for why this is not `useFounderJourney()`. Same SSR-safe pattern as `surface`:
   * a safe default in the initial state, the real preference restored in a mount-only
   * effect below, because reading `localStorage` during render is a hydration mismatch.
   */
  const [phase, setPhaseState] = useState<CanvasPhase>(DEFAULT_CANVAS_PHASE);
  useEffect(() => { setPhaseState(readCanvasPhase()); }, []);
  const setPhase = useCallback((next: CanvasPhase) => {
    setPhaseState(next);
    writeCanvasPhase(next);
    // Additive narrowing (see `surfacesForPhase`), so this only ever RESETS the surface
    // when the one already open falls outside the new phase's offer — pressing Idea
    // while reading the app it built must not silently pull the reader back to the
    // board over a surface the new phase would still have shown them.
    if (!surfacesForPhase(next).includes(surface)) setSurface('graph');
  }, [surface, setSurface]);
  return { comparisonModelIds, setSurfaceState, surfaceTarget, surface, exitSurface, surfaceDef, setSurface, promptPlacement, setPromptPlacement, barCollapsed, phase, setPhase, setBarCollapsed };
}
