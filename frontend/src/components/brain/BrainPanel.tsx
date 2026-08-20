'use client';

/**
 * The one Brain UI. Used by BOTH the full-page Brain Storm route
 * (`variant="page"`) and the global docked drawer (`variant="docked"`). All
 * logic comes from the shared hooks (`useBrainChats` / `useBrainConversation`)
 * and the page-action registry — the only thing that differs between variants
 * is chrome (two-column page vs. collapsible drawer).
 */

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { Formatter } from '@/i18n/format';
import { useFormat } from '@/i18n/useFormat';
import { useChatActivityLabels } from '@/i18n/useChatActivityLabels';
import Link from 'next/link';
import { BrainTimeline, Avatar, PendingQuestionBanner, selectPendingAskUser, askUserAnchorId } from '@seanhogg/builderforce-brain-ui';
import '@seanhogg/builderforce-brain-ui/styles.css';
import {
  consolidationMarkerContent,
  consolidationMetadata,
  subscribeRun,
  getRunSnapshot,
  getRunTrace,
  formatChatDiagnostics,
  gatherChatDiagnostics,
  getMcpToolStatus,
  nextFallbackModel,
  effortProfile,
  reasoningForRun,
  useToolConfirmationGate,
  type BrainTraceEvent,
} from '@seanhogg/builderforce-brain-embedded';
import { useConfirm } from '@/components/ConfirmProvider';
import { ChatInput, type ChatModelSelection } from '@/components/ChatInput';
import { EvermindStatusBadge } from '@/components/builder/EvermindStatusBadge';
import { recallProjectEvermind, getProjectEvermindContributions } from '@/lib/projectEvermindApi';
import { APP_VERSION, fetchApiVersion } from '@/lib/appVersions';
import { getStoredTenant, getStoredUser } from '@/lib/auth';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import { AttentionDot } from '@/components/AttentionDot';
import { UnreadBadge } from '@/components/UnreadBadge';
import { useAttention } from '@/lib/useAttention';
import { RepoContextPicker, type RepoFileSource } from '@/components/brain/RepoContextPicker';
import { BrainCapabilityPicker } from '@/components/brain/BrainCapabilityPicker';
import { ChatModeToggle } from '@/components/brain/ChatModeToggle';
import { WorkOptionsPicker } from '@/components/brain/WorkOptionsPicker';
import { CapabilityArtifactNotice } from '@/components/brain/CapabilityArtifactNotice';
import { AllowanceBanner } from '@/components/brain/AllowanceBanner';
import { ThemeSelect } from '@/components/ThemeSelect';
import { Select } from '@/components/Select';
import { fetchProjects, createProject } from '@/lib/api';
import { trackActivity } from '@/lib/activity/tracker';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import type { Project } from '@/lib/types';
import {
  useBrainChats,
  useBrainConversation,
  useBrainActions,
  useOptionalBrainContext,
  PLATFORM_BRAIN_SYSTEM_PROMPT,
  BRAIN_AUTO_APPROVE_DIRECTIVE,
  buildComposerDirectives,
  parseSuggestedActions,
  mentionRecipient,
  resolveRecipient,
  isStepMessage,
  getBrainCapability,
  normalizeChatMode,
  useQueuedTurns,
  NEW_CHAT_MODE,
  type ChatMode,
  type WorkOptionId,
  type BrainCapabilityId,
  type BrainCapabilitySurface,
  type SuggestedAction,
  type BrainModality,
  type BrainEffort,
  type DirectedRecipient,
  type RecipientChoice,
} from '@/lib/brain';
import type { BrainChat, BrainMessage, BrainChatTraceRow } from '@/lib/builderforceApi';
import { agentAssignmentsApi, reposApi, runtimeApi, brain, type AgentAssignment, type ProjectRepository, type ChatAgentInvite, type ChatMemberInfo, type TicketKind } from '@/lib/builderforceApi';
import { fetchConsumptionSnapshot } from '@/lib/useConsumption';
import { useChatModelOptions, useLlmModels } from '@/lib/useLlmModels';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { PlanBadge } from '@/components/PlanBadge';
import { BrainErrorBanner } from './BrainErrorBanner';
import { dispatchBrainDataChanged } from '@/lib/brain/brainDataEvent';
import { loadAgentPoolCached, type PoolAgent } from '@/lib/agentPool';
import { getModality } from '@/lib/modality';
import { useModalityCopy, useLocalizedModalities } from '@/lib/useModalityCopy';
import { BRAIN_AUTO_APPROVE_DEFAULT, brainAutoApprovePersistence } from '@/lib/brain/autoApprove';
import { nextSeedPromptStep } from '@/lib/brain/seedPrompt';
import { usePersonalityBlock, getSessionPsychometric } from '@/lib/usePersonalityBlock';
import { fetchLimbicBlock } from '@/lib/personalityApi';
import { accountBrainPreferencesApi } from '@/lib/accountBrainPreferencesApi';
import { AssigneeProfilesProvider } from '../workforce/AssigneeProfilesContext';
import AssigneeHovercard from '../workforce/AssigneeHovercard';

/**
 * Clock time for a message sent today, calendar date for anything older.
 *
 * Takes the formatter rather than reaching for one: this is module scope, where a
 * hook cannot run, and the alternative — `toLocaleTimeString()` with no locale —
 * is the browser's language rather than the reader's.
 */
function formatTime(fmt: Formatter, ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmt.time(d);
  return fmt.dateWith(d, { month: 'short', day: 'numeric' });
}

/** localStorage key for the per-chat "use project memory" toggle. */
const MEMORY_KEY = (chatId: number) => `bf_brain_memory:${chatId}`;

function safeJsonParse(s: string | null): unknown {
  if (s == null) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

/** Live run-trace event → the persistence input shape (kind = the event category). */
function traceEventToInput(ev: BrainTraceEvent) {
  return {
    kind: ev.category,
    label: ev.label,
    args: ev.args,
    result: ev.result,
    isError: ev.isError,
    durationMs: ev.durationMs,
    ttftMs: ev.ttftMs,
  };
}

/** A persisted trace row → a timeline BrainTraceEvent, so tool/LLM turns survive reload. */
function traceRowToEvent(r: BrainChatTraceRow): BrainTraceEvent {
  return {
    ts: r.createdAt ?? new Date().toISOString(),
    category: r.kind as BrainTraceEvent['category'],
    label: r.label ?? '',
    durationMs: r.durationMs ?? undefined,
    ttftMs: r.ttftMs ?? undefined,
    args: safeJsonParse(r.argsJson),
    result: safeJsonParse(r.resultJson),
    isError: r.isError || undefined,
  };
}

export interface BrainPanelProps {
  variant: 'page' | 'docked';
  /** Lock the Brain to one project (docked-in-IDE / project pages). */
  pinnedProjectId?: number | null;
  /**
   * The project the user is currently viewing (e.g. the Tasks board scoped to
   * `?project=14`). Injected into the system prompt as the default project for
   * project-scoped actions — WITHOUT pinning chats or switching persona.
   */
  viewingProjectId?: number | null;
  /** Active modality — drives the docked Brain's persona. */
  modality?: BrainModality;
  /** Extra system-prompt context (e.g. the IDE's open file). */
  extraSystem?: string;
  /** Deep-link: select this chat on mount. */
  initialChatId?: number | null;
  /**
   * One-shot prompt to auto-send on mount (e.g. a landing-page prompt replayed
   * after auth). Sent exactly once; `conv.send` creates+selects a chat on demand.
   */
  initialPrompt?: string;
  /**
   * One-shot work item to auto-link the opened chat to (`?ticket=<kind>:<ref>`), so
   * clicking an item opens a chat already tied to it — parity with the VS Code "open
   * task" flow. Handled once; ensures a chat exists, then reuses `brain.linkChatTicket`.
   */
  initialTicket?: { kind: string; ref: string };
  /**
   * Which capability set this surface offers ("what are we making?"). Brain
   * Storm authors artifacts (document / slides / data viz / spreadsheet); the
   * IDE builds and runs things (website / design / mobile / animation / 3D
   * game). See lib/brain/capabilities.ts.
   */
  capabilitySurface?: BrainCapabilitySurface;
  /** Docked only: close handler for the drawer chrome. */
  onClose?: () => void;
}

export function BrainPanel({
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
}: BrainPanelProps) {
  const fmt = useFormat();
  const isPage = variant === 'page';
  const tTimeline = useTranslations('brain.timeline');
  const activityLabels = useChatActivityLabels();
  const tCommon = useTranslations('common');
  const tRepo = useTranslations('repoContext');
  const tBrain = useTranslations('brain');
  const confirm = useConfirm();

  // Project scope follows the global TopBar tenant→project selector — one picker
  // for the whole app (see ProjectScopeContext). The Brain's filter dropdown
  // reflects and drives it, so a chat created while scoped to a project is
  // assigned to that project (new chats default to the active filter). "No
  // project" is a local-only refinement (show unassigned chats) the global scope
  // can't express — null there means "all projects", not "unassigned". When there
  // is no scope provider (embed surfaces, outside the app shell) we fall back to
  // a purely local filter so the dropdown still works.
  const scope = useOptionalProjectScope();
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [localFilter, setLocalFilter] = useState<string | null>(null);
  const filterProjectId: string | null = scope
    ? (scope.currentProjectId != null
        ? String(scope.currentProjectId)
        : (unassignedOnly ? 'none' : null))
    : localFilter;
  const setFilterProjectId = useCallback((v: string) => {
    if (!scope) { setLocalFilter(v === '' ? null : v); return; }
    if (v === 'none') { setUnassignedOnly(true); scope.setProject(null); }
    else if (v === '') { setUnassignedOnly(false); scope.setProject(null); }
    else { setUnassignedOnly(false); scope.setProject(Number(v)); }
  }, [scope]);
  const [searchQuery, setSearchQuery] = useState('');
  const [input, setInput] = useState('');
  /** Bumped to pull focus into the composer after something seeds it. */
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  /**
   * The mode a NOT-YET-CREATED chat will be born in (migration 0409). Declared here,
   * above `startNewChat`, because every creation path has to carry it: a user who
   * picks Work in the empty state and then types must get a WORK conversation, not a
   * chat one that silently declines to do the thing they asked for. Mirrored into a
   * ref so `startNewChat` reads the current value without being re-created (it is a
   * dependency of `ensureChatId`, which is captured into every run).
   */
  const [pendingMode, setPendingMode] = useState<ChatMode>(NEW_CHAT_MODE);
  const pendingModeRef = useRef<ChatMode>(NEW_CHAT_MODE);
  // eslint-disable-next-line react-hooks/refs
  pendingModeRef.current = pendingMode;
  /**
   * Docked drawer sections. Chat history used to be a collapsible strip stacked
   * ABOVE the conversation, which squeezed the thread in a ~440px drawer and hid
   * past chats behind a disclosure; it is now a peer tab of the conversation, so
   * a returning user can reach any earlier chat without giving up thread height.
   * The full-page variant keeps its permanent sidebar and ignores this.
   */
  const [dockedTab, setDockedTab] = useState<'chat' | 'history'>('chat');
  /** Which chat row has its rename/summarize/delete/assign actions revealed. */
  const [actionsChatId, setActionsChatId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

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

  // Composer run-shaping toggles (the `/` menu + the `+` menu's web option) —
  // compiled into the ambient system context below so each actually changes the
  // next turn. Mirrors the VS Code Brain composer.
  const [effort, setEffort] = useState<BrainEffort>('balanced');
  const [thinking, setThinking] = useState(false);
  const [webBrowsing, setWebBrowsing] = useState(false);
  const [modelSelection, setModelSelection] = useState<ChatModelSelection>({ mode: 'auto' });
  const [responseInstructions, setResponseInstructions] = useState('');
  const [accountPreferencesReady, setAccountPreferencesReady] = useState(false);
  // Account preferences use the person-level credential and therefore follow the
  // user across tenants, projects, chats, browsers and devices. Workspace roles do
  // not gate a human's authority over their own defaults.
  useEffect(() => {
    let live = true;
    accountBrainPreferencesApi.get()
      .then(({ preferences }) => {
        if (!live) return;
        setEffort(preferences.effort);
        setThinking(preferences.thinking);
        setWebBrowsing(preferences.webBrowsing);
        setModelSelection(preferences.modelSelection);
        setResponseInstructions(preferences.responseInstructions);
      })
      .catch(() => { /* signed-out/embed surfaces keep safe defaults */ })
      .finally(() => { if (live) setAccountPreferencesReady(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!accountPreferencesReady) return;
    const timer = window.setTimeout(() => {
      void accountBrainPreferencesApi.update({ effort, thinking, webBrowsing, modelSelection, responseInstructions })
        .catch(() => { /* the global API error surface reports save failures */ });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [accountPreferencesReady, effort, thinking, webBrowsing, modelSelection, responseInstructions]);
  // "Add context" from a connected repo: when the active chat's project has one
  // or more repositories, the composer's + menu offers a repo file picker whose
  // selection is attached as context. Same repo the agent clones from, so it
  // works both for planning chats and for chatting with a running agent.
  const [projectRepos, setProjectRepos] = useState<ProjectRepository[]>([]);
  const [linkedTaskId, setLinkedTaskId] = useState<number | null>(null);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);

  // Brain agent/persona switcher: the user can run the Brain as the default
  // assistant, as a built-in modality persona, or as one of the agents assigned
  // to the Brain (scope='brain' in the canonical agent-assignment model).
  //
  // Docked in an IDE project, the persona STARTS as that project's modality: the
  // modality prompt was already the one in force there (see personaSystemPrompt
  // below), so leaving the picker on "Default Brain" only misreported which
  // persona was answering — open a Mobile project and the chat looked generic
  // even though it was the mobile coder. `modality` is the resolved id, so an
  // unknown/legacy value can't select a persona that isn't in the registry.
  const dockedPersona = !isPage && pinnedProjectId != null ? `modality:${modality}` : 'default';
  const [personaSel, setPersonaSel] = useState<string>(dockedPersona);
  // Follow the project/modality the drawer is pinned to until the user picks a
  // persona themselves — after that their choice sticks for the session.
  const personaPicked = useRef(false);
  useEffect(() => {
    if (!personaPicked.current) setPersonaSel(dockedPersona);
  }, [dockedPersona]);
  const choosePersona = useCallback((value: string) => {
    personaPicked.current = true;
    setPersonaSel(value);
  }, []);
  const [brainAgents, setBrainAgents] = useState<AgentAssignment[]>([]);
  const [agentPool, setAgentPool] = useState<PoolAgent[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all([agentAssignmentsApi.list('brain').catch(() => []), loadAgentPoolCached().catch(() => [])])
      .then(([a, p]) => { if (live) { setBrainAgents(a); setAgentPool(p); } });
    return () => { live = false; };
  }, []);
  const agentName = useCallback(
    (a: AgentAssignment) => agentPool.find((p) => p.kind === a.agentKind && p.ref === a.agentRef)?.name ?? `${a.agentKind}:${a.agentRef}`,
    [agentPool],
  );
  const personaSystemPrompt = useMemo(() => {
    if (personaSel.startsWith('modality:')) return getModality(personaSel.slice('modality:'.length)).brainSystemPrompt;
    if (personaSel.startsWith('agent:')) {
      const a = brainAgents.find((x) => `agent:${x.agentKind}:${x.agentRef}` === personaSel);
      return a ? `You are acting as the "${agentName(a)}" agent for this workspace. Adopt its role, voice and duties when responding.` : undefined;
    }
    // Default persona: the platform co-pilot prompt on the full Brain Storm page
    // AND on the floating drawer everywhere EXCEPT when it's pinned to an IDE
    // project (there the modality coding prompt — via resolveSystemPrompt — wins).
    return isPage || pinnedProjectId == null ? PLATFORM_BRAIN_SYSTEM_PROMPT : undefined;
  }, [personaSel, brainAgents, agentName, isPage, pinnedProjectId]);
  // Route the Brain to the assigned agent's real model. The Brain streams to the
  // gateway (/llm/v1/chat/completions), which resolves real model ids — so use the
  // agent's base_model from the pool; registered/default agents → undefined (default).
  const personaModel = useMemo(() => {
    if (!personaSel.startsWith('agent:')) return undefined;
    const a = brainAgents.find((x) => `agent:${x.agentKind}:${x.agentRef}` === personaSel);
    if (!a) return undefined;
    const pooled = agentPool.find((p) => p.kind === a.agentKind && p.ref === a.agentRef);
    return pooled?.baseModel ?? undefined;
  }, [personaSel, brainAgents, agentPool]);

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

  /**
   * Start a chat and land the user in it. The ONE "new chat" path for every
   * surface control (header button, empty-state buttons, capability tiles,
   * composer-driven creation) — docked, that also has to leave the history tab,
   * otherwise pressing "+ New" from history silently created a chat the user
   * never saw.
   */
  const startNewChat = useCallback(async (opts?: { title?: string; projectId?: number | null; capability?: string | null; mode?: ChatMode }) => {
    // The mode chosen in the empty state rides EVERY creation path — including the one
    // that fires implicitly when the user just types and hits send (`ensureChatId`).
    const created = await chats.create({ ...opts, mode: opts?.mode ?? pendingModeRef.current });
    if (!isPage) setDockedTab('chat');
    return created;
  }, [chats, isPage]);

  /**
   * Open an existing chat from the history list. Docked, history is a tab beside
   * the conversation, so opening a chat has to switch back to it; the page keeps
   * the list permanently beside the thread and instead reveals that row's
   * actions (its long-standing behaviour).
   */
  const openChat = useCallback((id: number) => {
    void chats.select(id);
    if (isPage) setActionsChatId(id);
    else setDockedTab('chat');
  }, [chats, isPage]);

  const ensureChatId = useCallback(async () => {
    const c = await startNewChat();
    return c?.id ?? null;
  }, [startNewChat]);

  // Tell the model which project is in context, so "create a task" / "list
  // specs" without a named project default to it. Chat-FIRST: a chat that belongs
  // to a project (chats.activeChat.projectId) always tells the model about ITS OWN
  // project, regardless of what page/pinned scope the sidebar is currently on — the
  // same resolution evermindProjectId uses below. Falls back to the viewed page
  // (viewingProjectId, e.g. the scoped Tasks board) then the IDE's pinned project
  // for a not-yet-scoped chat. Resolve the name from the loaded projects list when
  // available; the id is what the tools actually need.
  const ctxProjectId = chats.activeChat?.projectId ?? viewingProjectId ?? pinnedProjectId;
  // Cross-surface "what's live / what needs me" — decorates each chat row with a
  // status dot (running / needs-answer) that stays live even when another chat is
  // focused. Scoped when a project is in context, tenant-wide on the Brain Storm page.
  const attn = useAttention(ctxProjectId ?? undefined);
  // The signed-in user's personality — fetched once per session and folded into
  // the ambient system channel so the web Brain chat's TONE reflects the user.
  // '' (a no-op) when they have no profile. This is the web half of Gap 2/3; the
  // VS Code surfaces inject the equivalent block via the gateway helper.
  const personalityBlock = usePersonalityBlock();

  // ---- Capability ("what are we making?") ----------------------------------
  // A property of the CHAT (migration 0345), so the choice follows the
  // conversation to every surface instead of living in this browser. Picking one
  // folds a capability block into the system prompt so the model shapes its
  // output as that artifact, and seeds the composer with a starting line.
  const capabilityId = (getBrainCapability(chats.activeChat?.capability)?.id ?? null) as BrainCapabilityId | null;
  const selectCapability = useCallback(async (id: BrainCapabilityId | null) => {
    // From the empty state there is no chat yet — start one carrying the choice
    // (same path the "Start new chat" button takes, plus the capability).
    if (chats.activeChatId == null) {
      if (id == null) return;
      await startNewChat({ capability: id });
    } else {
      await chats.setCapability(chats.activeChatId, id);
    }
    if (id) {
      setInput((prev) => (prev.trim() ? prev : tBrain(`capabilities.${id}.starter`)));
      // Focus with the caret at the end: the starter is an editable opening line,
      // not a finished message. (Sending the raw seed produced stub replies.)
      setComposerFocusToken((n) => n + 1);
    }
  }, [chats, startNewChat, tBrain]);
  const capabilityPrompt = getBrainCapability(capabilityId)?.systemPrompt;

  // ---- Mode ("am I asking, or delegating?") --------------------------------
  // A property of the CHAT (migration 0409), like `capability`, so the choice follows
  // the conversation rather than the browser. `pendingMode` (declared above, beside the
  // composer state, because `startNewChat` reads it) covers the pre-chat empty state:
  // without it, picking Work and then typing would silently mint a `chat`-mode chat.
  const chatMode: ChatMode = chats.activeChat
    ? normalizeChatMode(chats.activeChat.mode)
    : pendingMode;
  const selectMode = useCallback(async (mode: ChatMode) => {
    setPendingMode(mode);
    const id = chats.activeChatId;
    if (id != null) await chats.setMode(id, mode);
  }, [chats]);
  // A work option is a STARTING POINT, not a message: seed the composer and drop the
  // caret at the end so the user finishes the brief instead of sending the template.
  const pickWorkOption = useCallback((_id: WorkOptionId, brief: string) => {
    setInput((prev) => (prev.trim() ? prev : brief));
    setComposerFocusToken((n) => n + 1);
  }, []);

  const ambientSystem = useMemo(() => {
    const parts: string[] = [];
    if (extraSystem) parts.push(extraSystem);
    if (capabilityPrompt) parts.push(capabilityPrompt);
    if (personalityBlock) parts.push(personalityBlock);
    if (responseInstructions) parts.push(`ACCOUNT RESPONSE PREFERENCES:\n${responseInstructions}`);
    if (ctxProjectId != null) {
      const name = projects.find((p) => p.id === ctxProjectId)?.name;
      parts.push(`The current project is ${name ? `"${name}" ` : ''}(projectId ${ctxProjectId}). When the user asks to create, list, or operate on tasks, specs, or other project-scoped items without naming a project, use projectId ${ctxProjectId} by default. To take them to the result, call navigate_to — do not write out absolute URLs.`);
    }
    // Auto-approve flips the model from "ask before acting" to "act decisively"
    // — the toggle already skips the per-action confirm UI; this keeps the model
    // from asking for permission in prose anyway.
    if (autoApprove) parts.push(BRAIN_AUTO_APPROVE_DIRECTIVE);
    // Effort / Thinking / Browse-the-web composer toggles.
    // `thinking` is NOT passed: it is a structured `reasoning.level` on the request (see
    // `reasoningForRun` below), never a prompt sentence.
    const composer = buildComposerDirectives({ effort, web: webBrowsing });
    if (composer) parts.push(composer);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }, [ctxProjectId, projects, extraSystem, capabilityPrompt, autoApprove, effort, thinking, webBrowsing, personalityBlock, responseInstructions]);

  // Per-turn limbic affect (VS Code webview parity). The static personality tone
  // above (`ambientSystem` ← personalityBlock) sets the user's baseline voice;
  // this seam adds a FRESH per-message affect block the sync system prompt can't:
  // it appraises THIS turn's text (seeded from the user's psychometric) and folds
  // the dynamic `block` into that run's system prompt. Reuses the profile cached
  // by usePersonalityBlock's once-per-session `/me` fetch — only the appraisal
  // POST varies per turn. Best-effort: '' when there's no profile or on any error
  // (a no-op that never blocks the chat), so static + per-turn coexist.
  const augmentSystemPrompt = useCallback(async (userText: string): Promise<string> => {
    if (!userText.trim()) return '';
    const psychometric = await getSessionPsychometric();
    if (!psychometric) return '';
    return fetchLimbicBlock(psychometric, userText);
  }, []);

  // Project-Evermind memory hooks: recall the active chat's project learnings
  // before answering (grounding the reply + surfacing recall/learn/reconcile
  // steps). Bound to the chat's project (falling back to the pinned/viewing one a
  // new chat will be created under, so learning + recall stay on the same model).
  const evermindProjectId = chats.activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null;
  const evermind = useMemo(
    () => (evermindProjectId == null
      ? undefined
      : { recall: (query: string) => recallProjectEvermind(evermindProjectId, query).catch(() => null) }),
    [evermindProjectId],
  );

  // Self-heal Evermind learning scope (web parity with the VS Code webview). The server's
  // chat→Evermind learn gate keys on `brain_chats.projectId`: a project-less chat NEVER
  // contributes even while the composer badge/panel shows the page's project as connected
  // (they resolve via the pinned/viewing FALLBACK). So a chat created before a project was
  // scoped (or any older/global chat) silently never trains the model. When the page has a
  // resolved project and the open chat is project-less, adopt it onto the chat so its turns
  // actually train that project's Evermind. One-shot per chat (guarded), best-effort.
  const adoptedProjectRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const pid = pinnedProjectId ?? viewingProjectId ?? null;
    const chatId = chats.activeChatId;
    const active = chats.activeChat;
    if (chatId == null || pid == null || active == null || active.projectId != null) return;
    if (adoptedProjectRef.current.has(chatId)) return;
    adoptedProjectRef.current.add(chatId);
    brain.updateChat(chatId, { projectId: pid })
      .then(() => chats.reload())
      .catch(() => { adoptedProjectRef.current.delete(chatId); });
  }, [chats.activeChatId, chats.activeChat, chats.reload, pinnedProjectId, viewingProjectId]);

  // Per-chat memory switch: whether THIS chat passes the project-Evermind hooks
  // (recall + learn). Default ON; persisted per-chat in localStorage so it sticks
  // across reloads. Turning it off makes the chat a scratch space that neither
  // recalls nor writes back to the project's learned memory.
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  useEffect(() => {
    const cid = chats.activeChatId;
    if (cid == null) { setMemoryEnabled(true); return; }
    try {
      const v = window.localStorage.getItem(MEMORY_KEY(cid));
      setMemoryEnabled(v == null ? true : v !== '0');
    } catch { setMemoryEnabled(true); }
  }, [chats.activeChatId]);
  const toggleMemory = useCallback((on: boolean) => {
    setMemoryEnabled(on);
    const cid = chats.activeChatId;
    if (cid == null) return;
    try { window.localStorage.setItem(MEMORY_KEY(cid), on ? '1' : '0'); } catch { /* storage blocked */ }
  }, [chats.activeChatId]);
  // Gate the Evermind hooks on the per-chat switch — off ⇒ no recall/learn this chat.
  const gatedEvermind = memoryEnabled ? evermind : undefined;

  // The shared (module-cached) model surface. Read here — ABOVE the conversation hook
  // — because the run loop needs it to fail over when a model will not emit tool
  // calls; the diagnostics capture below reads the same cached object.
  const llmModels = useLlmModels();
  const { options: modelOptions, identity: modelIdentity } = useChatModelOptions();
  const selectedModel = modelSelection.mode === 'model' ? modelSelection.model : undefined;
  // Tool-call failover: the SHARED selector over that surface, so "which model next"
  // is decided in one place for every host rather than per surface.
  const pickFallbackModel = useCallback(
    (tried: readonly string[]) => nextFallbackModel({ ...llmModels.fundingSurface, codingModels: llmModels.codingModels }, tried),
    [llmModels],
  );

  const conv = useBrainConversation({
    chatId: chats.activeChatId,
    modality,
    extraSystem: ambientSystem,
    systemPrompt: personaSystemPrompt,
    model: selectedModel,
    modelStrict: modelSelection.mode === 'model',
    routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
    pickFallbackModel: modelSelection.mode === 'model' ? undefined : pickFallbackModel,
    maxTokens: effortProfile(effort).maxTokens,
    reasoning: reasoningForRun({ effort, thinking }),
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity: chats.touch,
    onFirstUserTurn: chats.autoTitle,
    evermind: gatedEvermind,
    augmentSystemPrompt,
    chatMode,
  });

  const { pendingConfirm, resolveConfirm } = conv;
  // "Approve all": run this action and auto-approve the rest of the run/session.
  const approveAll = useCallback(() => {
    setAutoApproveMode(true);
    resolveConfirm(true);
  }, [setAutoApproveMode, resolveConfirm]);

  // ---- Consolidate / Fork -------------------------------------------------
  // Consolidate: summarize the whole chat into ONE compact assistant message
  // tagged as a consolidation marker. The conversation loop seeds the next turn
  // FROM this marker, so a long chat sends its summary as base context instead of
  // the full history. Fork does the same but into a NEW chat it then switches to.
  // (Web parity for the VS Code webview App.tsx consolidate/fork actions.)
  const [consolidating, setConsolidating] = useState(false);
  const [forking, setForking] = useState(false);
  const canConsolidate = chats.activeChatId != null && conv.messages.length >= 2 && !conv.sending;

  const consolidate = useCallback(async () => {
    const chatId = chats.activeChatId;
    if (chatId == null || consolidating || forking) return;
    setConsolidating(true);
    conv.clearError();
    try {
      const result = await brain.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || tBrain('nothingToConsolidate'));
        return;
      }
      await brain.sendMessages(chatId, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      conv.reloadMessages();
      void chats.reload();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : tBrain('consolidateFailed'));
    } finally {
      setConsolidating(false);
    }
  }, [chats, consolidating, forking, conv, tBrain]);

  const fork = useCallback(async () => {
    const chatId = chats.activeChatId;
    if (chatId == null || forking || consolidating) return;
    setForking(true);
    conv.clearError();
    try {
      const result = await brain.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || tBrain('nothingToFork'));
        return;
      }
      const sourceTitle = chats.activeChat?.title || tBrain('newChatFallback');
      const projectId = chats.activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null;
      const forkTitle = tBrain('forkOf', { title: sourceTitle }).slice(0, 80);
      const created = await chats.create({ title: forkTitle, projectId });
      if (!created) return;
      await brain.sendMessages(created.id, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      conv.reloadMessages();
      void chats.reload();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : tBrain('forkFailed'));
    } finally {
      setForking(false);
    }
  }, [chats, forking, consolidating, conv, pinnedProjectId, viewingProjectId, tBrain]);

  // ---- Run-trace persist + rehydrate --------------------------------------
  // Rehydrate: on chat load, pull the persisted tool/LLM-turn trace so those steps
  // survive a reload. Shown when there's no live trace this session (a live run
  // repopulates conv.trace, which then wins).
  const [persistedTrace, setPersistedTrace] = useState<BrainTraceEvent[]>([]);
  useEffect(() => {
    const cid = chats.activeChatId;
    if (cid == null) { setPersistedTrace([]); return; }
    let live = true;
    brain.getChatTrace(cid)
      .then((rows) => { if (live) setPersistedTrace(rows.map(traceRowToEvent)); })
      .catch(() => { if (live) setPersistedTrace([]); });
    return () => { live = false; };
  }, [chats.activeChatId]);
  const timelineTrace = conv.trace.length > 0 ? conv.trace : persistedTrace;

  // Persist: when a run settles (running flips true→false with a non-empty trace),
  // POST only the events not yet persisted this session (tracked per-chat) so tool
  // turns are durable and don't double-post.
  const persistedLenRef = useRef<Map<number, number>>(new Map());
  const wasRunningRef = useRef<Map<number, boolean>>(new Map());
  useEffect(() => {
    const cid = chats.activeChatId;
    if (cid == null) return;
    wasRunningRef.current.set(cid, getRunSnapshot(cid).running);
    const onChange = () => {
      const snap = getRunSnapshot(cid);
      const prev = wasRunningRef.current.get(cid) ?? false;
      wasRunningRef.current.set(cid, snap.running);
      if (!prev || snap.running) return; // only act on running → settled
      const full = getRunTrace(cid);
      const already = persistedLenRef.current.get(cid) ?? 0;
      if (full.length <= already) return;
      const events = full.slice(already).map(traceEventToInput);
      persistedLenRef.current.set(cid, full.length);
      void brain.appendChatTrace(cid, events).catch(() => { /* best-effort */ });
    };
    return subscribeRun(cid, onChange);
  }, [chats.activeChatId]);

  // Multi-party chat: the invited participants of the active chat, resolved to
  // display names via the (already-loaded, cached) agent pool — so a message can
  // be addressed to a teammate instead of the BRAIN. Bumped on invite/remove.
  const activeChatId = chats.activeChat?.id ?? null;
  const [invitedAgents, setInvitedAgents] = useState<ChatAgentInvite[]>([]);
  const [chatMembers, setChatMembers] = useState<ChatMemberInfo[]>([]);
  const [participantsRefresh, setParticipantsRefresh] = useState(0);
  useEffect(() => {
    if (activeChatId == null) { setInvitedAgents([]); setChatMembers([]); return; }
    let live = true;
    brain.listChatAgents(activeChatId).then((a) => { if (live) setInvitedAgents(a); }).catch(() => { if (live) setInvitedAgents([]); });
    brain.listChatMembers(activeChatId).then((m) => { if (live) setChatMembers(m); }).catch(() => { if (live) setChatMembers([]); });
    return () => { live = false; };
  }, [activeChatId, participantsRefresh]);
  const participants = useMemo<DirectedRecipient[]>(
    () => [
      ...invitedAgents.map((a) => ({
        kind: 'agent' as const,
        ref: a.agentRef,
        name: agentPool.find((p) => p.ref === a.agentRef)?.name ?? a.agentRef,
      })),
      // Human members are addressable too (kind='human', ref = user id).
      ...chatMembers
        .filter((m) => m.status === 'active' && m.userId)
        .map((m) => ({ kind: 'human' as const, ref: m.userId as string, name: m.name })),
    ],
    [invitedAgents, chatMembers, agentPool],
  );
  // Who the next message goes to: `null` = auto (follow @mention), `'brain'` =
  // explicit BRAIN, or an explicit participant. Reset when switching chats; drop
  // a pick that has since left the roster.
  const [recipientChoice, setRecipientChoice] = useState<RecipientChoice>(null);
  useEffect(() => { setRecipientChoice(null); }, [activeChatId]);
  useEffect(() => {
    setRecipientChoice((c) => (c && c !== 'brain' && !participants.some((p) => p.ref === c.ref) ? null : c));
  }, [participants]);
  const recipient = resolveRecipient(recipientChoice, mentionRecipient(input, participants));

  // The project whose repos back "Add context" — the active chat's project takes
  // precedence (a chat can be assigned to a different project than the viewport),
  // then the IDE-pinned / viewing project. Repos are fetched from the cached
  // list endpoint; the picker only appears when at least one repo is connected.
  const repoProjectId = chats.activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null;
  useEffect(() => {
    if (repoProjectId == null) { setProjectRepos([]); return; }
    let live = true;
    reposApi.list(repoProjectId)
      .then((r) => { if (live) setProjectRepos(r); })
      .catch(() => { if (live) setProjectRepos([]); });
    return () => { live = false; };
  }, [repoProjectId]);

  // The task this chat is tied to (if any) — so "Add context" can also list the
  // AGENT WORKING BRANCH (the ticket branch a run commits to), which is the point
  // of chatting with an agent: reference the file it's actually editing. A chat is
  // linked to at most one task in practice; take the first live task link.
  useEffect(() => {
    const cid = chats.activeChatId;
    if (cid == null) { setLinkedTaskId(null); return; }
    let live = true;
    brain.listChatTickets(cid)
      .then((links) => {
        if (!live) return;
        const task = links.find((l) => l.kind === 'task' && l.exists);
        setLinkedTaskId(task ? Number(task.ref) : null);
      })
      .catch(() => { if (live) setLinkedTaskId(null); });
    return () => { live = false; };
  }, [chats.activeChatId]);

  // The file sources "Add context" can browse: the agent's working branch first
  // (most relevant when chatting with a running agent), then each connected repo's
  // default branch. Each source loads its manifest server-side (token stays there).
  const contextSources = useMemo<RepoFileSource[]>(() => {
    const list: RepoFileSource[] = [];
    if (linkedTaskId != null) {
      list.push({
        id: `task:${linkedTaskId}`,
        label: tRepo('agentBranch'),
        load: async () => {
          const r = await runtimeApi.taskRepoFiles(linkedTaskId);
          if (!r.ok) throw new Error(r.reason || tRepo('error'));
          return r.files;
        },
      });
    }
    for (const repo of projectRepos) {
      list.push({
        id: `repo:${repo.id}`,
        label: `${repo.owner}/${repo.repo}`,
        load: async () => (await reposApi.contents(repo.id)).files ?? [],
      });
    }
    return list;
  }, [linkedTaskId, projectRepos, tRepo]);

  // Presence of this callback IS the entitlement — ChatInput shows "Add context"
  // only when a repo-backed source is in scope.
  const onAddContext = contextSources.length > 0 ? () => setRepoPickerOpen(true) : undefined;
  const attachRepoFile = useCallback(async (path: string, content: string) => {
    await conv.attach(new File([content], path, { type: 'text/plain' }));
    setRepoPickerOpen(false);
  }, [conv]);

  // Projects for the filter/assignment dropdowns.
  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  // Apply ?chat= deep link once chats are available.
  useEffect(() => {
    if (initialChatId == null || chats.loading) return;
    if (chats.activeChatId === initialChatId) return;
    chats.select(initialChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId, chats.loading]);

  const projectName = useCallback(
    (id: number | null) => (id == null ? '' : (projects.find((p) => p.id === id)?.name ?? `#${id}`)),
    [projects],
  );

  const hasTool = useCallback(
    (name: string) => toolSpecs.some((t) => t.function.name === name),
    [toolSpecs],
  );

  const filteredChats = useMemo(
    () => (searchQuery.trim()
      ? chats.chats.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : chats.chats),
    [chats.chats, searchQuery],
  );

  const submitRename = useCallback(async () => {
    if (renamingId != null && renameValue.trim()) await chats.rename(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, chats]);

  const onSummarize = useCallback(async (id: number) => {
    setSummarizingId(id);
    try { await chats.summarize(id); } finally { setSummarizingId(null); }
  }, [chats]);

  const onDelete = useCallback(async (chat: BrainChat) => {
    const title = chat.title?.trim() || tBrain('thisChat');
    if (!(await confirm(tBrain('deleteChatConfirm', { title })))) return;
    setDeletingId(chat.id);
    try { await chats.remove(chat.id); } finally { setDeletingId(null); }
  }, [chats, tBrain]);

  const onAssign = useCallback(async (chatId: number, projectId: number | null) => {
    setBusyId(chatId);
    try { await chats.assignToProject(chatId, projectId); } finally { setBusyId(null); }
  }, [chats]);

  // Memoize the props handed to the React.memo-wrapped <BrainTimeline> and
  // <ChatTicketsPanel> so they don't get a fresh object/closure every render —
  // otherwise the memo never skips and the transcript re-parses markdown on
  // every keystroke/streaming token (mirrors the VS Code webview App.tsx).
  const timelineLabels = useMemo(() => ({
    thinking: tTimeline('thinking'),
    thoughtFor: tTimeline('thoughtFor'),
    you: tTimeline('you'),
    assistant: tTimeline('assistant'),
    input: tTimeline('input'),
    output: tTimeline('output'),
    error: tTimeline('error'),
    loading: tTimeline('loading'),
    empty: tTimeline('empty'),
    copy: tTimeline('copy'),
    copied: tTimeline('copied'),
    replay: tTimeline('replay'),
    rateUp: tTimeline('rateUp'),
    rateDown: tTimeline('rateDown'),
    apply: tTimeline('apply'),
    createFile: tTimeline('createFile'),
    preview: tTimeline('preview'),
    askSubmit: tTimeline('askSubmit'),
    askAnswered: tTimeline('askAnswered'),
    accountOwn: tTimeline('accountOwn'),
    accountShared: tTimeline('accountShared'),
    accountByoUnused: tTimeline('accountByoUnused'),
    ranOnEvermind: tTimeline('ranOnEvermind'),
    recallTitle: tTimeline('recallTitle'),
    recallHint: tTimeline('recallHint'),
    learnTitle: tTimeline('learnTitle'),
    learnHint: tTimeline('learnHint'),
    learnSkippedTitle: tTimeline('learnSkippedTitle'),
    learnSkippedHint: tTimeline('learnSkippedHint'),
    learnSkipReason: {
      'not-attached': tTimeline('learnSkipReasonNotAttached'),
      'not-seeded': tTimeline('learnSkipReasonNotSeeded'),
      frozen: tTimeline('learnSkipReasonFrozen'),
    },
    learnTargetContributed: tTimeline('learnTargetContributed'),
    learnTargetSkipped: tTimeline('learnTargetSkipped'),
    reconcileTitle: tTimeline('reconcileTitle'),
    reconcileHint: tTimeline('reconcileHint'),
    // Run milestones / agent dispatch render as system ACTIVITY lines composed from the
    // message's structured metadata — see useChatActivityLabels for why these are
    // templates rather than sentences.
    activity: activityLabels,
  }), [tTimeline, activityLabels]);

  const timelineApplyCode = useMemo(
    () => (hasTool('apply_code_to_active_file')
      ? (code: string) => { void runTool('apply_code_to_active_file', { code }); }
      : undefined),
    [hasTool, runTool],
  );
  const timelineCreateFile = useMemo(
    () => (hasTool('create_file')
      ? (path: string, content: string) => { void runTool('create_file', { path, content }); }
      : undefined),
    [hasTool, runTool],
  );
  // The conversation hook returns a FRESH object every render and `recipient`
  // recomputes as the user types, so a callback that depends on them would change
  // identity every keystroke and defeat <BrainTimeline>'s memo. Read the latest
  // values from a ref instead, keeping the callbacks below referentially stable.
  const timelineCtxRef = useRef({ conv, chats, recipient, projectId: chats.activeChat?.projectId ?? pinnedProjectId ?? undefined, capability: chats.activeChat?.capability ?? null, chatTitle: chats.activeChat?.title });
  timelineCtxRef.current = { conv, chats, recipient, projectId: chats.activeChat?.projectId ?? pinnedProjectId ?? undefined, capability: chats.activeChat?.capability ?? null, chatTitle: chats.activeChat?.title };
  const onAnswerTimelineQuestion = useCallback((answer: string) => {
    const { conv: c, recipient: r } = timelineCtxRef.current;
    void c.send(answer, { addressedTo: r });
  }, []);
  /** "Send again" on any message: re-ask with the same text. Addressed to the same
   *  recipient as a freshly typed turn, so replaying in a multi-party chat reaches
   *  whoever the composer is currently pointed at rather than silently the Brain. */
  const onReplayTimelineMessage = useCallback((msg: BrainMessage) => {
    const { conv: c, recipient: r } = timelineCtxRef.current;
    void c.send(msg.content, { addressedTo: r });
  }, []);
  // The question this chat is BLOCKED on, if any. A long transcript buries the agent's
  // ask_user card, so the chat reads as merely idle when it is actually waiting on the
  // user — the VSIX has pinned it at the composer since the session-tabs pass, and this
  // is the same shared predicate + banner, so the two surfaces can never disagree about
  // whether a chat is blocked.
  const pendingQuestion = useMemo(() => selectPendingAskUser(conv.messages), [conv.messages]);
  // The banner renders the SAME <QuestionCard> the timeline does, so its card copy is
  // taken from the timeline bundle rather than re-translated — only the two
  // banner-specific strings are new.
  const askLabels = useMemo(() => ({
    askSubmit: timelineLabels.askSubmit,
    askAnswered: timelineLabels.askAnswered,
    askPending: tTimeline('askPending'),
    askJumpTo: tTimeline('askJumpTo'),
  }), [timelineLabels, tTimeline]);
  const revealPendingQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    document.getElementById(askUserAnchorId(pendingQuestion.messageId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pendingQuestion]);

  const renderTimelineMessage = useCallback(
    (msg: BrainMessage, ctx: { role: 'user' | 'assistant'; text: string }) => (
      <ChatMessageContent
        content={ctx.role === 'assistant' ? parseSuggestedActions(msg.content).content : ctx.text}
        onApplyCode={ctx.role === 'assistant' && hasTool('apply_code_to_active_file') ? (code) => { void runTool('apply_code_to_active_file', { code }); } : undefined}
        onCreateFile={ctx.role === 'assistant' && hasTool('create_file') ? (path, content) => { void runTool('create_file', { path, content }); } : undefined}
      />
    ),
    [hasTool, runTool],
  );
  const renderTimelineStreaming = useCallback(
    (text: string) => <ChatMessageContent content={parseSuggestedActions(text).content} />,
    [],
  );
  const renderTimelineAssistantActions = useCallback((msg: BrainMessage) => {
    const { conv: c, projectId, capability, chatTitle } = timelineCtxRef.current;
    return (
      <MessageActions
        msg={msg}
        conv={c}
        projectId={projectId}
        capability={capability}
        chatTitle={chatTitle}
        suggestions={parseSuggestedActions(msg.content).actions}
        onRunSuggestion={(prompt) => { void c.send(prompt); }}
      />
    );
  }, []);
  const onTicketsChanged = useCallback(() => {
    const { conv: c, chats: ch } = timelineCtxRef.current;
    void ch.reload();
    c.reloadMessages();
    setParticipantsRefresh((n) => n + 1);
  }, []);

  const createProjectAndAssign = useCallback(async () => {
    const name = newProjectName.trim();
    const target = chats.activeChatId;
    if (!name || target == null || creatingProject) return;
    setCreatingProject(true);
    try {
      const project = await createProject({ name });
      setProjects((prev) => [...prev, project]);
      await chats.assignToProject(target, project.id);
      setShowNewProject(false);
      setNewProjectName('');
    } catch { /* surfaced via chats.error */ } finally {
      setCreatingProject(false);
    }
  }, [newProjectName, chats, creatingProject]);

  // Messages the user typed while a run was still streaming. Held by the shared
  // queueing primitive and flushed one at a time as each run completes, so the
  // composer NEVER blocks typing while the AI is thinking — the same rule, and
  // the same implementation, as the Creation Canvas composer.
  const queuedTurns = useQueuedTurns({
    running: conv.sending,
    send: (text) => { void conv.send(text, { addressedTo: recipient }); },
    resetKey: chats.activeChat?.id ?? null,
  });

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
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
  }, [input, conv, queuedTurns, recipient]);

  // Capture execution: copy the Brain run's LLM/tool/error trace + transcript to
  // the clipboard — the Brain twin of the Observability/Logs "Copy triage info"
  // button, so a misbehaving run can be dropped straight into a bug report.
  // Was a local 'idle' | 'copied' | 'error' + a 2000ms reset — the same states the
  // shared hook owns, so it replaces the local copy verbatim.
  const capture = useCopyToClipboard();
  const modalityCopy = useModalityCopy();
  const localizedModalities = useLocalizedModalities();
  const personaLabel = useMemo(() => {
    if (personaSel.startsWith('modality:')) return tBrain('brainModality', { modality: modalityCopy(personaSel.slice('modality:'.length)).label });
    if (personaSel.startsWith('agent:')) {
      const a = brainAgents.find((x) => `agent:${x.agentKind}:${x.agentRef}` === personaSel);
      return a ? tBrain('brainAs', { name: agentName(a) }) : tBrain('brainTitle');
    }
    return tBrain('brainDefault');
  }, [personaSel, brainAgents, agentName, tBrain, modalityCopy]);
  const captureExecution = useCallback(async () => {
    // The write, the idle→copied/error→idle feedback and its 2000ms reset all live in the
    // shared hook. Thunk form: the payload is built on click, and a build that throws
    // lands on `error` exactly as the old try/catch around it did.
    await capture.copy(async () => {
      // Prepend a Chat diagnostics block (identity + Evermind wiring state + Signals) so a
      // pasted report answers "what STATE was this chat in?". Assembled by the SHARED
      // `gatherChatDiagnostics` — the same one the VS Code webview and the headless probe
      // call — so the three reports cannot drift field-by-field the way three inline
      // copies did. Best-effort per source inside the assembler: a failed fetch degrades
      // to null/[] so the copy never breaks.
      const chatId = chats.activeChatId;
      const chatProjectId = chats.activeChat?.projectId ?? null;
      const tenant = getStoredTenant();
      const user = getStoredUser();
      const diagnostics = await gatherChatDiagnostics({
        surface: 'Web',
        chatId,
        chatTitle: chats.activeChat?.title ?? null,
        projectId: chatProjectId,
        projectName: projects.find((p) => p.id === chatProjectId)?.name ?? null,
        selectedProjectId: pinnedProjectId ?? viewingProjectId ?? null,
        selectedProjectName:
          projects.find((p) => p.id === (pinnedProjectId ?? viewingProjectId))?.name ?? null,
        tenantId: tenant?.id ?? null,
        userId: user?.id ?? null,
        messages: conv.messages,
        // What the model could actually CALL. The COUNT is the live registry the
        // conversation runs on (`toolSpecs` — navigation + MCP catalog together), not
        // just the MCP subset; the catalog status explains a zero. The trace supplies
        // what was ACTUALLY advertised per turn, so this line and the Diagnostics block
        // below it can no longer answer one question two ways.
        tools: (() => {
          const mcp = getMcpToolStatus();
          return { count: toolSpecs.length, error: mcp.error, loading: mcp.loading };
        })(),
        trace: timelineTrace,
        model: personaModel ?? null,
        // Shared cached model surface — `fundingSurface` keeps the vendor tagging the
        // classifier needs, so this reads the list the pickers already loaded instead
        // of re-fetching /llm/v1/models on every capture.
        modelSurface: {
          data: llmModels.fundingSurface.data,
          byo: { models: llmModels.fundingSurface.byo.models, providers: llmModels.byoProviders },
          canUsePremiumModels: llmModels.canUsePremiumModels,
        },
        // Which build produced this capture — without it, a dump taken just before a
        // deploy is indistinguishable from one taken after.
        uiVersion: APP_VERSION,
        readAgents: () => (chatId != null ? brain.listChatAgents(chatId) : Promise.resolve([])),
        readTickets: () => (chatId != null ? brain.listChatTickets(chatId) : Promise.resolve([])),
        readEvermind: () => (chatProjectId != null ? getProjectEvermindContributions(chatProjectId) : Promise.resolve(null)),
        // Plan + month-to-date allowance. A free/card-less tenant's report must SAY so
        // rather than read as an unexplained capability failure. Shared cached snapshot
        // — the same one the header's <PlanBadge/> shows, so the report and the chip
        // can't disagree.
        readPlan: () => fetchConsumptionSnapshot(),
        // Session-cached AND time-bounded in the shared helper; shares the footer's
        // /health read rather than adding one.
        readApiVersion: () => fetchApiVersion(),
      });
      const diagBlock = formatChatDiagnostics(diagnostics).join('\n');
      return `${diagBlock}\n\n${conv.buildTriageReport(personaLabel)}`;
    });
  }, [capture, conv, personaLabel, personaModel, llmModels, toolSpecs, timelineTrace, chats.activeChatId, chats.activeChat, projects, pinnedProjectId, viewingProjectId]);

  // Shared chrome for the "capture execution" icon button (page + docked headers).
  const captureButton = (
    <button
      type="button"
      onClick={captureExecution}
      disabled={!conv.hasTrace}
      title={conv.hasTrace
        ? tBrain('captureHasTrace')
        : tBrain('captureNoTrace')}
      aria-label={tBrain('captureExecutionAria')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 24,
        padding: 0,
        fontSize: 'var(--font-size-small)',
        lineHeight: 1,
        background: 'var(--bg-elevated)',
        color: capture.state === 'error'
          ? 'var(--danger)'
          : capture.state === 'copied'
            ? 'var(--success, var(--success))'
            : 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        cursor: conv.hasTrace ? 'pointer' : 'not-allowed',
        opacity: conv.hasTrace ? 1 : 0.5,
      }}
    >
      <Icon name={capture.state === 'copied' ? 'check' : capture.state === 'error' ? 'close' : 'document'} size={14} />
    </button>
  );

  // Auto-link a one-shot work item on open (`?ticket=<kind>:<ref>`), so clicking an
  // item opens a chat already tied to it — the web parity for the VS Code "open task"
  // flow, reusing the SAME `brain.linkChatTicket` the picker uses. Ensures a chat
  // exists (deep-linked → active → a fresh project-scoped chat), links it, then lets
  // the ChatTicketsPanel refresh. `ticketReady` gates the prompt send so a combined
  // `?prompt=&ticket=` opens ONE chat (the linked one), not two.
  const ticketHandledRef = useRef(false);
  const [ticketReady, setTicketReady] = useState(() => !initialTicket);
  useEffect(() => {
    if (!initialTicket || ticketHandledRef.current || chats.loading) return;
    ticketHandledRef.current = true;
    void (async () => {
      try {
        let chatId = initialChatId ?? chats.activeChatId;
        if (chatId == null) {
          const created = await chats.create({ projectId: pinnedProjectId ?? viewingProjectId ?? null });
          chatId = created?.id ?? null;
        }
        if (chatId == null) return;
        await brain.linkChatTicket(chatId, { kind: initialTicket.kind as TicketKind, ref: initialTicket.ref, linkType: 'linked' });
        dispatchBrainDataChanged({ domain: 'brain', method: 'link' });
      } catch { /* best-effort auto-link — a failure never blocks the chat */ }
      finally { setTicketReady(true); }
    })();
  }, [initialTicket, initialChatId, chats, pinnedProjectId, viewingProjectId]);

  // Auto-send a one-shot SEED prompt (a home/landing-page prompt replayed after
  // auth, an IDE `?prompt=`). A seed starts a NEW conversation: the drawer
  // restores the chat you were last in, so sending straight away appended a
  // returning visitor's fresh idea to an old thread. `nextSeedPromptStep` decides
  // — clear the restored selection first, then send, at which point `conv.send`
  // creates the chat via `ensureChatId`. Refs (not state) so re-renders can never
  // re-send; `ticketReady` holds it until any auto-link has claimed its chat.
  const initialPromptSentRef = useRef(false);
  const initialPromptClearedRef = useRef(false);
  useEffect(() => {
    const text = initialPrompt?.trim() ?? '';
    const step = nextSeedPromptStep({
      prompt: text,
      ready: ticketReady && !chats.loading,
      alreadySent: initialPromptSentRef.current,
      targetChatId: initialChatId,
      targetTicket: initialTicket,
      activeChatId: chats.activeChatId,
      selectionCleared: initialPromptClearedRef.current,
    });
    if (step === 'clear-selection') {
      initialPromptClearedRef.current = true;
      void chats.select(null);
      return;
    }
    if (step !== 'send') return;
    initialPromptSentRef.current = true;
    if (!isPage) setDockedTab('chat');
    void conv.send(text);
  }, [initialPrompt, conv, ticketReady, initialChatId, initialTicket, isPage, chats]);

  const error = chats.error || conv.error;
  // The banner surfaces either source; dismissing must clear whichever is set.
  const dismissError = useCallback(() => { chats.setError(''); conv.clearError(); }, [chats, conv]);

  // Provider usage-cap banner — shown when a BYO provider's key hit its billing
  // limit this run. Keyed on the provider set so a new provider re-shows it.
  const [dismissedProviderCap, setDismissedProviderCap] = useState('');
  const providerCapKey = conv.providerCap.join(',');
  const showProviderCapBanner = conv.providerCap.length > 0 && dismissedProviderCap !== providerCapKey;

  // Unread messages sitting in chats OTHER than the open one — the reason to go
  // look at history at all, surfaced on the tab so it isn't a blind switch.
  const historyUnread = useMemo(
    () => chats.chats.reduce((n, c) => n + (c.id === chats.activeChatId ? 0 : (attn.chatUnread[c.id] ?? 0)), 0),
    [chats.chats, chats.activeChatId, attn.chatUnread],
  );

  // ---- Shared sub-renders ---------------------------------------------------

  const chatRows = (
    <>
      {chats.loading && <div style={{ padding: 12, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{tCommon('loading')}</div>}
      {!chats.loading && filteredChats.length === 0 && (
        <div style={{ padding: 12, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', textAlign: 'center' }}>
          {chats.chats.length === 0 ? tBrain('noChatsYet') : tBrain('noChatsMatch')}
        </div>
      )}
      {filteredChats.map((chat) => {
        const active = chats.activeChatId === chat.id;
        // Row actions are revealed per-row rather than "whatever is selected":
        // docked, opening a chat leaves the history tab, so tying the actions to
        // the selection put rename/delete somewhere the user can no longer see.
        const actionsOpen = actionsChatId === chat.id;
        return (
          <div
            key={chat.id}
            className={isPage ? `bs-chat-item ${active ? 'active' : ''}` : undefined}
            role="button"
            tabIndex={0}
            onClick={() => openChat(chat.id)}
            onKeyDown={(e) => e.key === 'Enter' && openChat(chat.id)}
            style={isPage ? undefined : {
              padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
              background: active ? 'var(--bg-elevated)' : 'transparent',
              borderLeft: active ? '3px solid var(--coral-bright)' : '3px solid transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--font-size-small)', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {renamingId === chat.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: '100%', fontSize: 'var(--font-size-small)', padding: 2, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}
                  />
                ) : chat.title}
              </div>
              {renamingId !== chat.id && (
                <button
                  type="button"
                  aria-expanded={actionsOpen}
                  aria-label={tBrain('chatActionsAria', { title: chat.title })}
                  title={tBrain('chatActions')}
                  onClick={(e) => { e.stopPropagation(); setActionsChatId(actionsOpen ? null : chat.id); }}
                  style={{ flexShrink: 0, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-small)', lineHeight: 1, borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: actionsOpen ? 'var(--bg-elevated)' : 'transparent', border: '1px solid', borderColor: actionsOpen ? 'var(--border-subtle)' : 'transparent', color: 'var(--text-muted)' }}
                >
                  ⋯
                </button>
              )}
            </div>
            <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {chat.projectId != null && pinnedProjectId == null && (
                <span style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-field-label)' }}>
                  {projectName(chat.projectId)}
                </span>
              )}
              {formatTime(fmt, chat.updatedAt)}
              <AttentionDot state={attn.chats[chat.id]?.state} />
              {/* Unread badge — new messages (execution milestones, teammate/agent
                  turns) in a chat you're not viewing. The OPEN chat is read, so it
                  never shows one. */}
              <UnreadBadge count={active ? 0 : attn.chatUnread[chat.id]} />
            </div>
            {actionsOpen && renamingId !== chat.id && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setRenamingId(chat.id); setRenameValue(chat.title); }} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 6px', cursor: 'pointer' }}>{tBrain('rename')}</button>
                <button type="button" onClick={() => onSummarize(chat.id)} disabled={summarizingId === chat.id} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 6px', cursor: 'pointer' }}>{summarizingId === chat.id ? '…' : tBrain('summarize')}</button>
                <button type="button" onClick={() => onDelete(chat)} disabled={deletingId === chat.id} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 6px', cursor: 'pointer', color: 'var(--coral-bright)' }}>{deletingId === chat.id ? '…' : tCommon('delete')}</button>
                {chat.projectId == null && pinnedProjectId == null && (
                  <label style={{ fontSize: 'var(--font-size-eyebrow)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {tBrain('addTo')}
                    <ThemeSelect
                      ariaLabel={tBrain('addChatToProjectAria')}
                      value=""
                      onChange={(val) => { if (val === '__new__') setShowNewProject(true); else if (val !== '') onAssign(chat.id, Number(val)); }}
                      options={[
                        { value: '', label: tBrain('addToProject') },
                        { value: '__new__', label: tBrain('createNewProject') },
                        ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                      ]}
                      style={{ marginLeft: 0, minWidth: 120, padding: '2px 6px', fontSize: 'var(--font-size-eyebrow)' }}
                    />
                    {busyId === chat.id && <span style={{ color: 'var(--text-muted)' }}>…</span>}
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  // One composer instance for both the pre-chat and active-chat states. Sending
  // from the empty state creates the chat through conv.ensureChatId; selecting a
  // capability can still seed and focus this same input.
  const promptComposer = (
    <ChatInput
      value={input}
      onChange={setInput}
      onSubmit={handleSend}
      placeholder={recipient ? tBrain('messageParticipant', { name: recipient.name }) : tBrain('messagePlaceholder')}
      disabled={false}
      running={conv.sending}
      onStop={conv.stop}
      queuedCount={queuedTurns.count}
      rows={2}
      submitOnEnter={false}
      onAttach={conv.attach}
      onAddContext={onAddContext}
      webBrowsing={webBrowsing}
      onWebBrowsingChange={setWebBrowsing}
      effort={effort}
      onEffortChange={setEffort}
      thinking={thinking}
      onThinkingChange={setThinking}
      accountSettingsHref="/settings"
      modelSelection={modelSelection}
      modelOptions={modelOptions}
      modelIdentity={modelIdentity}
      onModelSelectionChange={setModelSelection}
      autoMode={autoApprove}
      onAutoModeChange={setAutoApproveMode}
      // Chat | Work moved into the composer's `/` menu, which names the armed mode on
      // its trigger. One control less in a row that a phone could not fit, and the two
      // surfaces that have this setting now render it from the same place.
      chatMode={chatMode}
      onChatModeChange={selectMode}
      // Memory and the consolidate/fork actions live in that same `/` menu, for the
      // same reason and on both surfaces: three pills that were inert for most of a
      // chat's life used to sit between the mode control and Send.
      memoryEnabled={memoryEnabled}
      onMemoryChange={toggleMemory}
      memoryUnavailableReason={evermindProjectId == null ? tBrain('memoryUnavailable') : undefined}
      canConsolidate={canConsolidate}
      consolidating={consolidating}
      forking={forking}
      onConsolidate={consolidate}
      onFork={fork}
      showVoice
      pendingAttachments={conv.pendingAttachments}
      onRemoveAttachment={conv.removeAttachment}
      mentionables={participants}
      onMention={setRecipientChoice}
      focusToken={composerFocusToken}
      contextControls={<>
        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{tBrain('actingAs')}</span>
        <Select
          value={personaSel}
          onChange={(e) => choosePersona(e.target.value)}
          aria-label={tBrain('personaAria')}
          style={{ fontSize: 'var(--font-size-small)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        >
          <option value="default">{tBrain('defaultBrain')}</option>
          <optgroup label={tBrain('personas')}>
            {localizedModalities.map((m) => <option key={m.id} value={`modality:${m.id}`}>{m.label}</option>)}
          </optgroup>
          {brainAgents.length > 0 && (
            <optgroup label={tBrain('assignedAgents')}>
              {brainAgents.map((a) => <option key={a.id} value={`agent:${a.agentKind}:${a.agentRef}`}>{agentName(a)}</option>)}
            </optgroup>
          )}
        </Select>
        {chats.activeChatId != null && <BrainCapabilityPicker surface={capabilitySurface} value={capabilityId} onSelect={selectCapability} layout="compact" disabled={conv.sending} />}
        {participants.length > 0 && <>
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{tBrain('to')}</span>
          {/* WHO YOU ARE ADDRESSING, with their personality. The shared hovercard showed
              on /settings, the Workforce card and task-assignee chips — everywhere except
              the surface where you actually choose which agent to talk to. It reads the
              same provider map (mounted once below) and self-hides for a participant with
              no personality on file, so nothing changes for anyone who has not set one. */}
          {recipient && (
            <AssigneeHovercard selectValue={recipient.kind === 'agent' ? `c:${recipient.ref}` : `u:${recipient.ref}`}>
              <Avatar name={recipient.name} kind={recipient.kind} size={18} />
            </AssigneeHovercard>
          )}
          <Select
            value={recipient ? recipient.ref : 'brain'}
            onChange={(e) => setRecipientChoice(e.target.value === 'brain' ? 'brain' : (participants.find((p) => p.ref === e.target.value) ?? 'brain'))}
            aria-label={tBrain('recipientPickerTitle')}
            style={{ fontSize: 'var(--font-size-small)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            <option value="brain">{tBrain('brainRecipient')}</option>
            {participants.map((p) => <option key={p.ref} value={p.ref}>{p.name}</option>)}
          </Select>
        </>}
      </>}
      modeControls={chats.activeChatId != null ? <EvermindStatusBadge projectId={ctxProjectId} /> : undefined}
    />
  );

  const conversation = (
    <>
      {/* The message AND the fix: a 402/429 gets an Upgrade / Add-a-card action from
          the shared verdict, instead of dead-ending on prose. The verdict only
          applies to a CONVERSATION error — a chat-list failure isn't an entitlement
          problem, so it gets the plain dismissible banner. */}
      <BrainErrorBanner
        error={error}
        action={conv.error ? conv.errorAction : null}
        onDismiss={dismissError}
      />
      {/* Spent/nearly-spent token allowance — the state that silently degrades or
          truncates turns. Self-gating on the shared consumption snapshot. */}
      <AllowanceBanner />
      {showProviderCapBanner && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '8px 12px 0', padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--warning-bg, rgba(234,179,8,0.12))', color: 'var(--warning-text)', border: '1px solid var(--warning-border, rgba(234,179,8,0.3))', borderRadius: 'var(--radius-md)' }} role="status">
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {tBrain('providerCapBanner', { providers: conv.providerCap.join(', ') })}{' '}
            <Link href="/settings/integrations" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
              {tBrain('manageApiKeys')}
            </Link>
          </span>
          <button
            type="button"
            onClick={() => setDismissedProviderCap(providerCapKey)}
            title={tCommon('dismiss')}
            aria-label={tCommon('dismiss')}
            style={{ flex: '0 0 auto', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'var(--font-size-card-title)', lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>
      )}
      {chats.activeChatId == null ? (
        <div className={isPage ? 'bs-empty' : undefined} style={isPage ? undefined : { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-size-page-title)' }}><Icon source="🧠" size="1em" /></div>
          <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 500, color: 'var(--text-primary)' }}>{tBrain('brainTitle')}</div>
          <div style={{ fontSize: 'var(--font-size-small)' }}>{tBrain(chatMode === 'work' ? 'emptyHintWork' : 'emptyHint')}</div>
          {/* The mode goes ABOVE the composer, at full size: it decides what the very
              first turn is allowed to do, so it has to be a visible choice rather than
              a toolbar control the user finds afterwards. Choosing here rides into the
              chat `startNewChat` creates (see `pendingMode`). */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
            <ChatModeToggle value={chatMode} onChange={selectMode} />
            {/* File the conversation as it starts. New chats otherwise inherit the
                global scope silently, so a user with no project in scope had no way to
                put THIS conversation somewhere without first creating it. */}
            {pinnedProjectId == null && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                {tBrain('newChatProjectLabel')}
                <ThemeSelect
                  ariaLabel={tBrain('newChatProjectAria')}
                  value={filterProjectId ?? ''}
                  onChange={setFilterProjectId}
                  options={[
                    { value: '', label: tBrain('noProject') },
                    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                  style={{ minWidth: 140, padding: '4px 8px', fontSize: 'var(--font-size-small)' }}
                />
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" onClick={() => { void startNewChat(); }} style={{ padding: '10px 18px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }}>
              {tBrain('startNewChat')}
            </button>
            {/* Onboarding entry point — starts a chat seeded so the Brain guides a
                new user (scope, costs, plan recommendation, connecting an AI account). */}
            <button
              type="button"
              onClick={() => { void startNewChat(); setInput(tBrain('onboardMePrompt')); setComposerFocusToken((n) => n + 1); }}
              style={{ padding: '10px 18px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'transparent', color: 'var(--coral-bright)', border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }}
            >
              
              <Icon source="✨" size="1em" /> {tBrain('onboardMe')}
            </button>
          </div>
          <div style={{ width: '100%', maxWidth: 720, marginTop: 12 }}>{promptComposer}</div>
          {/* WORK: the jobs people actually hand over. Picking one fills the composer
              with a complete brief to edit. Self-gating on the mode. */}
          <WorkOptionsPicker mode={chatMode} onPick={pickWorkOption} />
          {/* CHAT: …or start from what you want to make. Picking one opens a chat
              already in that capability. The two are alternatives, not a stack — a
              user in Work mode is delegating a job, not choosing an export format. */}
          {chatMode !== 'work' && (
            <BrainCapabilityPicker
              surface={capabilitySurface}
              value={capabilityId}
              onSelect={selectCapability}
              layout="tiles"
            />
          )}
        </div>
      ) : (
        <>
          {isPage && pinnedProjectId == null && (
            <ConversationHeader
              chat={chats.activeChat}
              projects={projects}
              projectName={projectName}
              onAssign={onAssign}
              onNewProject={() => setShowNewProject(true)}
            />
          )}
          {chats.activeChat && (
            <ChatTicketsPanel
              chatId={chats.activeChat.id}
              projectId={chats.activeChat.projectId ?? pinnedProjectId ?? viewingProjectId ?? null}
              chatList={chats.chats}
              onChanged={onTicketsChanged}
            />
          )}
          {showNewProject && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 12px', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                placeholder={tBrain('newProjectPlaceholder')}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProjectAndAssign()}
                style={{ flex: 1, padding: '8px 10px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
              />
              <button type="button" onClick={createProjectAndAssign} disabled={!newProjectName.trim() || creatingProject} style={{ padding: '8px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                {creatingProject ? '…' : tBrain('createAndAssign')}
              </button>
              <button type="button" onClick={() => { setShowNewProject(false); setNewProjectName(''); }} style={{ padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tCommon('cancel')}</button>
            </div>
          )}
          <div className="bs-messages" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <BrainTimeline
              messages={conv.messages}
              trace={timelineTrace}
              streamingText={conv.sending ? conv.streamingText : ''}
              isRunning={conv.sending}
              loading={conv.loadingMessages}
              labels={timelineLabels}
              modelIdentity={modelIdentity}
              onApplyCode={timelineApplyCode}
              onCreateFile={timelineCreateFile}
              // Answering an ask_user card posts the choice as the next user turn.
              onAnswerQuestion={onAnswerTimelineQuestion}
              // Reuse the web's rich markdown (mermaid, router links, code-apply) so
              // no feature is lost; the model-authored "next step" JSON is lifted out.
              renderMessage={renderTimelineMessage}
              renderStreaming={renderTimelineStreaming}
              renderAssistantActions={renderTimelineAssistantActions}
              onReplayMessage={onReplayTimelineMessage}
              // Thumbs live in the shared action row now; the press files a durable
              // rating against the model + MCP tool that served the turn.
              onRateMessage={conv.rateMessage}
              ratings={conv.ratings}
            />
          </div>
          {/* Composer chrome uses the shared --chat-ctl-* metrics (globals.css) so the
              toolbar, the input box and the docked panel breathe the same amount —
              docked, this is a ~310px column, where the old fixed 12/16px padding and
              8px stack gaps ate most of the width. */}
          <div className="bs-input-area" style={{ flexShrink: 0, padding: isPage ? undefined : 'var(--chat-ctl-pad-y, 6px) var(--chat-ctl-pad-x, 8px)', borderTop: isPage ? undefined : '1px solid var(--border-subtle)' }}>
            {pendingConfirm && <ToolConfirmBar req={pendingConfirm} onDecide={resolveConfirm} onApproveAll={approveAll} />}
            {pendingQuestion && (
              <PendingQuestionBanner
                payload={pendingQuestion.payload}
                labels={askLabels}
                onAnswer={onAnswerTimelineQuestion}
                onReveal={revealPendingQuestion}
              />
            )}
            {promptComposer}
            {conv.uploading && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4 }}>{tBrain('uploading')}</div>}
          </div>
        </>
      )}
      {repoPickerOpen && (
        <RepoContextPicker
          sources={contextSources}
          onPick={attachRepoFile}
          onClose={() => setRepoPickerOpen(false)}
        />
      )}
    </>
  );

  // ---- Layouts (chrome only) ------------------------------------------------

  if (isPage) {
    return (
      // ONE fetch of the tenant's personality map for the whole panel, so the recipient
      // hovercard above costs no per-render request and self-hides for anyone with no
      // personality on file.
      <AssigneeProfilesProvider>
      <div className="bs-shell" style={{ marginBottom: 0 }}>
        <div className="bs-sidebar">
          <div className="bs-sidebar-header">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--font-size-body)', color: 'var(--text-strong)' }}>{tBrain('brainStorm')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {/* Which plan funds this chat, and what's left of the allowance —
                    stated up front rather than after a turn dies on the cap. */}
                <PlanBadge />
                {captureButton}
                <button type="button" onClick={() => { void startNewChat(); }} style={{ padding: '4px 10px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                  {tBrain('newChat')}
                </button>
              </div>
            </div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 'var(--font-size-small)', color: 'var(--muted)' }}>
              {tBrain('projectLabel')}
              <span style={{ display: 'block', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2 }}>{tBrain('newChatsHint')}</span>
              <ThemeSelect
                ariaLabel={tBrain('filterByProjectAria')}
                value={filterProjectId ?? ''}
                onChange={(v) => setFilterProjectId(v)}
                options={[
                  { value: '', label: tBrain('allProjects') },
                  { value: 'none', label: tBrain('noProject') },
                  ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                ]}
                style={{ marginTop: 4 }}
              />
            </label>
            <input type="search" placeholder={tBrain('searchChats')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
          </div>
          <div className="bs-chat-list">{chatRows}</div>
        </div>
        <div className="bs-main"><AiDisclosure />{conversation}</div>
      </div>
      </AssigneeProfilesProvider>
    );
  }

  // Docked drawer
  return (
    <AssigneeProfilesProvider>
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      <div style={{ flexShrink: 0, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon source="🧠" size="1em" /> {tBrain('brainTitle')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {/* Plan + remaining allowance (see the page header). */}
          <PlanBadge />
          {captureButton}
          <button type="button" onClick={() => { void startNewChat(); }} style={{ padding: '4px 10px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tBrain('newChat')}</button>
          {/* Expand → full Brain Storm page. Carry the ACTIVE chat id (and the
              project it's scoped to) so the page opens the SAME conversation
              instead of a blank one — otherwise expanding a docked chat (e.g. the
              Designer/Website Builder chat) looked like it "deleted" the chat. */}
          <Link
            href={(() => {
              const qs = new URLSearchParams();
              if (chats.activeChatId != null) qs.set('chat', String(chats.activeChatId));
              const proj = pinnedProjectId ?? ctxProjectId ?? null;
              if (proj != null) qs.set('project', String(proj));
              const s = qs.toString();
              return s ? `/brainstorm?${s}` : '/brainstorm';
            })()}
            title={tBrain('openFullBrainStorm')}
            style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', textDecoration: 'none', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}
          >{tBrain('expand')}</Link>
          {onClose && (
            <button type="button" onClick={onClose} aria-label={tBrain('closeBrain')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 'var(--font-size-card-title)', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          )}
        </div>
      </div>
      {/* Conversation and history are peers, not a disclosure stacked on top of
          the thread: in a ~440px drawer the old accordion ate a third of the
          reading height and still hid past chats one click deep. */}
      <div role="tablist" aria-label={tBrain('sectionsAria')} style={{ flexShrink: 0, display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        {DOCKED_TABS.map(({ id, labelKey }) => {
          const selected = dockedTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`brain-tab-${id}`}
              aria-selected={selected}
              aria-controls={`brain-tabpanel-${id}`}
              onClick={() => setDockedTab(id)}
              style={{
                flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '6px 10px', fontSize: 'var(--font-size-small)', fontWeight: 600, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                border: `1px solid ${selected ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                background: selected ? 'var(--bg-elevated)' : 'var(--bg-base)',
                color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tBrain(labelKey)}</span>
              {/* History carries the "there is something waiting in another chat"
                  signal, so switching tabs is worth doing rather than guessing. */}
              {id === 'history' && <UnreadBadge count={historyUnread} size={16} />}
            </button>
          );
        })}
      </div>
      {dockedTab === 'history' ? (
        <div id="brain-tabpanel-history" role="tabpanel" aria-labelledby="brain-tab-history" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div style={{ padding: '8px 12px' }}>
            <input type="search" placeholder={tBrain('searchChats')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </div>
          {chatRows}
        </div>
      ) : (
        <div id="brain-tabpanel-chat" role="tabpanel" aria-labelledby="brain-tab-chat" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <AiDisclosure />
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{conversation}</div>
        </div>
      )}
    </div>
    </AssigneeProfilesProvider>
  );
}

/** Docked drawer sections. Order is the tab order. */
const DOCKED_TABS = [
  { id: 'chat', labelKey: 'tabChat' },
  { id: 'history', labelKey: 'tabHistory' },
] as const;

function AiDisclosure() {
  const tBrain = useTranslations('brain');
  return (
    <aside aria-label={tBrain('aiDisclosureAria')} style={{ flexShrink: 0, padding: '7px 12px', fontSize: 'var(--font-size-eyebrow)', lineHeight: 1.45, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
      {tBrain('aiDisclosureBody')}{' '}
      <Link href="/legal/ai-transparency">{tBrain('aiDisclosureLink')}</Link>.
    </aside>
  );
}

// --- Internal pieces -------------------------------------------------------

/**
 * Human-in-the-loop confirm bar. Shown when the agent loop pauses on a mutating
 * tool call; Approve runs it, Cancel feeds a declined result back to the model.
 */
function ToolConfirmBar({ req, onDecide, onApproveAll }: { req: { name: string; args: unknown }; onDecide: (ok: boolean) => void; onApproveAll: () => void }) {
  const tCommon = useTranslations('common');
  const tBrain = useTranslations('brain');
  const label = req.name.replace(/_/g, ' ');
  let preview = '';
  try {
    const s = JSON.stringify(req.args ?? {});
    preview = s.length > 240 ? `${s.slice(0, 240)}…` : s;
  } catch { preview = ''; }
  return (
    <div
      role="alertdialog"
      aria-label={tBrain('confirmActionAria')}
      style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--coral-bright)', background: 'var(--bg-elevated)' }}
    >
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', marginBottom: 6 }}>
        
        <Icon source="⚠️" size="1em" /> {tBrain.rich('wantsTo', { action: label, b: (chunks) => <strong>{chunks}</strong> })}
      </div>
      {preview && preview !== '{}' && (
        <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 8 }}>{preview}</div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onDecide(true)} style={{ padding: '6px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--coral-bright)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tCommon('approve')}</button>
        <button type="button" onClick={onApproveAll} title={tBrain('approveAllTitle')} style={{ padding: '6px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--bg-base)', color: 'var(--coral-bright)', border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tBrain('approveAll')}</button>
        <button type="button" onClick={() => onDecide(false)} style={{ padding: '6px 14px', fontSize: 'var(--font-size-small)', background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tCommon('cancel')}</button>
      </div>
    </div>
  );
}

function MessageActions({ msg, conv, projectId, capability, chatTitle, suggestions, onRunSuggestion }: {
  msg: BrainMessage;
  conv: ReturnType<typeof useBrainConversation>;
  projectId?: number;
  /** The chat's capability — drives the reply's "Download as …" action. */
  capability?: string | null;
  chatTitle?: string;
  /** Model-authored next-step buttons parsed from this reply. */
  suggestions?: SuggestedAction[];
  onRunSuggestion?: (prompt: string) => void;
}) {
  // Only the newest assistant turn is worth judging/retrying for a missing artifact.
  const lastAssistantId = [...conv.messages].reverse().find((m) => m.role === 'assistant' && !isStepMessage(m))?.id;
  return (
    <>
      {suggestions && suggestions.length > 0 && onRunSuggestion && (
        <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onRunSuggestion(s.prompt)}
              disabled={conv.sending}
              title={s.prompt}
              style={{
                fontSize: 'var(--font-size-small)',
                fontWeight: 600,
                padding: '5px 12px',
                cursor: conv.sending ? 'wait' : 'pointer',
                background: 'var(--coral-bright)',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {/* A capability reply that never produced its artifact reads as "nothing
          happened" — say so, and offer to ask for it explicitly. */}
      <CapabilityArtifactNotice
        capability={capability}
        content={msg.content}
        streaming={conv.sending}
        isLatest={msg.id === lastAssistantId}
        onRetry={(prompt) => { void conv.send(prompt); }}
      />
      {/* Thumbs are no longer here — they live in the shared <BrainTimeline> action
          row so the Canvas and the editor rate turns too. */}
      <ChatMessageActions
        projectId={projectId}
        capability={capability}
        chatTitle={chatTitle}
        assistantContent={msg.content}
        conversationMessages={conv.messages.filter((m) => !isStepMessage(m)).map((m) => ({ role: m.role, content: m.content }))}
      />
    </>
  );
}

function ConversationHeader({ chat, projects, projectName, onAssign, onNewProject }: {
  chat: BrainChat | null;
  projects: Project[];
  projectName: (id: number | null) => string;
  onAssign: (chatId: number, projectId: number | null) => void;
  onNewProject: () => void;
}) {
  const tBrain = useTranslations('brain');
  if (!chat) return null;
  return (
    <div className="bs-chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-body)', color: 'var(--text-strong)' }}>{chat.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {chat.projectId == null ? (
          <>
            <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {tBrain('assignToProject')}
              <ThemeSelect
                ariaLabel={tBrain('assignChatToProjectAria')}
                value=""
                onChange={(val) => { if (val === '__new__') onNewProject(); else if (val !== '') onAssign(chat.id, Number(val)); }}
                options={[
                  { value: '', label: tBrain('noProject') },
                  { value: '__new__', label: tBrain('createNewProject') },
                  ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                ]}
                style={{ minWidth: 140, padding: '4px 8px', fontSize: 'var(--font-size-small)' }}
              />
            </label>
            <button type="button" onClick={onNewProject} style={{ fontSize: 'var(--font-size-small)', padding: '4px 8px', cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}>{tBrain('addProject')}</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)' }}>{projectName(chat.projectId)}</span>
            <Link href={`/workflows?project=${chat.projectId}`} style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>{tBrain('workflowsArrow')}</Link>
            <Link href={`/create/build/${chat.projectId}?chat=${chat.id}`} style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--coral-bright)', textDecoration: 'none', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--coral-bright)' }}>{tBrain('openInBuilder')}</Link>
          </>
        )}
      </div>
    </div>
  );
}
