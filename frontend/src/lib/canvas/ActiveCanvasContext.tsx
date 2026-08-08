'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { classifyShell } from '@/lib/shellRouting';

/**
 * WHICH board is on the stage — shell state, so the board is no longer owned by
 * the route that happens to be on screen.
 *
 * The route used to BE the canvas: `/create/<id>` rendered `<CreationCanvas>`, so
 * every navigation unmounted the board and every return re-fetched and re-laid it
 * out. That is also why switching between canvas-like surfaces (create,
 * brainstorm, the workflow builder, the IDE) could never be a mode change — each
 * was a different component tree.
 *
 * Now the route only says WHAT should be on the stage; the shell decides where
 * the stage lives and keeps it mounted. See {@link CanvasStage}.
 */

export interface ActiveCanvas {
  sessionId: string;
  persistence: 'local' | 'server';
  /** Board object to focus on open (`?focus=`). */
  focusId: string | null;
  /** Open the share panel on arrival (`?share=1`). */
  shareOpen: boolean;
  /** Arrive in presentation mode (`?present=1`). */
  present: boolean;
}

export interface ActiveCanvasValue {
  active: ActiveCanvas | null;
  /**
   * True when THIS shell renders the stage. The logged-out marketing shell does
   * not, so the anonymous-canvas route falls back to rendering the board itself
   * rather than registering into a stage that will never mount.
   */
  stageHosted: boolean;
  /** Canonical project ids referenced by the board, published by the canvas. */
  projectIds: number[];
  open: (canvas: ActiveCanvas) => void;
  close: () => void;
  publishProjectIds: (ids: number[]) => void;
}

const ActiveCanvasContext = createContext<ActiveCanvasValue | null>(null);

/**
 * Does the shell for this route host the persistent stage?
 *
 * Derived rather than reported by the stage on mount: a boolean that arrives one
 * commit late makes the route render the board for a frame and then hand it over,
 * which loads the same canvas twice.
 */
export function shellHostsCanvasStage(pathname: string, isAuthenticated: boolean): boolean {
  return isAuthenticated && classifyShell(pathname) === 'app';
}

export function ActiveCanvasProvider({
  children,
  stageHosted,
}: {
  children: React.ReactNode;
  stageHosted: boolean;
}) {
  const [active, setActive] = useState<ActiveCanvas | null>(null);
  const [projectIds, setProjectIds] = useState<number[]>([]);

  const open = useCallback((canvas: ActiveCanvas) => {
    setActive((current) => {
      // Re-registering the SAME board (a re-render, a `?focus=` change landing on
      // the identical value) must not produce a new object — the stage keys on
      // this, and a fresh identity would remount the board it is meant to keep.
      if (
        current
        && current.sessionId === canvas.sessionId
        && current.persistence === canvas.persistence
        && current.focusId === canvas.focusId
        && current.shareOpen === canvas.shareOpen
        && current.present === canvas.present
      ) return current;
      return canvas;
    });
    setProjectIds((current) => (current.length === 0 ? current : []));
  }, []);

  const close = useCallback(() => {
    setActive(null);
    setProjectIds([]);
  }, []);

  const publishProjectIds = useCallback((ids: number[]) => {
    setProjectIds((current) => (
      current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids
    ));
  }, []);

  const value = useMemo<ActiveCanvasValue>(
    () => ({ active, stageHosted, projectIds, open, close, publishProjectIds }),
    [active, close, open, projectIds, publishProjectIds, stageHosted],
  );

  return <ActiveCanvasContext.Provider value={value}>{children}</ActiveCanvasContext.Provider>;
}

/** Non-throwing: the embed tree and the marketing shell have no stage. */
export function useOptionalActiveCanvas(): ActiveCanvasValue | null {
  return useContext(ActiveCanvasContext);
}
