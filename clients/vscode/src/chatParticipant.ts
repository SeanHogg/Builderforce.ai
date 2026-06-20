import * as vscode from "vscode";
import { runAgent } from "./agent";
import { ChatMessage, SECRET_KEY } from "./gateway";
import { getGroundingSummary } from "./grounding";
import { buildSystemMessages } from "./prompt";

const PARTICIPANT_ID = "builderforce.agent";

/**
 * Registers BuilderForce in VS Code's native Chat view as `@builderforce`, reusing the
 * same agent loop + sandboxed file tools as the sidebar webview. Stable Chat Participant
 * API (the dedicated agent-session tab surface remains a proposed API — see Gap Register).
 */
export function registerChatParticipant(ctx: vscode.ExtensionContext): vscode.Disposable {
  const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
    const key = await ctx.secrets.get(SECRET_KEY);
    if (!key) {
      stream.markdown("You're not signed in to BuilderForce.\n\n");
      stream.button({ command: "builderforce.signIn", title: "Sign in to BuilderForce" });
      return {};
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cfg = vscode.workspace.getConfiguration("builderforce");
    const model = cfg.get<string>("defaultModel") || undefined;
    const permissionMode = cfg.get<"ask" | "acceptEdits">("permissionMode") ?? "ask";

    const messages: ChatMessage[] = [...buildSystemMessages(root, getGroundingSummary())];
    // Reconstruct prior turns from the native chat history.
    for (const turn of context.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push({ role: "user", content: turn.prompt });
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
        if (text) messages.push({ role: "assistant", content: text });
      }
    }
    messages.push({ role: "user", content: request.prompt });

    const abort = new AbortController();
    token.onCancellationRequested(() => abort.abort());

    await runAgent(
      messages,
      {
        secrets: ctx.secrets,
        root,
        model,
        permissionMode,
        approve: async (summary) => {
          const pick = await vscode.window.showWarningMessage(
            `BuilderForce wants to ${summary}.`,
            { modal: true },
            "Apply",
            "Skip",
          );
          return pick === "Apply";
        },
        signal: abort.signal,
      },
      {
        onText: (delta) => stream.markdown(delta),
        onToolStart: (label) => stream.progress(label),
        onToolResult: (label, ok) => stream.markdown(`\n\n${ok ? "✓" : "✗"} ${label}\n\n`),
        onError: (message) => stream.markdown(`\n\n**Error:** ${message}\n`),
      },
    );

    return {};
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
  return participant;
}
