import * as vscode from "vscode";
import { runAgent } from "./agent";
import { ChatMessage, SECRET_KEY, fetchLimbicBlock } from "./gateway";
import { getCurrentUserId, createBrainChat, appendBrainMessages } from "./bfApi";
import { getGroundingSummary } from "./grounding";
import { getEditorContext } from "./editorContext";
import { editorContextDirective } from "./idePersona";
import { resolveEffectiveModel } from "./modelState";
import { getSelectedProject } from "./projectState";
import { buildSystemMessages } from "./prompt";

const PARTICIPANT_ID = "builderforce.agent";

/**
 * Recover the session's Brain chat id from the native chat history: it is stashed in
 * every prior response turn's `result.metadata.brainChatId` (the Chat Participant
 * API's per-session state channel — there is no stable session id in the stable API).
 * The most recent one wins. Returns undefined on the first turn of a session.
 */
function priorBrainChatId(history: readonly vscode.ChatRequestTurn[] | readonly unknown[]): number | undefined {
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

    // Limbic affective layer + PERSONALITY (gateway-injected) — parity with the
    // webview chat and the cloud (V3) / on-prem agents. Passing the signed-in
    // user's id (session-cached) makes the returned block carry their personality
    // TONE, not just the affective appraisal. Best-effort; '' at rest or offline.
    const userId = (await getCurrentUserId(ctx.secrets)) ?? undefined;
    const limbicBlock = await fetchLimbicBlock(ctx.secrets, request.prompt, userId ? { userId } : undefined);
    // Live editor context (active file / selection / open tabs) so the agent resolves
    // "this file" / "the selection" to what's actually open — read fresh each turn.
    const editorCtx = editorContextDirective(getEditorContext());
    const messages: ChatMessage[] = [...buildSystemMessages(root, getGroundingSummary(), editorCtx, limbicBlock)];
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

    const activeProject = getSelectedProject();
    // Resolve THIS session's Brain chat: reuse the one carried in prior turns'
    // response metadata, else create one lazily (scoped to the active project) so the
    // work this chat does — created tickets, from_delta code-change captures — links
    // back to a real conversation, exactly like the webview Brain. Best-effort: a null
    // id just runs unlinked (the code-change backstop still mints a ticket).
    let brainChatId = priorBrainChatId(context.history);
    if (brainChatId == null) {
      const title = request.prompt.trim().slice(0, 80) || "VS Code chat";
      brainChatId = (await createBrainChat(ctx.secrets, { title, projectId: activeProject?.id ?? null })) ?? undefined;
    }
    await runAgent(
      messages,
      {
        secrets: ctx.secrets,
        root,
        ...(activeProject ? { projectId: activeProject.id } : {}),
        ...(brainChatId != null ? { chatId: brainChatId } : {}),
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

    // Persist the turn into the SAME Brain store the webview + web app read, so the
    // linked chat carries the actual conversation (not just ticket lineage). This is
    // ALSO what feeds the project's Evermind: the server's learn gate
    // (`evaluateBrainLearnGate`) fires on this persist when the chat is attached to a
    // project — one authoritative learning path for every surface, no separate opt-in
    // client contribution. Best-effort — swallows its own errors and never blocks the reply.
    if (brainChatId != null) {
      const turns: Array<{ role: string; content: string }> = [{ role: "user", content: request.prompt }];
      if (assistantText.trim()) turns.push({ role: "assistant", content: assistantText });
      void appendBrainMessages(ctx.secrets, brainChatId, turns);
    }

    // Return the chat id in the result metadata so the NEXT turn of this session
    // resolves the same conversation (see priorBrainChatId).
    return brainChatId != null ? { metadata: { brainChatId } } : {};
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
