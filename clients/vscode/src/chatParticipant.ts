import * as vscode from "vscode";
import { formatEvermindLearnStep, type ChatCompletionMessage } from "@seanhogg/builderforce-brain-embedded";
import { ChatMessage, SECRET_KEY, fetchLimbicBlock, getBaseUrl } from "./gateway";
import {
  getCurrentUserId,
  createBrainChat,
  appendBrainMessages,
  fetchRunContextSection,
  projectEvermindHooks,
  updateBrainChatProject,
} from "./bfApi";
import { formatChatErrorVerdict } from "./upgradeAction";
import { getGroundingWithHistory } from "./grounding";
import { getEditorContextLive } from "./editorContext";
import { editorContextDirective } from "./idePersona";
import { resolveEffectiveModelChoice } from "./modelState";
import { getSelectedProject } from "./projectState";
import { buildSystemMessages } from "./prompt";
import { TOOL_DEFS, type ToolDef } from "./fileTools";
import { listPlatformTools } from "./platformTools";
import { cognitionToolDefs } from "./cognition";
import { createNativeStream, runNativeBrain, unlinkedRunId, type NativeApprovalRequest } from "./nativeBrainRun";

const PARTICIPANT_ID = "builderforce.agent";

/**
 * Tool-iteration ceiling for a native turn. Higher than the shared default because the
 * participant runs a real coding loop against an open workspace, where a single request
 * ("rename this across the repo") legitimately spans many read/edit turns.
 */
const MAX_ITERATIONS = 40;

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
 * The shared run loop takes ONE system prompt string plus a plain conversation seed,
 * where this surface has always assembled a list of `system` messages (persona, active
 * project, workspace map, editor context, limbic block, governance). Fold them here —
 * order preserved, so the model reads exactly what it read before.
 */
function splitSystemPrompt(messages: readonly ChatMessage[]): {
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

/**
 * The shared chat request handler — drives the agent loop and streams into a
 * ChatResponseStream. Used by BOTH the native @builderforce participant and the
 * dedicated chat-session tab (so there is one implementation).
 */
export function createBuilderForceHandler(ctx: vscode.ExtensionContext): vscode.ChatRequestHandler {
  return async (request, context, stream, token) => {
    const key = await ctx.secrets.get(SECRET_KEY);
    if (!key) {
      stream.markdown(vscode.l10n.t("You're not signed in to BuilderForce."));
      stream.markdown("\n\n");
      stream.button({ command: "builderforce.signIn", title: vscode.l10n.t("Sign in to BuilderForce") });
      return {};
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cfg = vscode.workspace.getConfiguration("builderforce");
    // Resolve per turn so an explicit pick, the active project's Evermind, or the
    // configured default is honored the same way the Brain webview + cloud/on-prem do.
    const modelChoice = await resolveEffectiveModelChoice(ctx.secrets);
    const permissionMode = cfg.get<"ask" | "acceptEdits">("permissionMode") ?? "ask";

    // Limbic affective layer + PERSONALITY (gateway-injected) — parity with the
    // webview chat and the cloud (V3) / on-prem agents. Passing the signed-in
    // user's id (session-cached) makes the returned block carry their personality
    // TONE, not just the affective appraisal. Best-effort; '' at rest or offline.
    const userId = (await getCurrentUserId(ctx.secrets)) ?? undefined;
    const limbicBlock = await fetchLimbicBlock(ctx.secrets, request.prompt, userId ? { userId } : undefined);
    // Live editor context (active file / selection / open tabs) PLUS the absolute
    // workspace root and its git repo, so the agent resolves "this file" / "the
    // selection" to what's open and knows where the code lives instead of asking.
    // Read fresh each turn; awaited so git is resolved on the very first turn.
    const editorCtx = editorContextDirective(await getEditorContextLive());
    // The PLATFORM context — strategy (OKRs), the ticket PRD, project + agent governance,
    // durable project memory and prior Evermind lessons — from the api's ONE
    // `ContextSource`. This is the block that brings the IDE agent up to the cloud
    // engine's context set; without it the editor worked a project it had never been told
    // the requirements or the rules of. Continuity-scoped to THIS conversation (the Brain
    // chat carried in prior turns' metadata) so the reconciler measures the delta against
    // what this chat was already told. Best-effort: '' when signed out / project-less.
    const selectedProject = getSelectedProject();
    const priorChatId = priorBrainChatId(context.history);
    const platformContext = selectedProject
      ? await fetchRunContextSection(ctx.secrets, selectedProject.id, {
          ...(priorChatId != null ? { scope: `chat:${priorChatId}` } : {}),
          query: request.prompt,
        })
      : "";
    const messages: ChatMessage[] = [
      ...buildSystemMessages(
        root,
        await getGroundingWithHistory(root),
        editorCtx,
        limbicBlock,
        selectedProject,
        platformContext,
      ),
    ];
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

    const abort = new AbortController();
    token.onCancellationRequested(() => abort.abort());

    // Accumulate the assistant's reply so, after the run, we can feed this
    // exchange back to the project's Evermind (the same learning loop cloud/on-prem
    // runs — best-effort, gated by `builderforce.evermindLearning`).
    let assistantText = "";

    const activeProject = selectedProject;
    // Resolve THIS session's Brain chat: reuse the one carried in prior turns'
    // response metadata, else create one lazily (scoped to the active project) so the
    // work this chat does — created tickets, from_delta code-change captures — links
    // back to a real conversation, exactly like the webview Brain. Best-effort: a null
    // id just runs unlinked (the chat-scoped backstops then have nothing to link to).
    let brainChatId = priorChatId;
    if (brainChatId == null) {
      const title = request.prompt.trim().slice(0, 80) || vscode.l10n.t("VS Code chat");
      brainChatId = (await createBrainChat(ctx.secrets, { title, projectId: activeProject?.id ?? null })) ?? undefined;
    }

    // The SAME brain as the web: local workspace tools (file edits) + Evermind's
    // write-through `remember_fact` + the SHARED, server-side platform catalog
    // (projects, tasks, OKRs, specs, …) fetched from the gateway MCP relay. File tools
    // need a workspace; `remember_fact` needs only a project (works chat-only). Gate
    // each on what it actually requires.
    const cognitionTools = activeProject ? cognitionToolDefs(ctx.secrets, activeProject.id) : [];
    const platformTools = await listPlatformTools(ctx.secrets);
    const tools: ToolDef[] = [...(root ? TOOL_DEFS : []), ...cognitionTools, ...platformTools];

    const { systemPrompt, seed } = splitSystemPrompt(messages);

    await runNativeBrain({
      // With no server chat (the platform was unreachable) the run still needs a cell
      // key; a unique negative id keeps it isolated and unmistakable for a real chat.
      chatId: brainChatId ?? unlinkedRunId(),
      systemPrompt,
      seed,
      userTurn: request.prompt,
      tools,
      root: root ?? "",
      // The chat-scoped backstops (mint a ticket for an unrecorded code change, advance
      // a linked ticket off backlog) write a link against a REAL conversation, so they
      // are gated on one existing — minting a ticket against a chat id that does not
      // exist would be worse than not minting it.
      ...(activeProject && brainChatId != null ? { projectId: activeProject.id } : {}),
      // Memory, by contrast, is scoped to the PROJECT and needs no chat: a turn that
      // could not create a conversation can still be answered from memory for free.
      ...(activeProject ? { evermind: projectEvermindHooks(ctx.secrets, activeProject.id) } : {}),
      ...(brainChatId == null ? { chatMode: "chat" as const } : {}),
      ...(modelChoice.model ? { model: modelChoice.model } : {}),
      modelStrict: modelChoice.modelStrict,
      ...(modelChoice.routingMode ? { routingMode: modelChoice.routingMode } : {}),
      permissionMode,
      maxIterations: MAX_ITERATIONS,
      stream: createNativeStream(getBaseUrl(), key),
      signal: abort.signal,
      approve: async (req: NativeApprovalRequest) => {
        const prompt = req.gateReason
          ? vscode.l10n.t('Governance: approve "{0}"? {1}', req.label, req.gateReason)
          : vscode.l10n.t("BuilderForce wants to {0}.", req.label);
        const apply = vscode.l10n.t("Apply");
        const pick = await vscode.window.showWarningMessage(prompt, { modal: true }, apply, vscode.l10n.t("Skip"));
        return pick === apply;
      },
      labels: {
        dispatchHint: vscode.l10n.t(
          "_This turn reached its tool budget. For work this long, dispatch a cloud agent from the board instead — it runs without a turn limit._",
        ),
        blockedByPolicy: (reason: string) => vscode.l10n.t("Blocked by a governance gate: {0}", reason),
      },
      events: {
        onText: (delta) => {
          assistantText += delta;
          stream.markdown(delta);
        },
        onToolStart: (label) => stream.progress(label),
        onToolResult: (label, ok) => stream.markdown(`\n\n${ok ? "✓" : "✗"} ${label}\n\n`),
        // An entitlement failure gets the fix appended as a link (Upgrade / Add a
        // card) — same verdict the webview banner renders as a button, so the two
        // chat surfaces never disagree about what a block means.
        onError: (message, action) =>
          stream.markdown(`\n\n**${vscode.l10n.t("Error:")}** ${formatChatErrorVerdict(message, action)}\n`),
      },
    });

    // Persist the turn into the SAME Brain store the webview + web app read, so the
    // linked chat carries the actual conversation (not just ticket lineage). This is
    // ALSO what feeds the project's Evermind: the server's learn gate
    // (`evaluateBrainLearnGate`) fires on this persist when the chat is attached to a
    // project — one authoritative learning path for every surface, no separate opt-in
    // client contribution. Best-effort — swallows its own errors and never blocks the reply.
    if (brainChatId != null) {
      const turns: Array<{ role: string; content: string }> = [{ role: "user", content: request.prompt }];
      if (assistantText.trim()) turns.push({ role: "assistant", content: assistantText });
      const outcome = await appendBrainMessages(ctx.secrets, brainChatId, turns);
      // Self-heal: if the server says this chat isn't bound to a project but the IDE has
      // an active one, adopt it so the NEXT turn trains that project's Evermind (parity
      // with the webview's adopt-on-open — the native participant otherwise leaves a chat
      // created before a project was selected permanently project-less). Both are gated on
      // an ACTIVE project: with none selected there is nothing to adopt.
      if (outcome?.reason === "not-attached" && activeProject) {
        await updateBrainChatProject(ctx.secrets, brainChatId, activeProject.id);
      }
      // Surface the learn/skip outcome as a trailing status line, so learning is VISIBLE
      // on the native participant too (it streams Markdown, not the <BrainTimeline>).
      const learnLine = formatEvermindLearnStep(outcome);
      if (learnLine) stream.markdown(`\n\n_${learnLine}_\n`);
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
