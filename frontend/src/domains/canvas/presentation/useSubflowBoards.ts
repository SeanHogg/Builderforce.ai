'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetSubflowBoard, loadSubflowBoard, type SubflowSourcePort } from '../application/LoadSubflowBoard';
import type { SubflowBoard, SubflowResolver } from '@/domains/workflow/domain/subflow';

/**
 * THE CHILD CANVASES THIS BOARD REACHES FOR, IN MEMORY BY THE TIME IT BUILDS.
 *
 * The compiler is pure and synchronous, which is what makes a build deterministic
 * and testable — so it cannot await anything. Composition needs child boards
 * anyway, and this is where that tension is resolved: the surface watches which
 * canvases the board references, loads them in the background, and hands the
 * compiler a resolver that reads what has arrived.
 *
 * A child that has NOT arrived is not silently skipped. The resolver returns null,
 * the compiler raises `subflowUnresolved` naming the canvas, and the build refuses
 * — which is the honest outcome, because a build that quietly omitted a step would
 * produce a flow that runs, reports success, and does not do the thing the step was
 * placed for.
 *
 * Self-contained: it takes the ids it should hold and the port to read them
 * through, owns its own cache lifetime, and returns one stable function. Nothing
 * about the canvas component is in here, so a second surface that compiles boards
 * uses it unchanged.
 */
export function useSubflowBoards(sessionIds: readonly string[], port: SubflowSourcePort): SubflowResolver {
  const boards = useRef(new Map<string, SubflowBoard>());
  // Bumped when a board lands, so a surface rendering derived state (the
  // inspector's port list, a card's step count) re-reads the resolver. The
  // resolver itself stays referentially stable — a compile callback that changed
  // identity on every fetch would re-run everything that depends on it.
  const [, setArrived] = useState(0);
  const key = sessionIds.join(',');

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(',') : [];
    for (const sessionId of wanted) {
      void loadSubflowBoard(port, sessionId).then((board) => {
        if (cancelled || !board) return;
        boards.current.set(sessionId, board);
        setArrived((count) => count + 1);
      });
    }
    // A canvas no longer referenced stops being held: keeping it would make the
    // next reference to it resolve against a board that may be hours old.
    for (const held of [...boards.current.keys()]) {
      if (!wanted.includes(held)) boards.current.delete(held);
    }
    return () => { cancelled = true; };
  }, [key, port]);

  return useCallback((sessionId: string) => boards.current.get(sessionId) ?? null, []);
}

/**
 * Read one child canvas NOW, bypassing whatever is cached.
 *
 * For the moment an author picks a canvas in the step's editor: they have just
 * chosen it, so they are entitled to see its real interface rather than a copy
 * taken before they last edited it.
 */
export async function readSubflowBoardFresh(port: SubflowSourcePort, sessionId: string): Promise<SubflowBoard | null> {
  forgetSubflowBoard(sessionId);
  return loadSubflowBoard(port, sessionId);
}
