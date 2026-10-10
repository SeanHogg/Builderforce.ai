import { useCallback, useEffect, useMemo, useState } from 'react';
import { createChatTicketsRestAdapter, useChatParticipants, useRecipientChoice } from '@seanhogg/builderforce-brain-ui';
import {
  nextFallbackModel,
  effortProfile,
  reasoningForRun,
  useToolConfirmationGate,
} from '@seanhogg/builderforce-brain-embedded';
import {
  useBrainChats,
  useBrainConversation,
  useBrainActions,
  useOptionalBrainContext,
  chatRosterFromParticipants,
  useQueuedTurns,
} from '@/lib/brain';
// By path, not via the `@/lib/brain` barrel: the barrel is in the root layout's static
// closure and this module's only consumers load dynamically (check:root-closure).
import { useRegisterInlineBrain } from '@/lib/brain/inlineBrainHost';
import { BRAIN_AUTO_APPROVE_DEFAULT, brainAutoApprovePersistence } from '@/lib/brain/autoApprove';
import { trackActivity } from '@/lib/activity/tracker';
import { useAttention } from '@/lib/useAttention';
import { useChatModelOptions, useLlmModels } from '@/lib/useLlmModels';
import { apiRequest } from '@/lib/apiClient';
import { useAssistantGate } from '@/lib/academic/useAssistantGate';
import type { BrainDockedTab } from '../BrainDockedHeader';
import type { BrainPanelProps } from '../panel/brainPanelTypes';
import { useBrainProjectFilter } from './useBrainProjectFilter';
import { useBrainProjects } from './useBrainProjects';
import { useBrainChatStart } from './useBrainChatStart';
import { useBrainChatHistory } from './useBrainChatHistory';
import { useBrainAccountPreferences } from './useBrainAccountPreferences';
import { useBrainPersona } from './useBrainPersona';
import { useBrainTicketables } from './useBrainTicketables';
import { useBrainSystemContext } from './useBrainSystemContext';
import { useBrainChatMemory } from './useBrainChatMemory';
import { useBrainConsolidateFork } from './useBrainConsolidateFork';
import { useBrainRunTrace } from './useBrainRunTrace';
import { useBrainRepoContext } from './useBrainRepoContext';
import { useBrainPanelSeeds } from './useBrainPanelSeeds';
import { usePinnedProjectChat } from './usePinnedProjectChat';
import { useBrainTimelineBindings } from './useBrainTimelineBindings';
import { useBrainChatRowActions } from './useBrainChatRowActions';
import { useBrainNewProject } from './useBrainNewProject';
import { useBrainCaptureExecution } from './useBrainCaptureExecution';
import { useBrainPanelBanners } from './useBrainPanelBanners';
import { useDockedComposer } from '@/lib/brain/dockedBrain';

/**
 * The ONE Brain panel's state machine: composes the focused hooks (preferences,
 * persona, memory, trace, repo context, seeds, row actions, …) and the shared
 * conversation into a single controller the panel's sections read through
 * `BrainPanelContext`. Renders nothing; every section decides its own visibility.
 */
export function useBrainPanelController({
  variant,
  pinnedProjectId = null,
  viewingProjectId = null,
  modality = 'designer',
  extraSystem,
  initialChatId,
  initialPrompt,
  initialTicket,
  capabilitySurface = 'brainstorm',
  onClose,
  headerContext,
  headerActions,
}: BrainPanelProps) {
  const isPage = variant === 'page';
  // No close handler => the Brain is part of the page's own layout, not the drawer;
  // the floating launcher stands down rather than offer a second copy of this chat.
  useRegisterInlineBrain(!onClose);

  const { filterProjectId, setFilterProjectId } = useBrainProjectFilter();
  const { projects, setProjects, projectName } = useBrainProjects();
  /**
   * Docked drawer sections. Chat history used to be a collapsible strip stacked
   * ABOVE the conversation, which squeezed the thread in a ~440px drawer and hid
   * past chats behind a disclosure; it is now a peer tab of the conversation, so
   * a returning user can reach any earlier chat without giving up thread height.
   * The full-page variant keeps its permanent sidebar and ignores this.
   */
  const [dockedTab, setDockedTab] = useState<BrainDockedTab>('chat');
  const showChatTab = useCallback(() => setDockedTab('chat'), []);

  const { toolSpecs, runTool, isMutating } = useBrainActions();

  // Human-in-the-loop gate: a mutating tool (create/update/delete/run/…) pauses
  // the agent loop for an explicit Approve/Cancel before it runs. The pause +
  // the pending-confirm state now live in the module-level run store (via
  // useBrainConversation below), so the gate survives a Brain-initiated
  // navigation that swaps which panel is mounted — this component only supplies
  // the decision predicate (`needsConfirm`) and renders the prompt.
  //
  // Auto-approve mode lets the user skip the per-action prompt — essential for
  // bulk runs (link 50 tickets, archive 18) where approving each one by hand is
  // unworkable. The gate is the SHARED hook (its ref-backed liveness is what makes a
  // mid-run toggle take effect on the very next tool call); this surface supplies only
  // its own persistence policy.
  const {
    autoApprove,
    setAutoApprove: setAutoApproveMode,
    needsConfirm,
  } = useToolConfirmationGate({
    isMutating,
    persistence: brainAutoApprovePersistence,
    defaultOn: BRAIN_AUTO_APPROVE_DEFAULT,
  });

  const prefs = useBrainAccountPreferences();
  const persona = useBrainPersona({ isPage, pinnedProjectId, modality });

  // Share the live chat selection across co-mounted docked Brain instances (the
  // IDE Designer left-panel and the floating drawer) via BrainContext, so
  // switching chats in one reflects in the other. The full-page Brain Storm
  // route owns its own selection (it's never co-mounted with the drawer).
  const brainCtx = useOptionalBrainContext();
  const syncSelection = !isPage && brainCtx != null;
  const chats = useBrainChats({
    ...(pinnedProjectId != null ? { pinnedProjectId } : { filterProjectId }),
    ...(syncSelection
      ? { activeChatId: brainCtx.activeChatId, onActiveChatChange: brainCtx.setActiveChatId }
      : {}),
  });

  // Mirror the full-page Brain's active chat into the shared BrainContext so a
  // Brain-initiated navigation (which unmounts this route-scoped page) hands the
  // conversation off to the floating drawer — PlatformActionsBridge force-opens
  // it on nav, and it resumes this exact chat instead of a blank one. Docked
  // variants already share the selection via useBrainChats' controlled mode; the
  // page is uncontrolled, so it publishes here.
  const publishActiveChat = brainCtx?.setActiveChatId;
  useEffect(() => {
    if (isPage) publishActiveChat?.(chats.activeChatId);
  }, [isPage, publishActiveChat, chats.activeChatId]);

  const {
    input,
    setInput,
    composerFocusToken,
    startNewChat,
    ensureChatId,
    capabilityId,
    capabilityPrompt,
    selectCapability,
    chatMode,
    selectMode,
    pickWorkOption,
    onboard,
  } = useBrainChatStart({ chats, isPage, setDockedTab });

  // Tell the model which project is in context, so "create a task" / "list
  // specs" without a named project default to it. Chat-FIRST: a chat that belongs
  // to a project (chats.activeChat.projectId) always tells the model about ITS OWN
  // project, regardless of what page/pinned scope the sidebar is currently on — the
  // same resolution evermindProjectId uses. Falls back to the viewed page
  // (viewingProjectId, e.g. the scoped Tasks board) then the IDE's pinned project
  // for a not-yet-scoped chat. Resolve the name from the loaded projects list when
  // available; the id is what the tools actually need. The same resolution scopes
  // the composer's #ticket autocomplete.
  const ctxProjectId = chats.activeChat?.projectId ?? viewingProjectId ?? pinnedProjectId;
  const { ticketables, handleTicketTag } = useBrainTicketables(ctxProjectId, chats.activeChatId);
  // Cross-surface "what's live / what needs me" — decorates each chat row with a
  // status dot (running / needs-answer) that stays live even when another chat is
  // focused. Scoped when a project is in context, tenant-wide on the Brain Storm page.
  const attn = useAttention(ctxProjectId ?? undefined);

  const { ambientSystem, augmentSystemPrompt } = useBrainSystemContext({
    extraSystem,
    capabilityPrompt,
    responseInstructions: prefs.responseInstructions,
    ctxProjectId,
    projects,
    autoApprove,
    effort: prefs.effort,
    webBrowsing: prefs.webBrowsing,
  });

  const memory = useBrainChatMemory({ chats, pinnedProjectId, viewingProjectId });

  // The shared (module-cached) model surface. Read here — ABOVE the conversation hook
  // — because the run loop needs it to fail over when a model will not emit tool
  // calls; the diagnostics capture reads the same cached object.
  const llmModels = useLlmModels();
  const { options: modelOptions, identity: modelIdentity } = useChatModelOptions();
  const { modelSelection } = prefs;
  const selectedModel = modelSelection.mode === 'model' ? modelSelection.model : undefined;
  // Tool-call failover: the SHARED selector over that surface, so "which model next"
  // is decided in one place for every host rather than per surface.
  const pickFallbackModel = useCallback(
    (tried: readonly string[]) => nextFallbackModel({ ...llmModels.fundingSurface, codingModels: llmModels.codingModels }, tried),
    [llmModels],
  );

  const activeChatId = chats.activeChat?.id ?? null;

  /**
   * The ONE chat-scoped REST client this panel uses — the same factory the VS Code
   * webview and the tickets panel build. It backs the participant roster AND the
   * diagnostics capture's chat reads, so both read the endpoints exactly one way.
   * Its agent-pool fetch is lazy and memoised for the adapter's lifetime.
   */
  const ticketAdapter = useMemo(() => createChatTicketsRestAdapter({ request: apiRequest }), []);

  // Multi-party chat: the invited participants of the active chat as addressable
  // recipients — so a message can be sent to a teammate instead of the BRAIN. Bumped on
  // invite/remove.
  //
  // This used to be ~25 lines of state + effect + memo here, a transcription of the
  // SHARED `useChatParticipants` the VS Code webview already called. Same two fetches,
  // same pool cross-reference, same shape out — through a different client, which meant
  // "who is in this chat" had two implementations that only happened to agree. The hook
  // now resolves an agent's name from the invited row the server names, so the pool
  // lookup this copy depended on is not even needed.
  const [participantsRefresh, setParticipantsRefresh] = useState(0);
  const bumpParticipants = useCallback(() => setParticipantsRefresh((n) => n + 1), []);
  const participants = useChatParticipants(ticketAdapter, activeChatId, participantsRefresh);

  const conv = useBrainConversation({
    chatId: chats.activeChatId,
    modality,
    extraSystem: ambientSystem,
    systemPrompt: persona.personaPrompt,
    // An explicit pick wins; otherwise an agent persona runs on the agent's own model.
    model: selectedModel ?? persona.personaModelId,
    modelStrict: modelSelection.mode === 'model',
    routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
    pickFallbackModel: modelSelection.mode === 'model' ? undefined : pickFallbackModel,
    maxTokens: effortProfile(prefs.effort).maxTokens,
    reasoning: reasoningForRun({ effort: prefs.effort, thinking: prefs.thinking }),
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity: chats.touch,
    onFirstUserTurn: chats.autoTitle,
    evermind: memory.gatedEvermind,
    augmentSystemPrompt,
    chatMode,
    // WHO IS IN THIS CHAT. A non-empty roster makes the invited agents the default
    // owners of work-mode work instead of this session (see `chatMode.ts`) — and names
    // them in the prompt, so dispatching costs no discovery call. Derived from the
    // participants the composer already renders, so the agents a user can @-mention are
    // exactly the agents the run is told it may dispatch to.
    chatRoster: chatRosterFromParticipants(participants),
  });

  const { resolveConfirm } = conv;
  // "Approve all": run this action and auto-approve the rest of the run/session.
  const approveAll = useCallback(() => {
    setAutoApproveMode(true);
    resolveConfirm(true);
  }, [setAutoApproveMode, resolveConfirm]);

  const consolidation = useBrainConsolidateFork({ chats, conv, pinnedProjectId, viewingProjectId });
  const timelineTrace = useBrainRunTrace(chats.activeChatId, conv.trace);

  // Who the next message goes to — the shared composer state the editor uses too:
  // reset when switching chats, drops a pick that has since left the roster, and
  // follows a leading @mention when nothing was picked explicitly.
  const { recipient, choose: chooseRecipient } = useRecipientChoice({ participants, input, resetKey: activeChatId });

  const repoContext = useBrainRepoContext({
    repoProjectId: chats.activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null,
    activeChatId: chats.activeChatId,
    attach: conv.attach,
  });

  useBrainPanelSeeds({
    chats, conv, isPage, initialChatId, initialPrompt, initialTicket, pinnedProjectId, viewingProjectId, showChatTab,
  });
  usePinnedProjectChat({
    chats,
    enabled: !isPage && pinnedProjectId != null && initialChatId == null && !initialTicket && !initialPrompt?.trim(),
  });

  const rows = useBrainChatRowActions({ chats, isPage, showChatTab });
  const newProject = useBrainNewProject({ chats, setProjects });
  const timeline = useBrainTimelineBindings({
    conv, chats, recipient, toolSpecs, runTool, bumpParticipants,
  });

  // Messages the user typed while a run was still streaming. Held by the shared
  // queueing primitive and flushed one at a time as each run completes, so the
  // composer NEVER blocks typing while the AI is thinking — the same rule, and
  // the same implementation, as the Creation Canvas composer.
  const queuedTurns = useQueuedTurns({
    running: conv.sending,
    send: (text) => { void conv.send(text, { addressedTo: recipient }); },
    resetKey: chats.activeChat?.id ?? null,
  });

  // The exam gate — the composer already refuses, and so must every other path into a
  // send (a suggestion, a replayed prompt): a refusal, never a silent allow.
  const assistantGate = useAssistantGate();

  // The panel that IS the page's chat (docked, no close) takes text a neighbouring
  // surface hands it: to finish and send (Studio's Media panel "use in app"), or to
  // send now (the preview's "Fix it for me" — the click is the person sending it).
  // A send goes through the same gate and queue as a typed one.
  const { submit: submitQueued } = queuedTurns;
  const dockedComposer = useMemo(() => ({
    seed: (text: string) => { setInput(text); showChatTab(); },
    send: (text: string) => {
      if (!assistantGate.assistantAllowed) return;
      showChatTab();
      if (submitQueued(text)) return;
      void conv.send(text);
    },
  }), [setInput, showChatTab, assistantGate.assistantAllowed, submitQueued, conv]);
  useDockedComposer(!isPage && !onClose, dockedComposer);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !assistantGate.assistantAllowed) return;
    setInput('');
    // Audited engagement signal: interacting with the AI agent is billable activity.
    trackActivity('agent_message', { weight: 2 });
    // A run is already streaming — the queue holds this turn and sends it once
    // the current run finishes, instead of disabling the composer.
    if (queuedTurns.submit(text)) return;
    // Restore the text if the send fails before it's persisted (e.g. an expired
    // session) so the user's message is never silently lost. `addressedTo` routes
    // the turn: a participant is talked to (no BRAIN run); null runs the BRAIN.
    const ok = await conv.send(text, { addressedTo: recipient });
    if (!ok) setInput((cur) => cur || text);
  }, [assistantGate.assistantAllowed, input, setInput, conv, queuedTurns, recipient]);

  const { captureExecution, captureState } = useBrainCaptureExecution({
    chats,
    conv,
    chatMode,
    projects,
    pinnedProjectId,
    viewingProjectId,
    toolSpecs,
    timelineTrace,
    model: selectedModel ?? persona.personaModelId,
    personaLabel: persona.personaLabel,
    llmModels,
    ticketAdapter,
  });

  const { error, dismissError, showProviderCapBanner, dismissProviderCap } = useBrainPanelBanners({ chats, conv });

  const { searchQuery, setSearchQuery, filteredChats, historyUnread } = useBrainChatHistory({
    chatList: chats.chats,
    activeChatId: chats.activeChatId,
    chatUnread: attn.chatUnread,
  });

  return {
    // Surface props
    isPage,
    capabilitySurface,
    pinnedProjectId,
    viewingProjectId,
    onClose,
    headerContext,
    headerActions,
    // Chats + conversation
    chats,
    conv,
    filteredChats,
    searchQuery,
    setSearchQuery,
    startNewChat,
    attn,
    historyUnread,
    dockedTab,
    setDockedTab,
    rows,
    // Projects
    projects,
    projectName,
    filterProjectId,
    setFilterProjectId,
    ctxProjectId,
    newProject,
    // Composer
    input,
    setInput,
    handleSend,
    composerFocusToken,
    queuedCount: queuedTurns.count,
    prefs,
    modelOptions,
    modelIdentity,
    autoApprove,
    setAutoApproveMode,
    approveAll,
    chatMode,
    selectMode,
    pickWorkOption,
    onboard,
    capabilityId,
    selectCapability,
    persona,
    memory,
    consolidation,
    participants,
    recipient,
    chooseRecipient,
    ticketables,
    handleTicketTag,
    repoContext,
    // Transcript
    timeline,
    timelineTrace,
    // Banners
    error,
    dismissError,
    showProviderCapBanner,
    dismissProviderCap,
    // Capture
    captureExecution,
    captureState,
  };
}

export type BrainPanelController = ReturnType<typeof useBrainPanelController>;
