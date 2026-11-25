/**
 * The editor's model relay for an app's `ai` resources (contract §6): the launcher page asks, this
 * attaches the signed-in session host-side and streams the gateway's answer back. The token never
 * leaves `fetchAuthed`; an error reaches the process only as the launcher's 502 message, never the body.
 */
import type * as vscode from "vscode";
import type { LauncherForwardAi } from "@seanhogg/builderforce-webcontainers/launcher/server";
import { fetchAuthed } from "../bfApi/transport";

/** The gateway's OpenAI-compatible completions route, under the base URL `fetchAuthed` prefixes. Metered by the route itself. */
export const CHAT_COMPLETIONS_PATH = "/llm/v1/chat/completions";

type AuthedFetch = typeof fetchAuthed;

export function vsixForwardAi(secrets: vscode.SecretStorage, authedFetch: AuthedFetch = fetchAuthed): LauncherForwardAi {
  return async function* forwardAi(request, signal) {
    const response = await authedFetch(secrets, CHAT_COMPLETIONS_PATH, { method: "POST", body: request.body as BodyInit, signal });
    if (!response) throw new Error("Not signed in to Builderforce.");
    if (!response.ok || !response.body) throw new Error(`The model gateway answered ${response.status}.`);
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}
