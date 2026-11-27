/**
 * The reading the BuilderForce chat turn makes of the editor's chat session, kept apart
 * from the turn (`builderforceTurn.ts`): which Brain chat a session already is.
 */

import * as vscode from "vscode";

/**
 * Recover the session's Brain chat id from the native chat history: it is stashed in
 * every prior response turn's `result.metadata.brainChatId` (the Chat Participant
 * API's per-session state channel — there is no stable session id in the stable API).
 * The most recent one wins. Returns undefined on the first turn of a session.
 */
export function priorBrainChatId(history: readonly vscode.ChatRequestTurn[] | readonly unknown[]): number | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn instanceof vscode.ChatResponseTurn) {
      const id = (turn.result?.metadata as { brainChatId?: unknown } | undefined)?.brainChatId;
      if (typeof id === "number") return id;
    }
  }
  return undefined;
}
