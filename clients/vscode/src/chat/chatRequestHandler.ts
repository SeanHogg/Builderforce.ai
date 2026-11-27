import type * as vscode from "vscode";
import type { BrainRunHost } from "../brain/brainRunHost";
import { createBuilderForceTurn } from "./builderforceTurn";
import { priorBrainChatId } from "./participantSession";
import { signalOfToken } from "./turnSink";

/**
 * The chat-session tab's request handler: a thin adapter from VS Code's chat request (history, stream, cancellation) to the ONE
 * BuilderForce turn (`builderforceTurn.ts`). It owns no turn logic - it names the chat the session already is (the id carried in
 * its history) and hands the response stream over as the turn's sink; the turn reads that chat's persisted history itself.
 */
export function createBuilderForceHandler(ctx: vscode.ExtensionContext, runHost: BrainRunHost): vscode.ChatRequestHandler {
  const runTurn = createBuilderForceTurn(ctx, runHost);
  return async (request, context, stream, token) => {
    const cancel = signalOfToken(token);
    try {
      const result = await runTurn(
        { prompt: request.prompt, priorChatId: priorBrainChatId(context.history), references: request.references, signal: cancel.signal },
        stream,
      );
      // The chat id rides the result metadata so the NEXT turn of this session resolves the same conversation (see priorBrainChatId).
      return result.brainChatId == null ? {} : { metadata: { brainChatId: result.brainChatId } };
    } finally {
      cancel.dispose();
    }
  };
}
