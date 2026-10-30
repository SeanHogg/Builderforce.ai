/**
 * Two readings the native chat participant makes of the editor's chat session, kept apart
 * from the request handler (`chatParticipant.ts`): which Brain chat a session already is,
 * and how the system messages it assembles fold into the one prompt + seed the shared
 * run loop takes.
 */

import * as vscode from "vscode";
import type { ChatCompletionMessage } from "@seanhogg/builderforce-brain-embedded";
import type { ChatMessage } from "./gateway";

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

/**
 * The shared run loop takes ONE system prompt string plus a plain conversation seed,
 * where this surface has always assembled a list of `system` messages (persona, active
 * project, workspace map, editor context, limbic block, governance). Fold them here —
 * order preserved, so the model reads exactly what it read before.
 */
export function splitSystemPrompt(messages: readonly ChatMessage[]): {
  systemPrompt: string;
  seed: ChatCompletionMessage[];
} {
  const system: string[] = [];
  const seed: ChatCompletionMessage[] = [];
  for (const message of messages) {
    const content = typeof message.content === "string" ? message.content : "";
    if (message.role === "system") {
      if (content) system.push(content);
    } else if (content) {
      seed.push({ role: message.role, content });
    }
  }
  return { systemPrompt: system.join("\n\n"), seed };
}
