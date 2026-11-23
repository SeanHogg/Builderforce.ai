import * as vscode from "vscode";
import { isRunning, type BrainRunOpening, type ChatCompletionMessage } from "@seanhogg/builderforce-brain-embedded";
import { SECRET_KEY } from "./gateway";
import { turnLimbicBlock } from "./personalityLimbic";
import { resolveModelRoute, routeNeedsLocalModel, routeNeedsSpecificModel, routeRequiresSignIn } from "./modelRouting";
import { streamNoLocalModel } from "./noLocalModelPrompt";
import type { BrainRunHost } from "./brainRunHost";
import { permissionMode as resolvePermissionMode } from "./permissionMode";
import { getCurrentUserId, updateBrainChatProject } from "./bfApi";
import { createNativeProjectAdopter } from "./nativeChatProject";
import { localBrainApplication } from "./localFirstStore";
import { formatChatErrorVerdict } from "./upgradeAction";
import { getGroundingWithHistory } from "./grounding";
import { getEditorContextLive } from "./editorContext";
import { getSelectedProject } from "./projectState";
import { PolicyGatesUnavailableError, resolveRunPolicyGates } from "./policyGates";
import type { NativeApprovalRequest } from "./nativeRunTypes";
import { runViaHost } from "./participantRun";
import { hostLog } from "./hostLog";
import { referencesTurnBlock, workspaceReferenceReader } from "./chatReferences";
import { hostIngressDeps, routeMentionBudget } from "./hostIngress";
import { whereDefinedOnce } from "./contextPack/preSearchSource";
import { CONTEXT_PACK_DEADLINE_MS } from "./contextPack/deadline";
import { priorBrainChatId } from "./participantSession";
import { installRunRecovery } from "./installRunRecovery";

const PARTICIPANT_ID = "builderforce.agent";

/** Said when the chat's previous request is still in flight (read per use, so it follows the UI language). */
const ALREADY_RUNNING = (): string =>
  vscode.l10n.t("BuilderForce is still working on this chat's previous request. Wait for it to finish or stop it, then ask again.");

/**
 * The shared chat request handler — drives the agent loop and streams into a
 * ChatResponseStream. Used by BOTH the native @builderforce participant and the
 * dedicated chat-session tab (so there is one implementation).
 */
/**
 * `runHost` is where this participant's turn runs - the ONE host start the panel uses (`participantRun.ts`) - and where its sub-agents run: a child is an ordinary host run
 * with this turn as its owner (`childRunHost.ts`) — there is no second child loop here.
 */
export function createBuilderForceHandler(ctx: vscode.ExtensionContext, runHost: BrainRunHost): vscode.ChatRequestHandler {
  const adoptSelectedProject = createNativeProjectAdopter();
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
    const editorCtx = await getEditorContextLive();
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
    const serverChatId = await local.identity.bind(brainChatId).catch(() => undefined);
    // A chat with no project trains no Evermind: bind the IDE's selected project onto it
    // (once per chat, best-effort) so the NEXT turn does. No selection leaves it global.
    await adoptSelectedProject({
      persistence: localPersistence,
      bindServerProject: (id, projectId) => updateBrainChatProject(ctx.secrets, id, projectId),
      chatId: brainChatId,
      serverChatId,
      projectId: activeProject?.id,
    }).catch(() => undefined);
    // The opening prompt is built from DATA, exactly as the panel's is (`assembleOpening`): the host adds the gates, the rules and the
    // run context (strategy / PRD / project memory) it owns; this turn sends only what it knows.
    const grounding = await getGroundingWithHistory(root);
    const opening: BrainRunOpening = {
      hasWorkspace: !!root,
      ...(grounding ? { grounding } : {}),
      ...(editorCtx ? { editorContext: editorCtx } : {}),
      ...(selectedProject ? { project: selectedProject } : {}),
      ...(limbicBlock ? { limbic: limbicBlock } : {}),
    };
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

    const abort = new AbortController();
    // The tenant's governance gates are read here to FAIL CLOSED with a localized refusal before anything starts: an unreadable
    // policy refuses the turn. The host reads them again for the run (`resolveRunPolicyGates`: the same cache window, no second round-trip).
    try {
      await resolveRunPolicyGates(ctx.secrets, activeProject?.id);
    } catch (e) {
      if (!(e instanceof PolicyGatesUnavailableError)) throw e;
      stream.markdown(
        `**${vscode.l10n.t("Error:")}** ${vscode.l10n.t("Governance gates could not be loaded, so this turn was not started. Check your connection and try again.")}`,
      );
      return {};
    }

    // The chat already has a run in flight (this participant's last turn, the panel's): say so
    // BEFORE anything is looked up or saved - right after the fail-closed policy, ahead of the tool
    // catalog, the workspace's rules, the sub-agent controls and the `#file` references: a refused turn
    // reads nothing and leaves no user row behind. (`runViaHost` checks again at the claim.)
    if (isRunning(brainChatId) || runHost.isBusy(brainChatId)) {
      stream.markdown(`**${vscode.l10n.t("Error:")}** ${ALREADY_RUNNING()}`);
      return { metadata: { brainChatId } };
    }
    // "Where is X defined?" answered from the symbol index for the `#file` reference read below
    // - the same memoized computation the run's PreFetch gate asks (`runSetupPorts.ts`), so it
    // runs once per request.
    const deterministicAnswer = root ? () => whereDefinedOnce(root, request.prompt, CONTEXT_PACK_DEADLINE_MS) : undefined;
    // `#file` / `#selection` references, inlined into the turn under the route's mention
    // budget (long prose compressed first) — the panel's attachment ingress. Started now,
    // overlapping the setup below; never read for a turn answered without a model, and
    // abandoned once the request is cancelled.
    const referencedReady = referencesTurnBlock(request.references, {
      reader: workspaceReferenceReader(),
      budget: () => routeMentionBudget(modelChoice),
      deps: hostIngressDeps(),
      ...(deterministicAnswer ? { deterministicAnswer } : {}),
      cancelled: () => token.isCancellationRequested,
    }).catch(() => "");
    const runChatId = brainChatId;
    const referenced = await referencedReady;
    if (token.isCancellationRequested) return {};
    // The restart-recovery journal (G22): surface a run of THIS chat the previous editor session left in flight (marked
    // `interrupted` by activation recovery) - reported, never silently forgotten. Only the chat's own run is announced. The
    // run's OWN journal (start, checkpoints, terminal status) is the host's (`hostRunLifecycle.ts`), written by its gated start.
    const recovery = installRunRecovery(ctx);
    void recovery.recovered
      .then((runs) => {
        const mine = runs.find((run) => String(run.record.payload.chatId ?? "") === String(runChatId));
        if (!mine) return;
        const safe = recovery.safeToResume(mine);
        stream.markdown(
          `\n\n_${vscode.l10n.t(
            "A previous BuilderForce run in this chat was interrupted when VS Code restarted.{0}",
            safe
              ? vscode.l10n.t(" Its last step was safe to resume; ask again and the work continues.")
              : vscode.l10n.t(" Re-ask and the work resumes from where it stopped."),
          )}_\n`,
        );
      })
      .catch((e: unknown) => hostLog(`[chat participant] the interrupted-run notice failed: ${String(e)}`)); // best-effort; never fails the turn
    // The turn starts as every host run starts - `runHost.start` (the gated start; entry point "vscode"). The host builds the tools,
    // the workspace's rules and hooks, the governance gates, the run setup, the ship ports and the stream from its own ports, and
    // persists the turn through the chat's store; this view only renders it.
    const claimed = await runViaHost({
      host: runHost,
      spec: {
        chatId: runChatId,
        // No prompt text: `assembleOpening` builds the opening from `opening` (the panel's path).
        systemPrompt: "",
        opening,
        seed,
        // The person's own words: the persisted row, the route and PreFetch read these. The `#file` references ride the turn context.
        userTurn: request.prompt,
        ...(referenced ? { turnContext: referenced } : {}),
        projectId: activeProject?.id ?? null,
        chatMode: "work",
        autoApprove: permissionMode === "acceptEdits",
        // Memory is scoped to the PROJECT: on exactly when the chat has one.
        evermind: !!activeProject,
        // Its turn belongs to this chat view: a sub-agent's report waits for the next turn instead of waking a run.
        wakeable: false,
        ...(modelChoice.model ? { model: modelChoice.model } : {}),
        modelStrict: modelChoice.modelStrict,
        ...(modelChoice.routingMode ? { routingMode: modelChoice.routingMode } : {}),
      },
      approve: (req) => confirmToolCall(req, req.agentName),
      onModelFallback: (from, reason) => stream.markdown(`_${vscode.l10n.t("Your pick {0} failed; answered with Auto.", from)}${reason ? ` (${reason})` : ""}_\n\n`),
      signal: abort.signal,
      labels: {
        dispatchHint: vscode.l10n.t(
          "_This turn was stopped because its last few tool calls all failed. Read what they answered and reply with what they ask for, or hand the work to a cloud agent from the board so it continues in its own runtime._",
        ),
        alreadyRunning: ALREADY_RUNNING(),
      },
      events: {
        onText: (delta) => stream.markdown(delta),
        onToolStart: (label) => stream.progress(label),
        onToolResult: (label, ok) => stream.markdown(`\n\n${ok ? "✓" : "✗"} ${label}\n\n`),
        // An entitlement failure gets the fix appended as a link (Upgrade / Add a card) - the verdict the webview banner renders as a button.
        onError: (message, action) => {
          // A turn nothing could take for a reason sign-in won't fix (`no_local_model`, `no_specific_model`) gets its remedies as buttons.
          if (action?.kind === "no_local_model" || action?.kind === "no_specific_model") {
            stream.markdown("\n\n");
            streamNoLocalModel(stream, action.kind);
            return;
          }
          stream.markdown(`\n\n**${vscode.l10n.t("Error:")}** ${formatChatErrorVerdict(message, action)}\n`);
        },
      },
    });
    // The host's run recorded and saved the turn itself (rows, the session note, what it learned): nothing here writes it again.
    if (!claimed) return { metadata: { brainChatId } };

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
  // A gated publish carries the ship gate's evidence line — what was verified, what could not run (OD-3).
  const options = req.evidence ? { modal: true, detail: vscode.l10n.t("Checks: {0}", req.evidence) } : { modal: true };
  const pick = await vscode.window.showWarningMessage(prompt, options, apply, vscode.l10n.t("Skip"));
  return pick === apply;
}

/**
 * Registers BuilderForce in VS Code's native Chat view as `@builderforce` (stable Chat
 * Participant API). Returns the participant so the dedicated session tab can reuse it.
 */
export function registerChatParticipant(ctx: vscode.ExtensionContext, runHost: BrainRunHost): vscode.ChatParticipant {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, createBuilderForceHandler(ctx, runHost));
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
  return participant;
}
