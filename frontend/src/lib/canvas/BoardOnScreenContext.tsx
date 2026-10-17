import { createContext, useContext, type ReactNode } from 'react';

/**
 * Is THIS board instance the one a person is looking at?
 *
 * `CanvasStage` keeps up to `KEPT_BOARD_CAP` boards mounted (see
 * `lib/canvas/boardRetention.ts`), and `LastBoardBridge` keeps the last board
 * mounted behind every app-shell route — so a board instance being mounted says
 * nothing about anyone seeing it. A board's live loops (the presence tick, the
 * Evermind node refresh, the standup status read) are for the person in front of
 * it; a kept board behind the dashboard must not announce presence or keep the
 * API (and the database behind it) awake.
 *
 * The stage wraps each kept instance in this provider with `selected && shown`.
 * The default is `true`: a board mounted outside the stage (the VS Code webview,
 * an embed, a test) is on screen by construction.
 */
const BoardOnScreenContext = createContext(true);

export function BoardOnScreenProvider({ onScreen, children }: { onScreen: boolean; children: ReactNode }) {
  return <BoardOnScreenContext.Provider value={onScreen}>{children}</BoardOnScreenContext.Provider>;
}

/** `true` when the enclosing board is the one on stage and the stage is visible. */
export function useBoardOnScreen(): boolean {
  return useContext(BoardOnScreenContext);
}
