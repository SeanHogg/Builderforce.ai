import { useCallback, useEffect, useId, useState } from 'react';
import { useRecipientChoice } from '@seanhogg/builderforce-brain-ui';
import {
  effortProfile,
  reasoningForRun,
  useRunRefreshTick,
  useToolConfirmationGate,
} from '@seanhogg/builderforce-brain-embedded';
import {
  useBrainChats,
  useBrainConversation,
  useBrainActions,
  useOptionalBrainContext,
  chatRosterFromParticipants,
} from '@/lib/brain';
// By path, not via the `@/lib/brain` barrel: the barrel is in the root layout's static
// closure and this module's only consumers load dynamically (check:root-closure).
import { useRegisterInlineBrain } from '@/lib/brain/inlineBrainHost';
import { BRAIN_AUTO_APPROVE_DEFAULT, brainAutoApprovePersistence } from '@/lib/brain/autoApprove';
import { useAttention } from '@/lib/useAttention';
/** The docked panel shows the conversation or, toggled from the header, the chat list. */
export type BrainDockedTab = 'chat' | 'history';
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
import { useBrainRepoContext } from './useBrainRepoContext';
import { useBrainPanelSeeds } from './useBrainPanelSeeds';
import { usePinnedProjectChat } from './usePinnedProjectChat';
import { useBrainTimelineBindings } from './useBrainTimelineBindings';
import { useBrainChatRowActions } from './useBrainChatRowActions';
import { useBrainNewProject } from './useBrainNewProject';
import { useBrainCaptureExecution } from './useBrainCaptureExecution';
import { useBrainPanelBanners } from './useBrainPanelBanners';
import { useBrainPanelModels } from './useBrainPanelModels';
import { useBrainPanelParticipants } from './useBrainPanelParticipants';
import { useBrainPanelTurns } from './useBrainPanelTurns';
import { routingModeForSelection } from '@seanhogg/builderforce-brain-embedded';
import { useWebTurnGate } from '@/lib/localFirst/useWebInferenceMode';
import { useWebKnowledgePrefetch } from '@/lib/knowledge/useWebKnowledgePrefetch';

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
  // THIS panel's composer, as its error banner names it to open its `/` menu (a page
  // can hold the full Brain and the drawer at once — a remedy opens only its own).
  const composerId = useId();

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
    onFirstUserTurn,
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

  // Read ABOVE the conversation hook: the run loop needs the model surface to fail over
  // when a model will not emit tool calls.
  const { modelSelection } = prefs;
  const { llmModels, modelOptions, modelIdentity, selectedModel, pickFallbackModel, windowSources } = useBrainPanelModels(modelSelection);

  const activeChatId = chats.activeChat?.id ?? null;
  const { ticketAdapter, participants, bumpParticipants } = useBrainPanelParticipants(activeChatId);

  // `/review`, `/graph` and knowledge questions about the project in context (PRD 38 §3.1).
  const knowledgePrefetch = useWebKnowledgePrefetch(ctxProjectId ?? null);

  const conv = useBrainConversation({
    chatId: chats.activeChatId,
    prepareRun: knowledgePrefetch.prepareRun,
    modality,
    extraSystem: ambientSystem,
    systemPrompt: persona.personaPrompt,
    // An explicit pick wins; otherwise an agent persona runs on the agent's own model.
    model: selectedModel ?? persona.personaModelId,
    modelStrict: modelSelection.mode === 'model',
    routingMode: routingModeForSelection(modelSelection),
    pickFallbackModel: modelSelection.mode === 'model' ? undefined : pickFallbackModel,
    windowSources,
    maxTokens: effortProfile(prefs.effort).maxTokens,
    reasoning: reasoningForRun({ effort: prefs.effort, thinking: prefs.thinking }),
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity: chats.touch,
    onFirstUserTurn,
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
  // The chat row's spend follows the shared run beat — re-read as a long run goes, not
  // only when it settles (`onActivity` above covers the settle).
  const refreshTick = useRunRefreshTick(conv.sending);
  const { reload: reloadChats } = chats;
  useEffect(() => { if (refreshTick > 0) void reloadChats(); }, [refreshTick, reloadChats]);

  // "Approve all": auto-approve the rest of the run/session. The approval bar
  // (`RunConfirmBar`) lets the pending call through itself.
  const approveAll = useCallback(() => {
    setAutoApproveMode(true);
  }, [setAutoApproveMode]);

  const consolidation = useBrainConsolidateFork({ chats, conv, pinnedProjectId, viewingProjectId });
  // The timeline renders the chat's durable step rows from `conv.messages` and dedupes
  // them against this LIVE run trace (`buildSettledTimeline`) — one store, nothing to
  // rehydrate.
  const timelineTrace = conv.trace;

  // Who the next message goes to — the shared composer state the editor uses too:
  // reset when switching chats, drops a pick that has since left the roster, and
  // follows a leading @mention when nothing was picked explicitly.
  const { recipient, choose: chooseRecipient } = useRecipientChoice({ participants, input, resetKey: activeChatId });

  const repoContext = useBrainRepoContext({
    repoProjectId: chats.activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null,
    activeChatId: chats.activeChatId,
    attach: conv.attach,
  });

  // THE first-run gate for every turn this panel starts — its seed prompt here, and its
  // composer's Send (handed over as `modeGate`), so the question shows in one place.
  const { gate: modeGate } = useWebTurnGate();
  useBrainPanelSeeds({
    chats, conv, isPage, initialChatId, initialPrompt, initialTicket, pinnedProjectId, viewingProjectId, showChatTab,
    requestTurn: modeGate.request,
  });
  usePinnedProjectChat({
    chats,
    enabled: !isPage && pinnedProjectId != null && initialChatId == null && !initialTicket && !initialPrompt?.trim(),
  });

  const rows = useBrainChatRowActions({ chats, isPage, showChatTab });
  const newProject = useBrainNewProject({ chats, setProjects });
  // THE ONE turn door (shared with every composer host), the exam gate, and text a
  // neighbouring surface hands the page's chat (docked, no close).
  const { queued, submitTurn, stopTurn, handleSend } = useBrainPanelTurns({
    conv, chats, recipient, input, setInput, showChatTab, acceptsHandover: !isPage && !onClose,
  });
  // After the door: an answered question or a replay is a turn like a typed one, and
  // queues behind a running turn the same way.
  const timeline = useBrainTimelineBindings({
    conv, chats, recipient, toolSpecs, runTool, bumpParticipants, submitTurn,
  });

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
    composerId,
    modeGate,
    queued,
    /** Stop the run AND drop the held turns — the composer's Stop. */
    stopTurn,
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
    timelinePrefetch: knowledgePrefetch.timelinePrefetch,
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
