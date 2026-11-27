import * as vscode from "vscode";
import type { ChatCompletionMessage } from "@seanhogg/builderforce-brain-embedded";
import type { BrainRunHost } from "../brain/brainRunHost";
import { createBuilderForceTurn } from "./builderforceTurn";
import { priorBrainChatId } from "./participantSession";

/**
 * The chat-session tab's request handler: a thin adapter from VS Code's chat request (history, stream, cancellation) to the ONE
 * BuilderForce turn (`builderforceTurn.ts`). It owns no turn logic - it reads the editor's history into the turn's seed and
 * hands the response stream over as the turn's sink.
 */
export function createBuilderForceHandler(ctx: vscode.ExtensionContext, runHost: BrainRunHost): vscode.ChatRequestHandler {
  const runTurn = createBuilderForceTurn(ctx, runHost);
  return async (request, context, stream, token) => {
    // Reconstruct prior turns from the native chat history.
    const seed: ChatCompletionMessage[] = [];
    for (const turn of context.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        seed.push({ role: "user", content: turn.prompt });
      } else if (turn instanceof vscode.ChatResponseTurn) {
        let text = "";
        for (const part of turn.response) {
          const value = (part as { value?: unknown }).value;
          if (value && typeof (value as { value?: unknown }).value === "string") {
            text += (value as { value: string }).value; // MarkdownString
          } else if (typeof value === "string") {
            text += value;
          }
        }
        if (text) seed.push({ role: "assistant", content: text });
      }
    }
    const result = await runTurn(
      {
        prompt: request.prompt,
        seed,
        priorChatId: priorBrainChatId(context.history),
        references: request.references,
        isCancelled: () => token.isCancellationRequested,
      },
      stream,
    );
    // The chat id rides the result metadata so the NEXT turn of this session resolves the same conversation (see priorBrainChatId).
    return result.brainChatId == null ? {} : { metadata: { brainChatId: result.brainChatId } };
  };
}
