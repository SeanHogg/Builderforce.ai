/**
 * THE EDITOR'S CHAT SURFACE — the conversation, as one surface of the one canvas.
 *
 * ── WHAT IT IS NOW ───────────────────────────────────────────────────────────────
 * This used to be a whole webview: its own bundle, its own panel, its own tab, sitting
 * beside a separate Creation Canvas tab. That said a chat and a canvas were different
 * kinds of place, which the product does not believe — `frontend/src/lib/canvasSurfaces.ts`
 * has declared chat "the zero-object case of the board" since the surface registry
 * landed. The editor now renders ONE panel whose centre is whichever surface you are
 * on, and this component is what the canvas draws when that surface is `chat`, handed
 * in through `CreationCanvas`'s `hostSurfaces` prop.
 *
 * ── WHY THE EDITOR SUPPLIES ITS OWN INSTEAD OF USING THE WEB'S ───────────────────
 * The web's `CanvasChatSurface` renders a transcript driven by `runCreationCanvasAi`,
 * which runs the turn in the page. That is the wrong runtime here, and the difference
 * is the whole point of the extension: runs execute in the EXTENSION HOST
 * (`src/brainRunHost.ts`), so closing the tab does not kill the agent editing your
 * files, and the tools it calls reach the real workspace — local file writes, the
 * problems list, the repository, auto-approve, the pending-changes rail.
 *
 * That runtime cannot be reached from inside a shared web component, and it should not
 * be: the web has no extension host to talk to. So the canvas keeps the board, the
 * surface switcher, the session, the palette and every other surface, and hands ONE of
 * them to the host. It is one surface implemented differently, not a second canvas.
 *
 * ── WHY IT MOUNTS ITS OWN COMPOSER ───────────────────────────────────────────────
 * For the same reason. The canvas's composer is wired to the in-page runtime, so
 * `CreationCanvas` stands it down while a host surface is on screen (see
 * `hostOwnsSurface` there) — two inputs that started different kinds of run would be
 * the worst of both. This surface mounts the SAME shared `BrainComposer`
 * (`VsCodeComposer`), wired to the host's runtime instead.
 *
 * ── HOW IT IS BUILT ──────────────────────────────────────────────────────────────
 * The body is THE shared `AiSurface` (header · rail · thread or empty state · notices ·
 * footer), each slot a shared part bound here. This file is the container: the state
 * and its wiring live in sibling hooks (`useChatSystemPrompt`, `useChatMemory`,
 * `useTicketRail`, `useChatAudience`, `useChatSend`, `useCopyDiagnostics`,
 * `useSessionActions`, `useHostIntents`) and the presentational pieces beside them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useBrainConversation,
  useBrainConfig,
  effortProfile,
  useToolConfirmationGate,
  reasoningForRun,
  lastServedModel,
  type ChatRosterAgent,
} from '@seanhogg/builderforce-brain-embedded';
import {
  AiSurface, BrainTimeline, ChatTicketsPanel, PendingQuestionBanner, SurfaceFooter, ToolConfirmBar,
  askUserAnchorId, selectPendingAskUser,
} from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from '../authedFetch';
import { getToken, post, refreshToken, type InitData } from '../vscodeBridge';
import { setHostRunContext } from '../hostRunDriver';
import { autoApprovePersistence } from '../autoApprove';
import { makeT, promptMenuLabels, timelineLabels } from './chatLabels';
import { EditorEmptyState } from './editorStarters';
import { SubagentStrip } from './SubagentStrip';
import { useChatAudience } from './useChatAudience';
import { useChatMemory } from './useChatMemory';
import { useChatSend } from './useChatSend';
import { useAssociatedProject, useChatSystemPrompt } from './useChatSystemPrompt';
import { useComposerModels } from './useComposerModels';
import { useCopyDiagnostics } from './useCopyDiagnostics';
import { useHostIntents } from './useHostIntents';
import { useRunShaping } from './useRunShaping';
import { useChatVisibility, useSessionActions } from './useSessionActions';
import { useTicketRail } from './useTicketRail';
import { useChatHistoryView } from './useChatHistoryView';
import { useVsCodeChats } from './useVsCodeChats';
import { VsCodeChatHeader } from './VsCodeChatHeader';
import { VsCodeChatHistory } from './VsCodeChatHistory';
import { VsCodeChatNotices } from './VsCodeChatNotices';
import { VsCodeComposer } from './VsCodeComposer';

const HISTORY_ID = 'bf-chat-history';

export function VsCodeChatSurface({ init }: { init: InitData }) {
  const t = useMemo(() => makeT(init.labels), [init.labels]);
  const { persistence } = useBrainConfig();
  // The conversation list — the shared `useBrainChats` plus the editor's own bindings.
  const vsChats = useVsCodeChats(init, t('app.newChat', 'New chat'));
  const {
    chatId, setChatId, chats, chatOptions, activeChat, reloadChats, onFirstUserTurn, ensureChatId,
    runStatus, titleOf, chatMode, selectMode, setMemoryEnabled: persistMemory, armMemory,
  } = vsChats;
  // The header's History lever swaps the body to the chat list; opening a chat closes it.
  const { historyOpen, toggleHistory, openChat, rows } = useChatHistoryView(vsChats);

  // Auto-approve skips the per-action confirm prompt. The gate is the SHARED hook (the
  // flag is read through a REF, because a run's tool loop captures `needsConfirm` at run
  // START). Persisted per surface policy: off by default in the editor, where a mutating
  // tool touches the real working tree; `defaultOn` carries the SETTING so a change
  // reaches an open panel. The predicate itself is evaluated by the host
  // (`nativeNeedsConfirm`); this panel owns the switch and tells the host when it moves.
  const autoApproveSetting = init.autoApproveDefault ?? false;
  const { autoApprove, setAutoApprove: setAutoApproveMode } = useToolConfirmationGate({
    isMutating: () => true,
    persistence: useMemo(() => autoApprovePersistence(autoApproveSetting), [autoApproveSetting]),
    defaultOn: autoApproveSetting,
  });
  const [input, setInput] = useState('');
  const [focusToken, setFocusToken] = useState(0);
  // Stable reference so a keystroke does not hand <BrainTimeline> a fresh `labels` object
  // and defeat its React.memo (every message's markdown re-parsing per character).
  const tlLabels = useMemo(() => timelineLabels(init.labels), [init.labels]);
  // Composer run-shaping toggles (Effort / Thinking / Browse the web) — REAL request params.
  const shaping = useRunShaping();
  const { effort, thinking, webBrowsing } = shaping;
  // The webview reaches /api/brain directly (CORS allows the webview origin).
  const apiReq = useMemo(() => authedFetch(init.baseUrl, getToken, () => void refreshToken()), [init.baseUrl]);

  const { chatVisibility, setChatVisibility, chatIsOwner } = useChatVisibility(chatId, persistence);
  const { associatedProjectId, associatedProject } = useAssociatedProject(init, activeChat);
  const { extraSystem, setTurnLimbic, persona, setPersona, personaAgents, personaModelId } = useChatSystemPrompt({
    init, apiReq, associatedProject, effort, webBrowsing,
  });

  // `maxTokens` is a universal param so the client owns it; `reasoning` is vendor-NEUTRAL
  // intent the gateway maps against the model it actually resolves.
  const effortMaxTokens = effortProfile(effort).maxTokens;
  const reasoning = useMemo(() => reasoningForRun({ effort, thinking }), [effort, thinking]);

  // Which models this tenant may run, which one is in force and who pays for it. Keyed on
  // the host's bundle, not on `t` (rebuilt every render), so the catalogue fetch re-runs
  // on a new init frame rather than on every keystroke.
  const paidCostDetail = useMemo(
    () => promptMenuLabels(makeT(init.labels), init.modelLabels).paidCostDetail,
    [init.labels, init.modelLabels],
  );
  const models = useComposerModels(init, apiReq, paidCostDetail);
  const { modelSurface, composerModels, pickFallbackModel } = models;
  // The host runs the loop, so it needs what only this panel knows: WHICH chat it shows,
  // the Auto-mode switch, and the picker's surface (its stall failover ordering).
  useEffect(() => {
    setHostRunContext({ chatId, autoApprove, modelSurface });
  }, [chatId, autoApprove, modelSurface]);

  const { memoryEnabled, setMemoryEnabled, evermind } = useChatMemory({
    init, chatId, activeChat, projectId: associatedProjectId, persistence, reloadChats, persistMemory, armMemory,
  });

  // The roster the RUN is told about, mirrored into state (see `useChatAudience`).
  const [chatRoster, setChatRoster] = useState<ChatRosterAgent[]>([]);

  const conv = useBrainConversation({
    chatId,
    modality: 'ide',
    // The chat's project powers the run loop's "a code change is always tied to a ticket"
    // backstop (a from_delta ticket for this project, linked to the chat).
    projectId: associatedProjectId,
    // A strict pin wins; otherwise an agent persona runs on the agent's own model.
    model: init.modelStrict ? init.model : (personaModelId ?? init.model),
    modelStrict: init.modelStrict,
    routingMode: init.routingMode ?? 'auto',
    // A model that burns its stall budget describing tool calls it never makes is
    // switched by the run itself, over the surface already loaded for the picker.
    pickFallbackModel: init.modelStrict ? undefined : pickFallbackModel,
    maxTokens: effortMaxTokens,
    reasoning,
    extraSystem,
    ensureChatId,
    onActivity: reloadChats,
    onFirstUserTurn,
    evermind,
    // The conversation's own mode decides which directive rides the turn (`chatModeDirective`).
    chatMode,
    // WHO IS IN THIS CHAT: invited agents become the default owners of work-mode work and
    // are named in the prompt — without it the IDE session made every change itself.
    chatRoster,
  });

  const rail = useTicketRail({ init, apiReq, chatId, chats, reloadChats, reloadMessages: conv.reloadMessages });
  const { ticketAdapter, ticketRefresh, linkOpenedTicket } = rail;
  // A host intent switches chat the way a row does: History closes onto it.
  useHostIntents({ persistence, projectId: init.project?.id ?? null, setChatId: openChat, setInput, reloadChats, linkOpenedTicket, t });

  // Multi-party chat: who a message goes to (the BRAIN executes; an invited agent/human is
  // talked to), and the live sub-agents a message can steer.
  const audience = useChatAudience({ ticketAdapter, chatId, messages: conv.messages, ticketRefresh, input, onRoster: setChatRoster });
  const { participants, liveChildren, mentionable, recipient, chooseRecipient } = audience;

  // A run's steps are persisted as durable step rows by the run loop the HOST drives
  // (`brainRunHost.ts`), not here: runs outlive this view.
  const { queued, submit, answerQuestion, replayMessage } = useChatSend({
    conv, chatId, input, setInput, recipient, liveChildren, setTurnLimbic, reloadChats,
  });

  // The question this chat is BLOCKED on, restated at the composer — one shared predicate,
  // so banner and card never disagree.
  const pendingQuestion = useMemo(() => selectPendingAskUser(conv.messages), [conv.messages]);
  // What actually answered, not what was requested (under auto `init.model` is the plan default).
  const servedModel = useMemo(() => lastServedModel(conv.messages), [conv.messages]);
  const askLabels = useMemo(
    () => ({
      askSubmit: t('tl.askSubmit', 'Send'),
      askAnswered: t('tl.askAnswered', 'Answered'),
      askPending: t('app.askPending', 'Answer needed'),
      askJumpTo: t('app.askJumpTo', 'Show in conversation'),
      askDismiss: t('app.dismiss', 'Dismiss'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [init.labels],
  );
  const revealQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    document
      .getElementById(askUserAnchorId(pendingQuestion.messageId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pendingQuestion]);

  const { copyState, canCopy, copyTranscript } = useCopyDiagnostics({
    init, conv, chatId, activeChat, chatVisibility, chatMode, associatedProject, associatedProjectId,
    modelSurface, ticketAdapter, apiReq, t,
  });
  const session = useSessionActions({
    chatId, conv, persistence, activeChat, fallbackProjectId: init.project?.id ?? null, setChatId, reloadChats, t,
  });

  // A starter seeds the box (the person edits and sends it) and hands it focus.
  const pickStarter = useCallback((prompt: string) => { setInput(prompt); setFocusToken((n) => n + 1); }, []);

  return (
    <AiSurface
      className="bf-app"
      label={t('app.conversation', 'Conversation')}
      header={(
        <VsCodeChatHeader
          projectName={associatedProject?.name ?? null}
          chatTitle={activeChat ? titleOf(activeChat) : t('app.newChat', 'New chat')}
          running={conv.sending}
          copy={{ state: copyState, enabled: canCopy, onCopy: () => void copyTranscript() }}
          history={{ open: historyOpen, onToggle: toggleHistory, controls: HISTORY_ID }}
          onNewChat={() => openChat(null)}
          t={t}
        />
      )}
      rail={chatId != null && !historyOpen && (
        <ChatTicketsPanel
          chatId={chatId}
          projectId={init.project?.id ?? null}
          chatList={rail.ticketChatList}
          adapter={ticketAdapter}
          labels={rail.ticketLabels}
          onChanged={rail.onTicketsChanged}
          refreshSignal={audience.railRefresh}
          visibility={chatVisibility}
          onSetVisibility={chatIsOwner ? async (v) => { await persistence.updateChat(chatId, { visibility: v }); setChatVisibility(v); } : undefined}
          onOpenTicket={(tk) => post('open.artifact', { kind: tk.kind, ref: tk.ref, projectId: init.project?.id ?? undefined })}
          // "Changes (N)" beside Link ticket / Agents / People; a clean tree adds nothing.
          extensions={rail.pendingChangesExtension ? [rail.pendingChangesExtension] : undefined}
          subagents={audience.subagentRoster}
          // What this conversation cost and what memory saved — rides the chat row.
          spend={activeChat?.spend}
          spendLabels={rail.spendLabels}
          locale={init.locale}
        />
      )}
      empty={historyOpen ? (
        <VsCodeChatHistory
          id={HISTORY_ID}
          chats={chatOptions}
          loading={vsChats.loading}
          activeId={chatId}
          titleOf={titleOf}
          runStatus={runStatus}
          rows={rows}
          t={t}
        />
      ) : chatId == null ? <EditorEmptyState t={t} onPick={pickStarter} /> : undefined}
      thread={(
        <BrainTimeline
          messages={conv.messages}
          trace={conv.trace}
          streamingText={conv.sending ? conv.streamingText : ''}
          isRunning={conv.sending}
          activity={conv.activity}
          loading={conv.loadingMessages}
          assistantName="BuilderForce"
          labels={tlLabels}
          modelIdentity={composerModels?.identity}
          onAnswerQuestion={answerQuestion}
          onReplayMessage={replayMessage}
          onRateMessage={conv.rateMessage}
          ratings={conv.ratings}
        />
      )}
      notices={<VsCodeChatNotices conv={conv} chatsError={vsChats.error} onDismissChatsError={vsChats.clearError} t={t} />}
      footer={(
        <SurfaceFooter
          // The chat's live sub-agents: who works for whom, and the owner's levers.
          above={<SubagentStrip chatId={chatId} labels={init.labels} liveLabels={tlLabels.live} />}
          confirm={conv.pendingConfirm && (
            <ToolConfirmBar
              req={conv.pendingConfirm}
              onApprove={() => conv.resolveConfirm(true)}
              onDeny={() => conv.resolveConfirm(false)}
              // "Always" turns on auto-approve and lets this one through.
              onApproveAll={() => { setAutoApproveMode(true); conv.resolveConfirm(true); }}
              labels={{
                prompt: t('app.confirmRun', 'Run {name}?'),
                approve: t('app.approve', 'Approve'),
                approveAll: t('app.always', 'Always'),
                deny: t('app.cancel', 'Cancel'),
                aria: t('app.confirmAria', 'Approve this action'),
              }}
            />
          )}
          question={pendingQuestion && (
            <PendingQuestionBanner
              key={pendingQuestion.messageId}
              payload={pendingQuestion.payload}
              labels={askLabels}
              onAnswer={answerQuestion}
              onReveal={revealQuestion}
            />
          )}
          composer={(
            <VsCodeComposer
              init={init}
              apiReq={apiReq}
              conv={conv}
              value={input}
              onChange={setInput}
              onSubmit={submit}
              focusToken={focusToken}
              chatId={chatId}
              projectId={associatedProjectId}
              ensureChatId={ensureChatId}
              ticketAdapter={ticketAdapter}
              ticketRefresh={ticketRefresh}
              onTicketLinked={rail.bumpTicketRefresh}
              participants={participants}
              mentionable={mentionable}
              hasLiveChildren={liveChildren.length > 0}
              recipient={recipient}
              chooseRecipient={chooseRecipient}
              persona={persona}
              onPersona={setPersona}
              personaAgents={personaAgents}
              queue={queued.items}
              onRemoveQueued={queued.remove}
              mode={{ value: chatMode, onChange: selectMode }}
              memory={{ enabled: memoryEnabled, onChange: setMemoryEnabled }}
              shaping={shaping}
              models={models}
              servedModel={servedModel}
              autoMode={{ enabled: autoApprove, onChange: setAutoApproveMode }}
              session={session}
              // The empty state shows the same starters as tiles.
              suggest={chatId != null}
            />
          )}
        />
      )}
    />
  );
}
