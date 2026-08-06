'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  /** Move to the next depth axis (dependency flow ⇄ object group). */
  toggleDepth: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
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

/** Publishes a scene's commands for as long as that scene is on screen. */
export function usePublishCanvas3DControls(controls: Canvas3DControls) {
  const publish = useContext(Canvas3DControlsContext)?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(controls);
    return () => publish(null);
  }, [controls, publish]);
}
