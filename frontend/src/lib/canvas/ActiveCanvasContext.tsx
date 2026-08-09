'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { rendersAppShell } from '@/lib/shellRouting';

/**
 * WHICH board is on the stage — shell state, so the board is no longer owned by
 * the route that happens to be on screen.
 *
 * The route used to BE the canvas: `/create/<id>` rendered `<CreationCanvas>`, so
 * every navigation unmounted the board and every return re-fetched and re-laid it
 * out. That is also why switching between canvas-like surfaces (create,
 * brainstorm, workflow authoring, and Builder) could never be a mode change — each
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
  /** Open a focused Builder object's workspace on arrival (`?build=1`). */
  buildOpen: boolean;
  /** Project conversation selected by a legacy Builder deep link. */
  buildChatId: number | null;
  /** Work item selected by a legacy Builder deep link. */
  buildTicket: { kind: string; ref: string } | null;
  /** One-shot Brain prompt carried by a legacy creation deep link. */
  prompt: string | null;
  /** Arrive in presentation mode (`?present=1`). */
  present: boolean;
  /** Models explicitly selected for a prompt comparison launched from Marketplace. */
  modelComparisonIds: string[];
}

export interface ActiveCanvasValue {
  active: ActiveCanvas | null;
  /** Every board opened in this shell session. Each owns one mounted canvas. */
  opened: ActiveCanvas[];
  /**
   * True when THIS shell renders the stage — which is now every shell that
   * renders a canvas route, signed in or not. An anonymous board is a real
   * board and gets the real stage; see {@link shellHostsCanvasStage}.
   */
  stageHosted: boolean;
  /** Canonical project ids referenced by the board, published by the canvas. */
  projectIds: number[];
  open: (canvas: ActiveCanvas) => void;
  close: () => void;
  publishProjectIds: (sessionId: string, ids: number[]) => void;
}

const ActiveCanvasContext = createContext<ActiveCanvasValue | null>(null);

/**
 * Does the shell for this route host the persistent stage?
 *
 * Derived rather than reported by the stage on mount: a boolean that arrives one
 * commit late makes the route render the board for a frame and then hand it over,
 * which loads the same canvas twice.
 *
 * It is the SAME predicate that picks the chrome, so "which shell is on screen"
 * and "who owns the board" can never disagree — the guest canvas is hosted by the
 * operator shell exactly as a signed-in one is.
 */
export function shellHostsCanvasStage(pathname: string, isAuthenticated: boolean): boolean {
  return rendersAppShell(pathname, isAuthenticated);
}

export function ActiveCanvasProvider({
  children,
  stageHosted,
}: {
  children: React.ReactNode;
  stageHosted: boolean;
}) {
  const [active, setActive] = useState<ActiveCanvas | null>(null);
  const [opened, setOpened] = useState<ActiveCanvas[]>([]);
  const [projectIdsBySession, setProjectIdsBySession] = useState<Record<string, number[]>>({});

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
        && current.buildOpen === canvas.buildOpen
        && current.buildChatId === canvas.buildChatId
        && current.buildTicket?.kind === canvas.buildTicket?.kind
        && current.buildTicket?.ref === canvas.buildTicket?.ref
        && current.prompt === canvas.prompt
        && current.present === canvas.present
        && current.modelComparisonIds.length === canvas.modelComparisonIds.length
        && current.modelComparisonIds.every((id, index) => id === canvas.modelComparisonIds[index])
      ) return current;
      return canvas;
    });
    setOpened((current) => {
      const index = current.findIndex((item) => item.sessionId === canvas.sessionId && item.persistence === canvas.persistence);
      if (index < 0) return [...current, canvas];
      const existing = current[index];
      if (existing === canvas) return current;
      const next = current.slice();
      next[index] = canvas;
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setActive(null);
    setOpened([]);
    setProjectIdsBySession({});
  }, []);

  const publishProjectIds = useCallback((sessionId: string, ids: number[]) => {
    setProjectIdsBySession((current) => {
      const prior = current[sessionId] ?? [];
      if (prior.length === ids.length && prior.every((id, index) => id === ids[index])) return current;
      return { ...current, [sessionId]: ids };
    });
  }, []);

  const projectIds = active ? (projectIdsBySession[active.sessionId] ?? []) : [];

  const value = useMemo<ActiveCanvasValue>(
    () => ({ active, opened, stageHosted, projectIds, open, close, publishProjectIds }),
    [active, close, open, opened, projectIds, publishProjectIds, stageHosted],
  );

  return <ActiveCanvasContext.Provider value={value}>{children}</ActiveCanvasContext.Provider>;
}

/** Non-throwing: the embed tree and the marketing shell have no stage. */
export function useOptionalActiveCanvas(): ActiveCanvasValue | null {
  return useContext(ActiveCanvasContext);
}
