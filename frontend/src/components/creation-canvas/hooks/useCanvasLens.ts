/**
 * Entering a LENS — the presentation the board is seen through (`lib/canvasLens.ts`).
 *
 * No 'use client' directive: a hook, imported only from inside the `CreationCanvas`
 * client boundary.
 *
 * The lens is LIVE, not mount-only: `/create/<id>` and `/studio/<id>` are the same
 * mounted board, so going from one to the other changes this prop on an instance that is
 * already on screen — and entering a lens has to apply then, exactly as on arrival.
 *
 * What a lens applies is a PRESENTATION, not a choice the person made, so none of it is
 * written to their stored preferences: the surface is shown without becoming the surface
 * every other board opens on, and the Brain dock is opened without rewriting where they
 * keep it. The phase is the exception the canvas already makes for itself — a phase is
 * remembered per BOARD, and a lens that needs the App surface needs Make offered on it.
 */
import { useEffect } from 'react';
import { useEffectEvent } from '@/hooks/useEffectEvent';
import { canvasLensDefinition, type CanvasLens, type CanvasLensDef } from '@/lib/canvasLens';
import { CANVAS_PHASES, type CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { BrainDockPreferences } from '../brainDockPreferences';

export interface UseCanvasLensDeps {
  lens: CanvasLens;
  surface: CanvasSurfaceId;
  /** Shows a surface WITHOUT persisting it as the person's preferred surface. */
  showSurface: (surface: CanvasSurfaceId) => void;
  phase: CanvasPhase;
  setPhase: (phase: CanvasPhase) => void;
  updateBrainDock: (patch: Partial<BrainDockPreferences>, persist?: boolean) => void;
  /** A phone never has the dock forced open over its board (the canvas's own rule). */
  phoneViewport: boolean;
}

/** True when `phase` comes before `floor` in the methodology's order. */
export function phaseBefore(phase: CanvasPhase, floor: CanvasPhase): boolean {
  return CANVAS_PHASES.indexOf(phase) < CANVAS_PHASES.indexOf(floor);
}

export function useCanvasLens({ lens, surface, showSurface, phase, setPhase, updateBrainDock, phoneViewport }: UseCanvasLensDeps): CanvasLensDef {
  const def = canvasLensDefinition(lens);
  // An effect EVENT: the effect is keyed on the lens alone, and reads today's surface,
  // phase and viewport when it runs — re-applying on every surface change would pin the
  // person to the lens's surface and take away every other one.
  const enterLens = useEffectEvent((entered: CanvasLensDef) => {
    // Phase first: `setPhase` returns to the board when the open surface falls outside the
    // new phase, and the lens's surface must land after that, not be undone by it.
    if (entered.phaseFloor && phaseBefore(phase, entered.phaseFloor)) setPhase(entered.phaseFloor);
    if (entered.surface && surface !== entered.surface) showSurface(entered.surface);
    if (entered.brainDock && !phoneViewport) updateBrainDock({ mode: 'docked', side: entered.brainDock.side, open: true }, false);
  });
  useEffect(() => {
    enterLens(canvasLensDefinition(lens));
  }, [lens]);
  return def;
}
