'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { Edge } from '@xyflow/react';
import { CARD_ACTS } from '@/domains/canvas/application/cardActs';
import { runCardAct } from '@/domains/canvas/application/CardAct';
import type { CanvasObjectFactory } from '@/domains/canvas/application/MaterializeDataset';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';

/**
 * RUNNING a card act against the board, and reaching that from anywhere on the canvas.
 *
 * ── WHY THIS IS NOT A PROP ──────────────────────────────────────────────────
 * The acts themselves stopped being a branch per case a while ago — they are registry
 * entries owned by the contexts they belong to. But the only thing that could RUN one
 * lived inside `CreationCanvas`'s closure, which meant a surface wanting a button for
 * an act had to be handed a callback threaded down through the inspector's prop list.
 * That list is already ~50 entries long, and every act would add another: the branch
 * per case had simply moved out of the dispatch and into the props.
 *
 * So the runner is built once and PUBLISHED at the board, and read by whoever needs it.
 * A new act needs no prop, no callback and no edit to the inspector — the property the
 * registry was supposed to have and did not.
 *
 * ── THE BOARD IS STILL MUTATED IN ONE PLACE ─────────────────────────────────
 * An act returns a DESCRIPTION of what should change and {@link useCardActRunnerFor}
 * applies it. Nothing that consumes the context can reach `setNodes`, so "where did
 * that card come from" still has exactly one answer.
 */

/** Runs the act this object and action name resolve to. Never throws — an act that
 *  fails reports through the same notice channel a successful one does. */
export type CardActRunner = (objectId: string, action: string) => void;

/** What running an act needs from the board in order to apply its outcome. */
export interface CardActBoardBinding {
  /** The CURRENT objects — read through a ref rather than captured at render, so an act
   *  awaiting the network still sees the board as it is when the outcome lands. */
  objects: () => readonly CanvasObject[];
  create: CanvasObjectFactory;
  setNodes: (update: (current: CanvasObject[]) => CanvasObject[]) => void;
  setEdges: (update: (current: Edge[]) => Edge[]) => void;
  setNotice: (notice: string) => void;
  /** `'local'` is a draft on this device; acts that need a server say so themselves. */
  persistence: 'local' | 'server';
  t: CanvasTextTranslator;
}

/** Build the runner for one board. The board mounts this once and both uses it and
 *  publishes it through {@link CardActProvider}. */
export function useCardActRunnerFor(board: CardActBoardBinding): CardActRunner {
  const { objects, create, setNodes, setEdges, setNotice, persistence, t } = board;
  return useCallback<CardActRunner>((objectId, action) => {
    void (async () => {
      const outcome = await runCardAct(CARD_ACTS, {
        objectId, action, persistence, t,
        board: { objects: objects(), create },
      });
      // Nothing answered. The caller's own dispatch says so — guessing a sentence here
      // for an act that does not exist is how a button ends up lying about what it did.
      if (!outcome) return;
      const { patch, add } = outcome;
      if (patch || add) {
        setNodes((current) => {
          const patched = patch
            ? current.map((node) => (node.id === objectId ? { ...node, data: { ...node.data, ...patch } } : node))
            : current;
          return add ? [...patched, ...add.nodes] : patched;
        });
        if (add?.edges.length) setEdges((current) => [...current, ...add.edges]);
      }
      setNotice(outcome.notice);
      // The slow half — an LMS score push — replaces the sentence when it lands.
      if (outcome.settle) void outcome.settle.then(setNotice);
    })();
  }, [objects, create, setNodes, setEdges, setNotice, persistence, t]);
}

const CardActContext = createContext<CardActRunner | null>(null);

export function CardActProvider({ runner, children }: { runner: CardActRunner; children: ReactNode }) {
  return <CardActContext.Provider value={runner}>{children}</CardActContext.Provider>;
}

/**
 * The runner, or a no-op outside a board.
 *
 * A no-op rather than a throw because the components that read this also mount in
 * previews and tests where there is no board to act on, and a card that cannot run its
 * act should render inert rather than crash the surface it is drawn on. A control that
 * needs to know whether acting is possible asks {@link useCanRunCardActs}.
 */
export function useCardActRunner(): CardActRunner {
  return useContext(CardActContext) ?? (() => {});
}

/** Whether a board is present to act against — what a control uses to decide its own
 *  visibility rather than being handed a boolean the parent computed the same way. */
export function useCanRunCardActs(): boolean {
  return useContext(CardActContext) != null;
}
