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
 *
 * The phase floor waits for the board AS LOADED. Before that, `phase` is the frontier of
 * the starter seed — Idea for every board — and lifting THAT to the floor would remember
 * Make on a board whose own loaded frontier is Run or Measure, pinning it below where it
 * actually is, on every lens, for good.
 */
import { useEffect, useMemo } from 'react';
import { useEffectEvent } from '@/hooks/useEffectEvent';
import { canvasLensDefinition, canvasLensHome, canvasLensSessionPath, type CanvasLens, type CanvasLensDef } from '@/lib/canvasLens';
import { CANVAS_PHASES, type CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { BrainDockPreferences } from '../brainDockPreferences';

export interface UseCanvasLensDeps {
  lens: CanvasLens;
  sessionId: string;
  surface: CanvasSurfaceId;
  /** Shows a surface WITHOUT persisting it as the person's preferred surface. */
  showSurface: (surface: CanvasSurfaceId) => void;
  phase: CanvasPhase;
  setPhase: (phase: CanvasPhase) => void;
  /** The board as loaded is on screen (`useCanvasSession`) — the phase floor waits for it. */
  boardLoaded: boolean;
  updateBrainDock: (patch: Partial<BrainDockPreferences>, persist?: boolean) => void;
  /** A phone never has the dock forced open over its board (the canvas's own rule). */
  phoneViewport: boolean;
}

export interface CanvasLensState {
  def: CanvasLensDef;
  /** The URL this board is being read at — where a sign-up or an OAuth round trip returns to. */
  boardPath: string;
  /** Back to the lens's home surface, while the reader is somewhere else; null otherwise. */
  returnHome: (() => void) | null;
  /** The surface the lens keeps the reader on, or null (`canvasLensHome`). */
  home: CanvasSurfaceId | null;
}

/** True when `phase` comes before `floor` in the methodology's order. */
export function phaseBefore(phase: CanvasPhase, floor: CanvasPhase): boolean {
  return CANVAS_PHASES.indexOf(phase) < CANVAS_PHASES.indexOf(floor);
}

export function useCanvasLens({ lens, sessionId, surface, showSurface, phase, setPhase, boardLoaded, updateBrainDock, phoneViewport }: UseCanvasLensDeps): CanvasLensState {
  const def = canvasLensDefinition(lens);
  // An effect EVENT: the effect is keyed on the lens alone, and reads today's surface and
  // viewport when it runs — re-applying on every surface change would pin the person to
  // the lens's surface and take away every other one.
  const enterLens = useEffectEvent((entered: CanvasLensDef) => {
    if (entered.surface && surface !== entered.surface) showSurface(entered.surface);
    if (entered.brainDock && !phoneViewport) updateBrainDock({ mode: 'docked', side: entered.brainDock.side, open: true }, false);
  });
  useEffect(() => {
    enterLens(canvasLensDefinition(lens));
  }, [lens]);

  // The phase floor, once the loaded board's own phase is known (see the file note).
  const liftPhase = useEffectEvent((entered: CanvasLensDef) => {
    if (entered.phaseFloor && phaseBefore(phase, entered.phaseFloor)) setPhase(entered.phaseFloor);
  });
  useEffect(() => {
    if (boardLoaded) liftPhase(canvasLensDefinition(lens));
  }, [boardLoaded, lens]);

  const home = canvasLensHome(def);
  const away = home !== null && surface !== home;
  return useMemo(() => ({
    def,
    boardPath: canvasLensSessionPath(def.id, sessionId),
    returnHome: away && home ? () => showSurface(home) : null,
    home,
  }), [away, def, home, sessionId, showSurface]);
}
