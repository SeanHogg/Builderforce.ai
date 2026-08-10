'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Canvas3DDepthMode } from './canvas3d';

/**
 * The view commands a 3D scene hands to the canvas chrome that is already there.
 *
 * The scene carries no toolbar of its own: a second header floating over a board
 * that already has a command rail is two places to look for one canvas, and it
 * lands on top of whatever the board keeps at that edge. So the scene publishes
 * what it can do here and the rail renders it, which means entering 3D ADDS
 * commands to the bar the user already knows instead of replacing it.
 */
export interface Canvas3DControls {
  depthMode: Canvas3DDepthMode;
  /** Restack the space on the next depth axis (dependency flow ⇄ object group). */
  toggleDepth: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  /**
   * Travel to the given objects. The canvas has one "focus the selection" action
   * whichever way it is being read; this is what that action means in here.
   */
  focusObjects: (ids: readonly string[]) => void;
  /**
   * Whether the layer guides are drawn. They are a reading aid over a space the
   * user arranges freely, so they can be put away without changing where a
   * single object sits.
   */
  layersVisible: boolean;
  toggleLayers: () => void;
  /**
   * Settle every object back onto the layer its dependencies put it on. Present
   * only while something is actually floating, so the rail never offers a tidy-up
   * with nothing to tidy.
   */
  dropToLayers?: (() => void) | undefined;
}

type Canvas3DControlsStore = {
  controls: Canvas3DControls | null;
  publish: (controls: Canvas3DControls | null) => void;
};

const Canvas3DControlsContext = createContext<Canvas3DControlsStore | null>(null);

/**
 * Wrap the part of a canvas that holds BOTH its command rail and its 3D scene.
 * Without it the scene still renders — it simply has nowhere to publish its
 * commands, and the rail shows only the flat-board ones.
 */
export function Canvas3DControlsProvider({ children }: { children: ReactNode }) {
  const [controls, publish] = useState<Canvas3DControls | null>(null);
  const value = useMemo<Canvas3DControlsStore>(() => ({ controls, publish }), [controls]);
  return <Canvas3DControlsContext.Provider value={value}>{children}</Canvas3DControlsContext.Provider>;
}

/** The live 3D commands, or `null` while this canvas is being read flat. */
export function useCanvas3DControls(): Canvas3DControls | null {
  return useContext(Canvas3DControlsContext)?.controls ?? null;
}

/** Whether a canvas is being read in 3D, and how it says so to its own chrome. */
export interface CanvasThreeDState {
  active: boolean;
  toggle: () => void;
  exit: () => void;
  /**
   * Spread onto `<CanvasCommands>`. The rail shows the 3D control only when a
   * canvas hands it one, so this is also what makes the button appear — a canvas
   * opts in by calling the hook, not by repeating the same two props.
   */
  commandProps: { threeDActive: boolean; onToggleThreeD: () => void };
}

/**
 * The flat-or-3D state every spatial canvas keeps.
 *
 * Five canvases each held their own `threeD` boolean, their own toggle, and their
 * own pair of props for the rail; the state is identical in all of them, so it
 * lives here once. A canvas still owns what its objects LOOK like in the space
 * (its `describe` adapter) — only the switching is shared.
 */
export function useCanvasThreeD(initialActive = false): CanvasThreeDState {
  const [active, setActive] = useState(initialActive);
  const toggle = useCallback(() => setActive((current) => !current), []);
  const exit = useCallback(() => setActive(false), []);
  return useMemo(
    () => ({ active, toggle, exit, commandProps: { threeDActive: active, onToggleThreeD: toggle } }),
    [active, exit, toggle],
  );
}

/** Publishes a scene's commands for as long as that scene is on screen. */
export function usePublishCanvas3DControls(controls: Canvas3DControls) {
  const publish = useContext(Canvas3DControlsContext)?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(controls);
    return () => publish(null);
  }, [controls, publish]);
}
