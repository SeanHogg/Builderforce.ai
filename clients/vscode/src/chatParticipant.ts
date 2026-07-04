import * as vscode from "vscode";
import { runAgent } from "./agent";
import { ChatMessage, SECRET_KEY, fetchLimbicBlock } from "./gateway";
import { contributeProjectEvermind } from "./evermindLearn";
import { getGroundingSummary } from "./grounding";
import { resolveEffectiveModel } from "./modelState";
import { getSelectedProject } from "./projectState";
import { buildSystemMessages } from "./prompt";

const PARTICIPANT_ID = "builderforce.agent";

/**
 * The shared chat request handler — drives the agent loop and streams into a
 * ChatResponseStream. Used by BOTH the native @builderforce participant and the
 * dedicated chat-session tab (so there is one implementation).
 */
export function createBuilderForceHandler(ctx: vscode.ExtensionContext): vscode.ChatRequestHandler {
  return async (request, context, stream, token) => {
    const key = await ctx.secrets.get(SECRET_KEY);
    if (!key) {
      stream.markdown("You're not signed in to BuilderForce.\n\n");
      stream.button({ command: "builderforce.signIn", title: "Sign in to BuilderForce" });
      return {};
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cfg = vscode.workspace.getConfiguration("builderforce");
    // Resolve per turn so an explicit pick, the active project's Evermind, or the
    // configured default is honored the same way the Brain webview + cloud/on-prem do.
    const model = await resolveEffectiveModel(ctx.secrets);
    const permissionMode = cfg.get<"ask" | "acceptEdits">("permissionMode") ?? "ask";

    // Limbic affective layer (gateway-injected) — parity with the webview chat
    // and the cloud (V3) / on-prem agents. Best-effort; '' at rest or offline.
    const limbicBlock = await fetchLimbicBlock(ctx.secrets, request.prompt);
    const messages: ChatMessage[] = [...buildSystemMessages(root, getGroundingSummary(), undefined, limbicBlock)];
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

    // Accumulate the assistant's reply so, after the run, we can feed this
    // exchange back to the project's Evermind (the same learning loop cloud/on-prem
    // runs — best-effort, gated by `builderforce.evermindLearning`).
    let assistantText = "";

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
        onText: (delta) => { assistantText += delta; stream.markdown(delta); },
        onToolStart: (label) => stream.progress(label),
        onToolResult: (label, ok) => stream.markdown(`\n\n${ok ? "✓" : "✗"} ${label}\n\n`),
        onError: (message) => stream.markdown(`\n\n**Error:** ${message}\n`),
      },
    );

    // Contribute this run's text to the active project's Evermind. Fire-and-forget:
    // the contributor is off by default, throttled, and swallows all errors, so it
    // never blocks or breaks the chat turn.
    const project = getSelectedProject();
    if (project) {
      void contributeProjectEvermind(ctx.secrets, project.id, `${request.prompt}\n\n${assistantText}`);
    }

    return {};
  };
}

/**
 * Registers BuilderForce in VS Code's native Chat view as `@builderforce` (stable Chat
 * Participant API). Returns the participant so the dedicated session tab can reuse it.
 */
export function registerChatParticipant(ctx: vscode.ExtensionContext): vscode.ChatParticipant {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, createBuilderForceHandler(ctx));
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
  return participant;
}
