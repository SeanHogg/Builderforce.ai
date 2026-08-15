'use client';

import { createContext, useContext } from 'react';
import {
  canvasSurfaceDefinition,
  DEFAULT_CANVAS_SURFACE,
  type CanvasSurfaceDef,
  type CanvasSurfaceId,
} from '@/lib/canvasSurfaces';

/**
 * Which surface the canvas is currently reading itself through, published to the chrome
 * that has to answer questions ABOUT it.
 *
 * The Brain surface's controls are the reason this exists. One of them offers to move
 * the conversation into the Brain Object on the graph — an offer that hides the chat and
 * gives back nothing when the graph is not the surface being drawn. That was previously
 * inferred from `useCanvas3DControls() != null`: true when a 3D scene happened to be
 * publishing commands, which answered "is the 3D scene up?" and was only ACCIDENTALLY
 * the same answer as "is there a board to move into?". The moment a second boardless
 * surface existed the proxy broke, so the real question is published instead.
 *
 * Defaults to the board, so an isolated node render (a test, an export, a preview) keeps
 * the behaviour it has always had without every such call site mounting a provider.
 */
const CanvasSurfaceContext = createContext<CanvasSurfaceId>(DEFAULT_CANVAS_SURFACE);

export const CanvasSurfaceProvider = CanvasSurfaceContext.Provider;

export function useCanvasSurface(): CanvasSurfaceId {
  return useContext(CanvasSurfaceContext);
}

/** The active surface's rules — what chrome reads instead of comparing ids. */
export function useCanvasSurfaceDefinition(): CanvasSurfaceDef {
  return canvasSurfaceDefinition(useContext(CanvasSurfaceContext));
}
