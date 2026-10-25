import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import { recordEditorRunEnd } from "./editorRunEnd";
import * as vscode from "vscode";
import { runAbortSignal, withRunUsage, type ChatCompletionMessage } from "@seanhogg/builderforce-brain-embedded";
import { ChatMessage, SECRET_KEY } from "./gateway";
import { turnLimbicBlock } from "./personalityLimbic";
import { resolveModelRoute, routeNeedsLocalModel, routeNeedsSpecificModel, routeRequiresSignIn, routeStream } from "./modelRouting";
import { streamNoLocalModel } from "./noLocalModelPrompt";
import { OWNER_NAME, type BrainRunHost } from "./brainRunHost";
import { permissionMode as resolvePermissionMode } from "./permissionMode";
import { getCurrentUserId, fetchRunContextSection, projectEvermindHooks } from "./bfApi";
import { localBrainApplication } from "./localFirstStore";
import { formatChatErrorVerdict } from "./upgradeAction";
import { getGroundingWithHistory } from "./grounding";
import { getEditorContextLive } from "./editorContext";
import { editorContextDirective } from "./idePersona";
import { getSelectedProject } from "./projectState";
import { PolicyGatesUnavailableError, resolveRunPolicyGates } from "./policyGates";
import { editorRunDirectives } from "./hooks/editorDirectives";
import { buildSystemMessages } from "./prompt";
import type { ToolDef } from "./fileTools";
import type { PolicyGate } from "./policy";
import { brainToolCatalog } from "./brainToolCatalog";
import { withWorkspaceStaleness } from "./memoryStaleness";
import { runNativeBrain, type NativeApprovalRequest } from "./nativeBrainRun";

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
/**
 * `runHost` is where this participant's sub-agents run: a child is an ordinary host run
 * with this turn as its owner (`childRunHost.ts`) — there is no second child loop here.
 */
export function createBuilderForceHandler(ctx: vscode.ExtensionContext, runHost?: BrainRunHost): vscode.ChatRequestHandler {
  return async (request, context, stream, token) => {
    const key = await ctx.secrets.get(SECRET_KEY);
    // Resolve per turn so an explicit pick, the active project's Evermind, or the
    // configured default is honored the same way the Brain webview + cloud/on-prem do.
    // Resolved BEFORE the sign-in gate because the answer decides whether that gate
    // applies at all: an on-device model is served by this machine, so a local turn owes
    // nothing to an account. Safe signed out — every lookup inside is best-effort.
    const modelChoice = await resolveModelRoute(ctx.secrets, { turn: true });
    // Local only with nothing on this machine: signing in would not help — offer Hybrid
    // or a download instead.
    if (routeNeedsLocalModel(modelChoice)) {
      streamNoLocalModel(stream);
      return {};
    }
    // Specific model with nothing picked: Specific promises the pick, so it asks for one.
    if (routeNeedsSpecificModel(modelChoice)) {
      streamNoLocalModel(stream, "no_specific_model");
      return {};
    }
    if (!key && routeRequiresSignIn(modelChoice)) {
      stream.markdown(vscode.l10n.t("You're not signed in to BuilderForce."));
      stream.markdown("\n\n");
      stream.button({ command: "builderforce.signIn", title: vscode.l10n.t("Sign in to BuilderForce") });
      return {};
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cfg = vscode.workspace.getConfiguration("builderforce");
    const permissionMode = resolvePermissionMode();

    // Limbic affective layer + PERSONALITY — parity with the webview chat and the cloud
    // (V3) / on-prem agents. The affect is appraised on this machine from the turn's text;
    // the signed-in user's id (session-cached) adds their personality TONE and setpoints.
    // No request per turn; '' at rest with no personality.
    const userId = (await getCurrentUserId(ctx.secrets)) ?? undefined;
    const limbicBlock = await turnLimbicBlock(ctx.secrets, request.prompt, userId ? { userId } : undefined);
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
    const activeProject = selectedProject;
    // Resolve THIS session's chat: reuse the one carried in prior turns' response
    // metadata, else create one (scoped to the active project) so the work this chat does
    // — created tickets, from_delta code-change captures — links back to a conversation,
    // exactly like the webview Brain. The id is the LOCAL chat's view key (PRD 36): it
    // never leaves the machine. Every server-addressed call below uses the chat's bound
    // server id — bound here when signed in — or is not made.
    const local = localBrainApplication(ctx);
    const localPersistence = local.persistence;
    let brainChatId = priorBrainChatId(context.history);
    if (brainChatId != null) {
      try {
        await localPersistence.getChat(brainChatId);
      } catch {
        brainChatId = undefined;
      }
    }
    if (brainChatId == null) {
      const title = request.prompt.trim().slice(0, 80) || vscode.l10n.t("VS Code chat");
      brainChatId = (await localPersistence.createChat({ title, projectId: activeProject?.id ?? null })).id;
    }
    const [serverChatId, clientChatId] = await Promise.all([
      local.identity.bind(brainChatId).catch(() => undefined),
      local.identity.clientIdFor(brainChatId),
    ]);
    const platformContext = selectedProject
      ? await fetchRunContextSection(ctx.secrets, selectedProject.id, {
          ...(serverChatId != null ? { scope: `chat:${serverChatId}` } : {}),
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

    // The SAME brain as the web: local workspace tools (file edits) + Evermind's
    // write-through `remember_fact` + the SHARED, server-side platform catalog
    // (projects, tasks, OKRs, specs, …) fetched from the gateway MCP relay. File tools
    // need a workspace; `remember_fact` needs only a project (works chat-only). Gate
    // each on what it actually requires.
    // The tenant's effective governance gates — the SAME compiled rows the cloud and
    // on-prem loops enforce — so a block/approval gate holds in this editor too.
    // Fail-closed like the server: an unreadable policy refuses the turn. Resolved
    // BEFORE the catalog because a delegated child's write gate is built from them.
    let policyGates: PolicyGate[];
    try {
      policyGates = await resolveRunPolicyGates(ctx.secrets, activeProject?.id);
    } catch (e) {
      if (!(e instanceof PolicyGatesUnavailableError)) throw e;
      stream.markdown(
        `**${vscode.l10n.t("Error:")}** ${vscode.l10n.t("Governance gates could not be loaded, so this turn was not started. Check your connection and try again.")}`,
      );
      return {};
    }

    const runChatId = brainChatId;
    const { systemPrompt, seed } = splitSystemPrompt(messages);
    // Sub-agents run in the editor's run host as ordinary runs owned by THIS turn, and
    // live in its Brain chat. This view cannot render a run cell's confirm, so a child's
    // write prompt is asked through the same modal as this turn's.
    const children = runHost
      ? runHost.childControls(
          { key: runChatId, rootChatId: brainChatId, name: OWNER_NAME, depth: 0 },
          {
            systemPrompt,
            ...(modelChoice.model ? { model: modelChoice.model } : {}),
            modelStrict: modelChoice.modelStrict,
            ...(modelChoice.routingMode ? { routingMode: modelChoice.routingMode } : {}),
            projectId: activeProject?.id ?? null,
            chatMode: "work",
            autoApprove: permissionMode === "acceptEdits",
            evermind: false,
          },
          (req) => confirmToolCall(req, req.agentName),
        )
      : undefined;
    const tools: ToolDef[] = await brainToolCatalog(ctx.secrets, root, activeProject?.id, children, () => runAbortSignal(runChatId));
    // The workspace's committed `.builderforce/` rules + hooks — the same assembly the
    // panel's run host uses.
    const directives = await editorRunDirectives(ctx.workspaceState, root ?? "", "run");

    // What this turn did and read: restated to the model each step by the shared loop,
    // then the note + code map at the end — the same record the panel's runs keep.
    const knowledge = new RunKnowledgeRecorder();
    knowledge.setPrompt(request.prompt);
    try {
      await runNativeBrain({
        knowledge,
        // The local chat's view key is the run's cell key; the server chat (bound above,
        // or null) is what every server-addressed call of the run names (PRD 36).
        chatId: runChatId,
        serverChatId: serverChatId ?? null,
        ...(clientChatId ? { clientChatId } : {}),
        systemPrompt,
        seed,
        userTurn: request.prompt,
        tools,
        root: root ?? "",
        // The code-change backstops need a project. An unbound chat still gets its ticket
        // (on the project, linked to no chat); only the chat-link steps stand down.
        ...(activeProject ? { projectId: activeProject.id } : {}),
        // Memory is scoped to the PROJECT, tiered on the conversation once it is bound.
        ...(activeProject ? { evermind: withWorkspaceStaleness(projectEvermindHooks(ctx.secrets, activeProject.id, serverChatId ?? null), root) } : {}),
        ...(modelChoice.model ? { model: modelChoice.model } : {}),
        modelStrict: modelChoice.modelStrict,
        ...(modelChoice.routingMode ? { routingMode: modelChoice.routingMode } : {}),
        permissionMode,
        ...(policyGates.length ? { policyGates } : {}),
        ...(directives ? { directives } : {}),
        // The transport for this route — gateway or on-device — decided in `modelRouting`,
        // never here. The sign-in gate above guarantees a key on the gateway branch.
        // A Hybrid pick that failed (transport-class) and was answered with Auto says so in
        // the response — the same one line the panel shows; never a silent swap.
        // Every call lands in the chat's run usage ledger — its spend, offline (PRD 36).
        stream: withRunUsage(
          routeStream(modelChoice, key, (event) => {
            stream.markdown(`_${vscode.l10n.t("Your pick {0} failed; answered with Auto.", event.from)}_\n\n`);
          }),
          local.usage,
          { chatId: runChatId, runKey: runChatId, mode: "work" },
        ),
        signal: abort.signal,
        approve: (req: NativeApprovalRequest) => confirmToolCall(req),
        labels: {
          dispatchHint: vscode.l10n.t(
            "_This turn was stopped because its last few tool calls all failed. Read what they answered and reply with what they ask for, or hand the work to a cloud agent from the board so it continues in its own runtime._",
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
          onError: (message, action) => {
            // A turn nothing could take for a reason sign-in won't fix (`no_local_model`,
            // `no_specific_model`) gets its remedies as buttons, not just the sentence.
            if (action?.kind === "no_local_model" || action?.kind === "no_specific_model") {
              stream.markdown("\n\n");
              streamNoLocalModel(stream, action.kind);
              return;
            }
            stream.markdown(`\n\n**${vscode.l10n.t("Error:")}** ${formatChatErrorVerdict(message, action)}\n`);
          },
        },
      });
    } finally {
      // The same run-end step as the panel, even for a turn that threw or was stopped:
      // the workspace note, then — with a project to hold them (the participant's memory
      // is on exactly when it has one) — the code map and the learned facts, into the
      // project this turn STARTED in. Best-effort, like every memory step.
      if (root && !knowledge.isEmpty) {
        await recordEditorRunEnd(ctx.secrets, root, `chat-${brainChatId}`, knowledge, {
          memory: !!activeProject,
          ...(activeProject ? { projectId: activeProject.id } : {}),
        }).catch(() => undefined);
      }
    }

    // Persist into the host's local store first; optional account sync imports the
    // completed history later without replaying its actions or learning side effects.
    if (brainChatId != null) {
      const turns: Array<{ role: string; content: string }> = [{ role: "user", content: request.prompt }];
      if (assistantText.trim()) turns.push({ role: "assistant", content: assistantText });
      await localPersistence.sendMessages(brainChatId, turns);
    }

    // Return the chat id in the result metadata so the NEXT turn of this session
    // resolves the same conversation (see priorBrainChatId).
    return { metadata: { brainChatId } };
  };
}

/**
 * Ask the person about one paused tool call — this turn's own, or (with `agentName`)
 * one of its sub-agents', which may pause after the turn's reply has finished.
 */
async function confirmToolCall(req: NativeApprovalRequest, agentName?: string): Promise<boolean> {
  const prompt = req.gateReason
    ? vscode.l10n.t('Governance: approve "{0}"? {1}', req.label, req.gateReason)
    : agentName
      ? vscode.l10n.t("{0} (a BuilderForce sub-agent) wants to {1}.", agentName, req.label)
      : vscode.l10n.t("BuilderForce wants to {0}.", req.label);
  const apply = vscode.l10n.t("Apply");
  const pick = await vscode.window.showWarningMessage(prompt, { modal: true }, apply, vscode.l10n.t("Skip"));
  return pick === apply;
}

/**
 * Registers BuilderForce in VS Code's native Chat view as `@builderforce` (stable Chat
 * Participant API). Returns the participant so the dedicated session tab can reuse it.
 */
export function registerChatParticipant(ctx: vscode.ExtensionContext, runHost?: BrainRunHost): vscode.ChatParticipant {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, createBuilderForceHandler(ctx, runHost));
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
  return participant;
}
