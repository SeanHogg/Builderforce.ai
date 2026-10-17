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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useBrainConversation,
  useBrainConfig,
  consolidationMarkerContent,
  consolidationMetadata,
  DEFAULT_PERSONA,
  loadBrainPersonaAgentsVia,
  personaModel,
  personaOverlay,
  parseByoUnresolved,
  deriveChatTitle,
  DEFAULT_CHAT_TITLE,
  buildComposerDirectives,
  effortProfile,
  useToolConfirmationGate,
  reasoningForRun,
  gatherChatDiagnostics,
  buildChatDiagnosticsReport,
  traceWithPersistedSteps,
  getMcpToolStatus,
  fetchApiVersionVia,
  NEW_CHAT_MODE,
  normalizeChatMode,
  projectMemoryHooks,
  lastServedModel,
  chatRosterFromParticipants,
  type ChatMode,
  type ChatRosterAgent,
  type BrainChat,
  type DirectedRecipient,
  type BrainPersonaAgent,
  type BrainPersonaChoice,
  type BrainMessage,
} from '@seanhogg/builderforce-brain-embedded';
import { authedFetch } from '../authedFetch';
import {
  BrainTimeline, ChatTicketsPanel, DEFAULT_CHAT_TICKETS_LABELS, useChatParticipants, useChatActivitySignal,
  useRecipientChoice, ChatErrorBanner, useChatMemorySwitch,
  PendingQuestionBanner, selectPendingAskUser, askUserAnchorId,
  chatSwitcherLabel, chatDiagnosticsReads, useQueuedTurns,
} from '@seanhogg/builderforce-brain-ui';
import { createChatTicketsAdapter } from '../chatTicketsAdapter';
import { adoptChatProject } from '../adoptChatProject';
import { usePendingChangesExtension } from '../usePendingChangesExtension';
import { useChatChangedFiles } from '../useChatChangedFiles';
import { WEBVIEW_BUILD_ID, WEBVIEW_BUILT_AT } from '../webviewBuildInfo';
import { openUpgrade } from '../accountPlan';
import { fetchPlanSnapshot, invalidatePlanSnapshot } from '../planSnapshot';
import {
  getToken,
  getEditorContext,
  onIntent,
  onEditorContext,
  post,
  request,
  refreshToken,
  type BrainIntent,
  type EditorContext,
  type InitData,
} from '../vscodeBridge';
import { setHostRunContext } from '../hostRunDriver';
import { activeProjectDirective, editorContextDirective } from '../../../src/idePersona';
import { buildTranscript, hasTranscriptContent } from '../transcript';
import { autoApprovePersistence } from '../autoApprove';
import { decodeTokenClaims } from '@/lib/tokenClaims';
import { makeT, promptMenuLabels, timelineLabels } from './chatLabels';
import { spendLabelsFrom } from './composerLabels';
import { IconRename } from './ChatMenu';
import { useGlobalRunState } from './useGlobalRunState';
import type { QueuedTurn } from './QueuedMessages';
import { SubagentStrip } from './SubagentStrip';
import { childParticipants, childTarget, isWaitingOnSubagents, steerRun, subagentDiagnosticsOf, useChatChildren, useChatSubagentRoster } from './chatChildren';
import { useComposerModels } from './useComposerModels';
import { useRunShaping } from './useRunShaping';
import { VsCodeComposer } from './VsCodeComposer';


export function VsCodeChatSurface({ init }: { init: InitData }) {
  const t = makeT(init.labels);
  const { persistence } = useBrainConfig();
  const [chatId, setChatId] = useState<number | null>(null);
  const [chats, setChats] = useState<BrainChat[]>([]);
  // Inline rename of the selected chat: the header select swaps to a text field
  // (VS Code webviews block window.prompt, so editing is inline — the same pattern
  // the web Brain's history list uses). Commits via persistence.updateChat.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // Auto-approve skips the per-action confirm prompt. The gate is the SHARED hook, so
  // the invariant that makes it work — the flag is read through a REF, because a run's
  // tool loop captures `needsConfirm` at run START and a plain state read would keep
  // prompting for the rest of an in-flight run (the "checked the box and still got 3
  // prompts" bug) — is stated once instead of re-derived per surface.
  //
  // Persisted here too: a webview reload used to reset the toggle while the web app
  // remembered it, so one product decision was answered two ways by accident. The guarded
  // storage accessor is the shared one; the KEY and the default (off in the editor, where
  // a mutating tool touches the user's real working tree) are this surface's policy.
  // `defaultOn` carries the SETTING, not a constant: it is both the seed for a panel
  // that has never been toggled and the hook's re-read trigger, so a setting change
  // reaches an open panel (the host re-pushes init on `onDidChangeConfiguration`).
  //
  // The gate PREDICATE itself is evaluated by the host (`nativeNeedsConfirm`, against
  // the tool catalog it owns); this panel only owns the switch and its persistence,
  // and tells the host every time it moves (see `setHostRunContext`).
  const autoApproveSetting = init.autoApproveDefault ?? false;
  const {
    autoApprove,
    setAutoApprove: setAutoApproveMode,
  } = useToolConfirmationGate({
    isMutating: () => true,
    persistence: useMemo(() => autoApprovePersistence(autoApproveSetting), [autoApproveSetting]),
    defaultOn: autoApproveSetting,
  });
  const [input, setInput] = useState('');
  // Stable reference so a keystroke (which re-renders this component) does not hand
  // <BrainTimeline> a fresh `labels` object and defeat its React.memo — otherwise the
  // whole transcript (and every message's markdown) re-parses on every character typed.
  const tlLabels = useMemo(() => timelineLabels(init.labels), [init.labels]);
  const spendLabels = useMemo(() => spendLabelsFrom(init.labels), [init.labels]);
  // idle → copied → idle, or → error. A copy that FAILS must look different from one
  // that never ran: the ⧉ used to be wired as `void copyTranscript()`, so any rejection
  // inside it vanished with no toast, no error and nothing on the clipboard — a click
  // indistinguishable from an unwired button.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  // Consolidate (summarize into a compact base context) / Fork (branch into a new
  // chat from that summary) are async, so guard against double-clicks while in flight.
  const [consolidating, setConsolidating] = useState(false);
  const [forking, setForking] = useState(false);
  // Composer run-shaping toggles (Effort / Thinking / Browse the web) — REAL request
  // params, persisted per person; see `useRunShaping`.
  const shaping = useRunShaping();
  const { effort, thinking, webBrowsing } = shaping;
  // The per-turn LIMBIC/affective block for the CURRENT turn — fetched from the host
  // (which calls the gateway's affective endpoint with the user's personality) on each
  // submit and folded into extraSystem, so the next run executes under the SAME limbic
  // layer as the native participant + cloud/on-prem agents. Lingers as the last computed
  // block until the next submit refreshes it; '' when neutral / offline (a no-op).
  const [turnLimbic, setTurnLimbic] = useState('');
  // The webview reaches /api/brain directly (CORS allows the webview origin), the same
  // path persistence uses — a shared bearer fetch for the trace persist + rehydrate below.
  const apiReq = useMemo(() => authedFetch(init.baseUrl, getToken, () => void refreshToken()), [init.baseUrl]);

  // Scope the conversation dropdown to the sidebar's active project so its list
  // MATCHES the Sessions tree (which filters by project). With no project selected
  // both show every chat. Server-side filter via ?projectId (same rows the sidebar
  // filters client-side). Re-runs when the project switches (init.project?.id dep).
  // `chats.changed` makes the host refetch the Sessions tree. Tell it only when the list
  // actually moved: every ticket write in a run re-reads this list, and most re-reads
  // come back identical.
  const lastChatsSig = useRef<string | null>(null);
  const reloadChats = useCallback(() => {
    const projectId = init.project?.id != null ? String(init.project.id) : undefined;
    persistence.listChats({ limit: 50, projectId })
      .then((list) => {
        setChats(list);
        const sig = JSON.stringify(list);
        if (sig === lastChatsSig.current) return;
        lastChatsSig.current = sig;
        post('chats.changed');
      })
      .catch(() => {});
  }, [persistence, init.project?.id]);
  useEffect(() => { reloadChats(); }, [reloadChats]);

  // Auto-name a still-untitled chat from its first user message, so the dropdown +
  // Sessions tree stop showing "New chat". The VSIX manages its own chat list (it does
  // not use the shared useBrainChats), so it runs the SAME shared `deriveChatTitle`
  // helper here. Single-flight per chat; only replaces the placeholder (English default
  // OR the localized "New chat" ensureChatId seeds) — never an intentional/ticket title.
  const chatsRef = useRef<BrainChat[]>(chats);
  chatsRef.current = chats;
  const autoTitledRef = useRef<Set<number>>(new Set());
  const autoTitleChat = useCallback((id: number, firstUserText: string) => {
    if (autoTitledRef.current.has(id)) return;
    const chat = chatsRef.current.find((c) => c.id === id);
    const localizedDefault = t('app.newChat', 'New chat');
    if (chat && chat.title && chat.title !== DEFAULT_CHAT_TITLE && chat.title !== localizedDefault) return;
    const title = deriveChatTitle(firstUserText);
    if (!title) return;
    autoTitledRef.current.add(id);
    persistence.updateChat(id, { title })
      .then(() => reloadChats())
      .catch(() => { autoTitledRef.current.delete(id); });
  }, [persistence, reloadChats, t]);

  // The open chat may not be in the project-filtered list — e.g. it belongs to
  // another project, or was just created for a task scoped elsewhere. Fetch it so
  // the dropdown still shows + keeps it selected instead of going blank.
  const [orphanChat, setOrphanChat] = useState<BrainChat | null>(null);
  useEffect(() => {
    if (chatId == null || chats.some((c) => c.id === chatId)) { setOrphanChat(null); return; }
    let cancelled = false;
    persistence.getChat(chatId).then((c) => { if (!cancelled) setOrphanChat(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [chatId, chats, persistence]);
  // The dropdown's rows: the project-scoped list, plus the open cross-project chat.
  const chatOptions = useMemo(
    () => (orphanChat && orphanChat.id === chatId ? [orphanChat, ...chats] : chats),
    [orphanChat, chatId, chats],
  );

  // Which chats are LIVE right now (across the whole run store, not just the open
  // one). The agent loop is module-level, so switching to a new chat never stops
  // the prior one — these indicators make that visible: a still-running chat and a
  // chat paused on a confirm both light up in the dropdown here, and are reported
  // to the host so the Sessions sidebar lights them up too.
  const runState = useGlobalRunState();
  const runningSet = useMemo(() => new Set(runState.running), [runState]);
  const awaitingSet = useMemo(() => new Set(runState.awaiting), [runState]);
  // A leading glyph for a chat option: ❓ when it needs an answer (a confirm the
  // user must approve — actionable), ● while it's executing, else nothing. Symbols,
  // not prose (native <option> can't hold an icon), so no localization needed.
  const runGlyph = useCallback(
    (id: number) => (awaitingSet.has(id) ? '❓ ' : runningSet.has(id) ? '● ' : ''),
    [awaitingSet, runningSet],
  );

  // LOCK state for the open chat (owner-only toggle in the People section).
  const [chatVisibility, setChatVisibility] = useState<'shared' | 'locked'>('shared');
  const [chatIsOwner, setChatIsOwner] = useState(false);
  useEffect(() => {
    if (chatId == null) { setChatVisibility('shared'); setChatIsOwner(false); return; }
    let cancelled = false;
    persistence.getChat(chatId).then((c) => {
      if (cancelled) return;
      const meta = c as unknown as { visibility?: 'shared' | 'locked'; isOwner?: boolean };
      setChatVisibility(meta.visibility ?? 'shared');
      setChatIsOwner(!!meta.isOwner);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [chatId, persistence]);

  // The mode the composer is ARMED with before a conversation exists (see the Chat|Work
  // block below). Held here because `ensureChatId` seeds the created chat with it, and
  // mirrored into a ref so that callback does not have to re-create on every switch.
  const [pendingMode, setPendingMode] = useState<ChatMode>(NEW_CHAT_MODE);
  const pendingModeRef = useRef<ChatMode>(NEW_CHAT_MODE);
  pendingModeRef.current = pendingMode;
  // The Memory switch as armed before the chat exists — seeds the chat `ensureChatId`
  // creates, the same way the mode does. Mirrored from the switch below.
  const pendingMemoryRef = useRef(true);

  // Scope new chats to the sidebar's active project (same as task-seeded chats),
  // so a conversation is associated with the project it's about server-side.
  const ensureChatId = useCallback(async () => {
    if (chatId != null) return chatId;
    const created = await persistence.createChat({
      title: t('app.newChat', 'New chat'),
      projectId: init.project?.id ?? null,
      // The composer's armed mode, not a server default — otherwise choosing Chat and
      // then typing creates a Work chat and the very first turn runs in the wrong mode.
      mode: pendingModeRef.current,
    });
    const chat = pendingMemoryRef.current
      ? created
      : await persistence.updateChat(created.id, { memoryEnabled: false }).catch(() => created);
    // In the list at once, so the switch reads the new row instead of the column default.
    setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev]));
    setChatId(chat.id);
    reloadChats();
    return chat.id;
  }, [chatId, persistence, reloadChats, t, init.project?.id]);

  // The project this chat is associated with — the SINGLE chat-first resolution reused
  // by the system-prompt directive, header label, Evermind scope, and triage report.
  // An existing chat uses its OWN project (brain_chats.projectId); a not-yet-created
  // chat falls back to the sidebar's active project it will be scoped to on first send.
  // Names resolve from the host's projectId→name map, falling back to the sidebar name.
  const activeChat = useMemo(() => chatOptions.find((c) => c.id === chatId) ?? null, [chatOptions, chatId]);
  // Tell the host which conversation this panel is showing. With
  // `builderforce.sessionTabs: perSession` the host binds its TAB to that chat —
  // naming the tab after the conversation and tracking its live status — and a
  // brand-new chat (no server id until first send) re-keys its tab here once created.
  // Title is left undefined rather than blanked while the chat is still loading.
  const sessionTitle = activeChat?.title ?? (chatId == null ? t('app.newChat', 'New chat') : undefined);
  useEffect(() => {
    post('session.meta', { chatId: chatId ?? undefined, title: sessionTitle });
  }, [chatId, sessionTitle]);
  const associatedProjectId = activeChat ? activeChat.projectId : (init.project?.id ?? null);
  // ---- Chat | Work mode -----------------------------------------------------
  // A property of the CONVERSATION (migration 0409), not of this editor: the same chat
  // opened on the web must mean the same thing here. The IDE used to hard-wire Work —
  // every turn carried the ticket-linking directive — so a VS Code user could not ask a
  // question without the model also being told to open a ticket about the answer, and a
  // chat switched to Chat on the web still ran as Work in the editor.
  //
  // `pendingMode` covers the pre-chat state (no server row yet, so nothing to read a
  // mode off): it seeds the chat `ensureChatId` creates, so picking Chat and then typing
  // cannot silently mint a Work chat. It defaults to NEW_CHAT_MODE — Work — which is the
  // IDE's existing behaviour, kept deliberately: an edit in an editor really should
  // become tracked work.
  const chatMode: ChatMode = activeChat ? normalizeChatMode(activeChat.mode) : pendingMode;
  const selectMode = useCallback((mode: ChatMode) => {
    setPendingMode(mode);
    if (chatId == null) return;
    // Optimistic: the picker IS the switch, so the menu must not lag the click. The
    // authoritative value comes back on the next `reloadChats`.
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, mode } : c)));
    persistence.updateChat(chatId, { mode })
      .then(() => reloadChats())
      .catch(() => reloadChats());
  }, [chatId, persistence, reloadChats]);

  const associatedProject = useMemo<{ id: number; name: string } | null>(() => {
    if (associatedProjectId == null) return null;
    const name = init.projectNames?.[String(associatedProjectId)]
      ?? (associatedProjectId === init.project?.id ? init.project?.name : undefined);
    return { id: associatedProjectId, name: name ?? `#${associatedProjectId}` };
  }, [associatedProjectId, init.projectNames, init.project?.id, init.project?.name]);

  // Ambient project context — the SAME `extraSystem` channel the web Brain uses to tell
  // the model the current project, so platform tools (repos.*/tasks.*/…) default to it
  // instead of asking for a projectId. Chat-FIRST: a chat that belongs to a project
  // always tells the model about ITS OWN project regardless of what the sidebar is
  // currently showing — fixing the bug where opening a project chat while the sidebar
  // had a different (or no) project left the agent not knowing which project it was in.
  // The id-less deltaVisibilityDirective is intentionally not appended here — it is
  // folded into the shared run loop's chat-work-linking directive with the resolved
  // chatId, so the ticket it mints actually links to THIS conversation.
  const projectDirective = useMemo(
    () => activeProjectDirective(associatedProject) ?? '',
    [associatedProject?.id, associatedProject?.name],
  );

  // Live editor context (active file / selection / open tabs), pushed by the host as
  // the user navigates, so the agent always knows what file is open and can resolve
  // "this file" / "the selection" without guessing a path. Seeded from init.
  const [editorCtx, setEditorCtx] = useState<EditorContext | undefined>(getEditorContext);
  useEffect(() => onEditorContext(setEditorCtx), []);
  const editorDirective = useMemo(() => editorContextDirective(editorCtx) ?? '', [editorCtx]);

  // WHO the Brain answers as ("Acting as"): the default editor Brain, a modality
  // persona, or an agent assigned to the Brain — the same choices, from the same shared
  // persona domain, as the web composer. Here the persona LAYERS over the editor's own
  // prompt (which describes the real workspace, file tools and repository) instead of
  // replacing it — see `personaOverlay`. An agent persona also prefers the agent's own
  // model; an explicit model pin in the `/` menu still wins.
  const [persona, setPersona] = useState<BrainPersonaChoice>(DEFAULT_PERSONA);
  const [personaAgents, setPersonaAgents] = useState<BrainPersonaAgent[]>([]);
  useEffect(() => {
    let live = true;
    loadBrainPersonaAgentsVia(apiReq)
      .then((agents) => { if (live) setPersonaAgents(agents); })
      .catch(() => { /* no assigned agents to offer — the modality personas still are */ });
    return () => { live = false; };
  }, [apiReq]);
  const personaDirective = useMemo(() => personaOverlay(persona, personaAgents) ?? '', [persona, personaAgents]);
  const personaModelId = useMemo(() => personaModel(persona, personaAgents), [persona, personaAgents]);

  // Fold the composer toggles (effort / thinking / web), the live editor context,
  // and the user's affective/PERSONALITY block into the same system channel as the
  // project context, so the next turn honors them. The DYNAMIC per-turn limbic block
  // (fetched on submit) wins when present — it already carries the personality tone
  // plus this turn's affect, giving webview per-turn limbic parity with the native
  // participant; before the first send it falls back to the STATIC personality block
  // (host-fetched once per session). '' (a no-op) when the user has no profile.
  const extraSystem = useMemo(
    () => [personaDirective, projectDirective, editorDirective, buildComposerDirectives({ effort, web: webBrowsing }), turnLimbic || init.personalityBlock || '']
      .filter(Boolean)
      .join('\n\n'),
    [personaDirective, projectDirective, editorDirective, effort, webBrowsing, turnLimbic, init.personalityBlock],
  );

  // The REAL request params behind the `/` menu. `maxTokens` is a universal param so
  // the client owns it; `reasoning` is deliberately vendor-NEUTRAL intent (the gateway
  // maps it to Anthropic `thinking` / OpenAI `reasoning_effort` against the model it
  // actually resolves — the client often can't know it, since the picker's default is
  // "auto"). Memoized so a keystroke doesn't hand the run builder a fresh object.
  const effortMaxTokens = effortProfile(effort).maxTokens;
  const reasoning = useMemo(() => reasoningForRun({ effort, thinking }), [effort, thinking]);

  // Which models this tenant may run, which one is in force and who pays for it — the
  // `/` menu's model rows and the run loop's stall failover (see `useComposerModels`).
  // Keyed on the host's bundle, not on `t` (rebuilt every render), so the catalogue
  // fetch re-runs on a new init frame rather than on every keystroke.
  const paidCostDetail = useMemo(
    () => promptMenuLabels(makeT(init.labels), init.modelLabels).paidCostDetail,
    [init.labels, init.modelLabels],
  );
  const models = useComposerModels(init, apiReq, paidCostDetail);
  const { modelSurface, composerModels, pickFallbackModel } = models;
  // The host runs the loop, so it needs the three things only this panel knows: WHICH
  // chat it is showing (runs for other chats carry on out there, and both the Auto
  // switch and the host's tool-count announcement are matched against this), the
  // Auto-mode switch (its confirm gate follows it live, for that chat alone) and the
  // picker's surface (its stall failover keeps ONE ordering function,
  // `nextFallbackModel`).
  useEffect(() => {
    setHostRunContext({ chatId, autoApprove, modelSurface });
  }, [chatId, autoApprove, modelSurface]);

  // Project-Evermind memory hooks: recall the chat's project learnings before
  // answering (grounding the reply + surfacing recall/learn/reconcile steps in the
  // timeline). Bound to the chat's project (falling back to the IDE's open project) —
  // the SAME chat-first resolution the system-prompt directive uses (associatedProjectId).
  const evermindProjectId = associatedProjectId;

  // Self-heal Evermind learning scope. The server's chat→Evermind learn gate keys on
  // brain_chats.projectId (evaluateBrainLearnGate): a project-less chat NEVER
  // contributes — even though the Evermind panel above shows the IDE project's model
  // as connected, because it resolves evermindProjectId via the init.project FALLBACK.
  // So a chat created before a project was selected (or any older/global chat) shows a
  // "Learning · Connected" panel yet silently never trains the model. When the IDE has
  // a resolved project and the open chat is project-less, adopt it onto the chat so its
  // turns actually train the project's Evermind and the panel's claim becomes true.
  // One-shot per chat (guarded), best-effort — a failure just leaves it unscoped.
  //
  // The chat's project is read with `getChat`, NOT looked up in `chats`. That list is
  // fetched with `?projectId=<active>`, and the server filters it as
  // `brain_chats.project_id = <active>` — which EXCLUDES a project-less chat. So a
  // project-LESS chat is never in the list, `chats.find` came back undefined, and the
  // effect bailed on `!chat` — meaning this self-heal could never fire for exactly the
  // chats it exists to heal. (Reported on chat #85: the IDE had BuilderForce.AI
  // selected and Evermind showed "connected", while every turn reported
  // "isn't attached to a project".) The Sessions tree filters client-side, so a chat
  // absent from this list is still openable — the two must not be conflated.
  const adoptedProjectRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const pid = init.project?.id;
    if (chatId == null || pid == null || adoptedProjectRef.current.has(chatId)) return;
    adoptedProjectRef.current.add(chatId);
    // The decision lives in `adoptChatProject` (unit-tested); this effect only supplies
    // the ids and reacts to the outcome.
    void adoptChatProject(persistence, chatId, pid).then((outcome) => {
      if (outcome === 'adopted') reloadChats();
      // Let a transient read/write failure be retried the next time it is opened.
      else if (outcome === 'failed') adoptedProjectRef.current.delete(chatId);
    });
  }, [chatId, init.project?.id, persistence, reloadChats]);

  // The project's server memory (recall → memory-first answer → write-through). Built
  // by the SHARED factory the web Brain uses, so the two hosts cannot drift apart on
  // what the Brain remembers — which is exactly how the web surfaces ended up without
  // the memory-first pair this webview had.
  const evermind = useMemo(() => {
    if (evermindProjectId == null) return undefined;
    const req = authedFetch(init.baseUrl, getToken, () => void refreshToken());
    // `chatId` makes recall CHAT-TIERED: this conversation's own memories come first,
    // then the wider project's. Without it a reopened chat recalled anything the
    // project had ever learned, which reads as remembering things never said here.
    return projectMemoryHooks(evermindProjectId, req, chatId, 'vsix');
  }, [evermindProjectId, init.baseUrl, chatId]);

  // Per-chat memory switch: whether THIS chat passes the project-Evermind hooks (recall
  // before answering + the learn contribution when the run finishes). A property of the
  // CONVERSATION (`brain_chats.memory_enabled`) — the same chat reads the same switch on
  // the web — and the host's run reads it too: the run spec's `evermind` flag also drops
  // the memory tools. Off makes the chat a scratch space (no recall, no learning).
  const persistMemory = useCallback(
    (id: number, on: boolean) => persistence.updateChat(id, { memoryEnabled: on }).then(reloadChats),
    [persistence, reloadChats],
  );
  const { enabled: memoryEnabled, setEnabled: setMemoryEnabled } = useChatMemorySwitch({
    chatId,
    serverValue: activeChat?.memoryEnabled,
    persist: persistMemory,
  });
  pendingMemoryRef.current = memoryEnabled;
  const gatedEvermind = memoryEnabled ? evermind : undefined;

  /**
   * The roster the RUN is told about, mirrored into state.
   *
   * The web panel hands `chatRoster` straight to `useBrainConversation`, because there
   * the participants resolve from the adapter alone. Here they cannot: this surface's
   * refresh signal includes `useChatActivitySignal(conv.messages)`, so a run milestone
   * that joins an agent to the chat re-reads the Agents list — which makes `participants`
   * depend on `conv`, and `conv` cannot then depend on `participants`.
   *
   * Mirroring breaks the cycle without giving up that live re-read. The one render of lag
   * costs nothing: the roster is only ever read when a run STARTS, and by then the effect
   * (beside `participants` below) has flushed. `participants` is memoised on its own
   * inputs, so the set→render→memo cycle settles rather than looping.
   */
  const [chatRoster, setChatRoster] = useState<ChatRosterAgent[]>([]);

  const conv = useBrainConversation({
    chatId,
    modality: 'ide',
    // The chat's project (falls back to the IDE's open project) — powers the run
    // loop's "a code change is always tied to a ticket" backstop, which mints a
    // from_delta ticket for this project (linked to the chat) when a turn changed
    // code without recording one.
    projectId: evermindProjectId,
    // A strict pin wins; otherwise an agent persona runs on the agent's own model.
    model: init.modelStrict ? init.model : (personaModelId ?? init.model),
    modelStrict: init.modelStrict,
    routingMode: init.routingMode ?? 'auto',
    // When a model burns its stall budget describing tool calls it never makes, the
    // run switches models itself instead of stranding the user with a promise. Reads
    // the model surface already loaded for the picker — no extra fetch.
    pickFallbackModel: init.modelStrict ? undefined : pickFallbackModel,
    maxTokens: effortMaxTokens,
    reasoning,
    extraSystem,
    ensureChatId,
    onActivity: reloadChats,
    onFirstUserTurn: autoTitleChat,
    evermind: gatedEvermind,
    // The conversation's own mode decides which directive rides the turn — the shared
    // `chatModeDirective`, identical to the web Brain. Without this the loop's absent-
    // mode fallback made every IDE turn a Work turn regardless of the chat's row.
    chatMode,
    // WHO IS IN THIS CHAT. A non-empty roster makes the invited agents the default owners
    // of work-mode work instead of this session (see `chatMode.ts`) — and names them in
    // the prompt, so dispatching costs no discovery call. This matters most HERE: the IDE
    // session holds the workspace tools, so without the roster the do-it-here rule had it
    // make every change itself while the chat's agents sat idle.
    chatRoster,
  });

  // The timeline renders the chat's durable step rows from `conv.messages` and dedupes
  // them against this LIVE run trace (`buildSettledTimeline`) — one store, so a reopened
  // chat shows its tool steps with nothing to rehydrate.
  const displayTrace = conv.trace;

  // Per-turn limbic round-trip: fetch a fresh affective/personality block for THIS
  // turn's text from the host (which calls the gateway), with a short timeout so a
  // slow/offline gateway never stalls the send. Best-effort → '' on any failure.
  const requestLimbic = useCallback(async (text: string): Promise<string> => {
    try {
      const r = await Promise.race([
        request<{ block?: string }>('fetchLimbic', { text }),
        new Promise<{ block?: string }>((res) => window.setTimeout(() => res({}), 4000)),
      ]);
      return r?.block ?? '';
    } catch {
      return '';
    }
  }, []);

  // Chat↔ticket panel data adapter — same gateway endpoints as the web app's
  // panel, over the webview's bearer fetch (see chatTicketsAdapter).
  const ticketAdapter = useMemo(
    () => createChatTicketsAdapter(init.baseUrl, getToken, () => void refreshToken()),
    [init.baseUrl],
  );
  // Stable references so a keystroke / streaming token doesn't hand the memoized
  // <ChatTicketsPanel> fresh props and force its whole subtree to re-render.
  const ticketChatList = useMemo(() => chats.map((c) => ({
    id: c.id,
    title: c.title,
    ticketCount: c.ticketCount,
    ticketProgressPct: c.ticketProgressPct,
  })), [chats]);
  const onTicketsChanged = useCallback(() => { reloadChats(); conv.reloadMessages(); }, [reloadChats, conv.reloadMessages]);
  // Bumped when the Brain mutates work items via MCP tools, so the ticket panel
  // refreshes live (rings/links) rather than only on its own button actions.
  const [ticketRefresh, setTicketRefresh] = useState(0);
  const bumpTicketRefresh = useCallback(() => setTicketRefresh((n) => n + 1), []);
  const chatFiles = useChatChangedFiles(apiReq, chatId, ticketRefresh);
  const pendingChangesExtension = usePendingChangesExtension(init.labels, chatFiles);

  // Auto-link the work item that opened this chat (a task/epic/gap from the tree or
  // board, a roadmap/spec row from a project page) so the chat is tied to it and the
  // ticket panel shows it — the missing half of "open the item in a chat". Bumps the
  // refresh signal so the just-mounted panel re-fetches and renders the new link.
  const linkOpenedTicket = useCallback(
    async (linkChatId: number, ticket: { kind: string; ref: string }) => {
      try {
        await ticketAdapter.linkTicket(linkChatId, { kind: ticket.kind as never, ref: ticket.ref, linkType: 'linked' });
        setTicketRefresh((n) => n + 1);
      } catch { /* linking is best-effort — a failed link never blocks the chat */ }
    },
    [ticketAdapter],
  );

  // Host-driven intents: the Sessions sidebar / task + project-page commands drive
  // this singleton panel (open a fresh chat, focus an existing one, or open a chat
  // scoped + linked to a work item).
  useEffect(() => {
    return onIntent((intent: BrainIntent) => {
      if (intent.kind === 'new') {
        setChatId(null);
        setInput('');
      } else if (intent.kind === 'seed') {
        if (intent.ticket) {
          // A project-page row (roadmap/spec/…): create the chat eagerly, seed the
          // prompt, and link the item — the panel then shows the linked ticket.
          const ticket = intent.ticket;
          const seedTitle = (ticket.title ?? intent.text ?? t('app.newChat', 'New chat')).slice(0, 60);
          persistence
            .createChat({ title: seedTitle, projectId: ticket.projectId ?? init.project?.id ?? null })
            .then((chat) => {
              setChatId(chat.id);
              setInput(intent.text ?? '');
              reloadChats();
              void linkOpenedTicket(chat.id, ticket);
            })
            .catch(() => {});
        } else {
          // Ticket-less editor entry point (review PRs / fix errors / open a PR): open a
          // fresh chat with the prompt pre-filled; the user can tweak before sending.
          setChatId(null);
          setInput(intent.text ?? '');
        }
      } else if (intent.kind === 'focus' && intent.chatId != null) {
        setChatId(intent.chatId);
      } else if (intent.kind === 'task' && intent.task) {
        const task = intent.task;
        const title = `${task.key ? `${task.key} ` : ''}${task.title}`.slice(0, 60);
        persistence
          .createChat({ title, projectId: task.projectId ?? null })
          .then((chat) => {
            setChatId(chat.id);
            const taskLabel = `${task.key ? `${task.key}: ` : ''}${task.title}`;
            const template = task.dispatched
              ? t('app.taskSeedDispatched', "I just dispatched {task} to run on the platform. Check the latest execution's status and trace, then help me follow up.")
              : t('app.taskSeed', "Let's work on {task}.");
            setInput(template.replace('{task}', taskLabel));
            reloadChats();
            // Link the task/epic/gap it was opened for (a host-supplied ticket wins;
            // else derive the kind from the task's own type).
            const ticket = intent.ticket
              ?? { kind: task.taskType === 'epic' ? 'epic' : task.taskType === 'gap' ? 'gap' : 'task', ref: String(task.id) };
            void linkOpenedTicket(chat.id, ticket);
          })
          .catch(() => {});
      }
    });
  }, [persistence, reloadChats, t, linkOpenedTicket, init.project?.id]);
  useEffect(() => {
    const h = () => setTicketRefresh((n) => n + 1);
    window.addEventListener('bf:mcp-write', h);
    return () => window.removeEventListener('bf:mcp-write', h);
  }, []);

  // Multi-party chat: who a message goes to. The BRAIN (default) executes; an
  // invited agent/human is just talked to. The selector only appears once a chat
  // actually has participants, so a solo chat is unchanged (everything → BRAIN).
  // A run milestone joins its agent to the chat server-side; the activity line arriving
  // over the live subscription is the signal to re-read the Agents list.
  const activitySignal = useChatActivitySignal(conv.messages);
  const railRefresh = ticketRefresh + activitySignal;
  const participants = useChatParticipants(ticketAdapter, chatId, railRefresh);
  // The chat's live sub-agents are addressable too: `@Ada …` (or a `#ticket` one of them
  // is working) steers that child's run instead of starting a turn of the chat's own.
  const liveChildren = useChatChildren(chatId);
  const subagentRoster = useChatSubagentRoster(chatId);
  const mentionable = useMemo(() => [...participants, ...childParticipants(liveChildren)], [participants, liveChildren]);

  // Keep the mirrored roster (declared above `conv`) in step with the live participants.
  useEffect(() => { setChatRoster(chatRosterFromParticipants(participants)); }, [participants]);

  // The effective target (shared with the web composer): an explicit BRAIN pick wins;
  // else an explicit participant; else a leading @mention; else the BRAIN (null). The
  // pick resets on a chat switch and drops a participant who has since left.
  const { recipient, choose: chooseRecipient } = useRecipientChoice({ participants: mentionable, input, resetKey: chatId });

  // A run's steps are persisted as durable step rows by the run loop the HOST drives
  // (`brainRunHost.ts`), not here: runs execute in parallel and outlive this view, so a
  // panel could only ever see — and save — the one chat it happened to be showing.

  // A send queued behind its per-turn limbic fetch. We can't call conv.send
  // synchronously in submit(): the fresh limbic block must land in extraSystem (→ the
  // run request's system prompt) FIRST. So submit fetches the block, sets turnLimbic +
  // bumps this nonce, and the effect runs the send on the NEXT render — where `conv`
  // already reflects the new system prompt. This is the webview's per-turn limbic seam.
  const pendingSendRef = useRef<{ text: string; recipient: DirectedRecipient | null } | null>(null);
  const [sendNonce, setSendNonce] = useState(0);
  useEffect(() => {
    if (sendNonce === 0) return;
    const queued = pendingSendRef.current;
    if (!queued) return;
    pendingSendRef.current = null;
    // Restore the typed text if the send fails before it's persisted (e.g. the token
    // expired) so the user's message is never silently lost. `addressedTo` routes the
    // turn: a participant is talked to (no BRAIN run); null (default) runs the BRAIN.
    void conv.send(queued.text, { addressedTo: queued.recipient }).then((ok) => {
      if (!ok) setInput((cur) => cur || queued.text);
    });
    // Keyed only on the nonce: `conv` is read fresh from this render's closure, which
    // already carries the just-set turnLimbic in its system prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendNonce]);

  // Fetch this turn's fresh limbic block, fold it into extraSystem, THEN stage the
  // send (the nonce effect above fires it once the new system prompt is committed) —
  // so the webview run executes under the same per-turn affective layer as the native
  // chat. Shared by the direct composer submit AND the queue drain below.
  const dispatchSend = useCallback(async (text: string, to: DirectedRecipient | null) => {
    const block = await requestLimbic(text);
    setTurnLimbic(block);
    pendingSendRef.current = { text, recipient: to };
    setSendNonce((n) => n + 1);
  }, [requestLimbic]);

  // Messages the user composed WHILE a run was in flight — the ONE shared queue: FIFO,
  // one per completed run (each stays a distinct steerable turn), never flushed across
  // a chat switch, and cleared with it.
  const queued = useQueuedTurns<QueuedTurn>({
    running: conv.sending,
    send: (m) => void dispatchSend(m.text, m.recipient),
    resetKey: chatId,
    textOf: (m) => m.text,
  });

  // A settled run moved what the chat row reports (its spend & savings, ticket counts),
  // and the host drives the run, so the in-page loop's `onActivity` never sees the end.
  const wasSending = useRef(false);
  useEffect(() => {
    if (wasSending.current && !conv.sending) reloadChats();
    wasSending.current = conv.sending;
  }, [conv.sending, reloadChats]);

  // The ONE way a turn leaves this panel — typed, an answered question, or "Send again".
  // A run is already in flight (or still settling in the host): queue it instead of
  // dropping it; the drain effect above sends it via the same limbic → nonce path when
  // the run finishes. Calling `conv.send` directly is what lost answers: it refuses
  // while the chat is running and says nothing, so an ask_user card answered before
  // the host had marked the run settled showed "Answered", posted no user turn, and
  // left the "Answer needed" banner pinned over a chat that had moved on (chat #133).
  const sendOrQueue = useCallback((text: string, to: DirectedRecipient | null) => {
    // For a live sub-agent: straight into its run, never queued behind the chat's own.
    const child = childTarget(text, to, liveChildren);
    if (child) {
      steerRun(child.key, text);
      return;
    }
    // The chat's own run is waiting on its sub-agents: speak to it now (the wait gives
    // way and its next turn answers) rather than queue behind a run that may hold for minutes.
    if (conv.sending && !to && chatId != null && isWaitingOnSubagents(conv.activity)) {
      steerRun(chatId, text);
      return;
    }
    if (queued.submit({ text, recipient: to })) return;
    void dispatchSend(text, to);
  }, [conv.sending, conv.activity, chatId, dispatchSend, liveChildren, queued.submit]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendOrQueue(text, recipient);
  }, [input, recipient, sendOrQueue]);

  // Answering an agent's ask_user card posts the chosen option(s) as the user's next
  // turn — same send path as the composer, so the question and answer stay in order.
  const answerQuestion = useCallback((answer: string) => {
    sendOrQueue(answer, recipient);
  }, [recipient, sendOrQueue]);

  // "Send again" on any transcript message — the same send path, so a replay queues
  // behind a running turn exactly like a typed one would.
  const replayMessage = useCallback((message: BrainMessage) => {
    sendOrQueue(message.content, recipient);
  }, [recipient, sendOrQueue]);

  // The question this chat is BLOCKED on, if any. A long transcript buries the
  // agent's card, so it is restated at the composer (and the session shows ❓ on its
  // tab + Sessions row) — one shared predicate, so banner and card never disagree.
  const pendingQuestion = useMemo(() => selectPendingAskUser(conv.messages), [conv.messages]);
  // What actually answered, not what was requested: under auto `init.model` is the
  // plan default ("Builderforce Free") even while a connected account does the work.
  const servedModel = useMemo(() => lastServedModel(conv.messages), [conv.messages]);
  const askLabels = useMemo(
    () => ({
      askSubmit: t('tl.askSubmit', 'Send'),
      askAnswered: t('tl.askAnswered', 'Answered'),
      askPending: t('app.askPending', 'Answer needed'),
      askJumpTo: t('app.askJumpTo', 'Show in conversation'),
      askDismiss: t('app.dismiss', 'Dismiss'),
    }),
    [init.labels],
  );
  const revealQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    document
      .getElementById(askUserAnchorId(pendingQuestion.messageId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pendingQuestion]);

  // What the user can DO about a failed turn (reconnect an expired session, upgrade
  // a plan, add a card) is decided ONCE from the gateway's structured error — see
  // `chatErrorAction` — and rendered by <ChatErrorBanner>, which owns its own
  // actions. Nothing here pattern-matches error prose.
  const reconnect = useCallback(() => {
    void refreshToken();
    conv.clearError();
  }, [conv]);

  // A connected BYO account the gateway couldn't use this run (e.g. a revoked Claude
  // subscription, or one connected in a DIFFERENT workspace) surfaces a passive notice.
  // Dismissal is keyed on the exact provider:reason set so a NEW/different occurrence
  // re-shows rather than staying hidden. The reason picks the message (reconnect here vs
  // switch workspace); the full per-reason detail is in the triage copy.
  const [dismissedByo, setDismissedByo] = useState('');
  const byoKey = conv.byoUnresolved.join(',');
  const byoEntries = useMemo(() => parseByoUnresolved(conv.byoUnresolved), [byoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byoProviders = byoEntries.map((e) => e.provider).join(', ');
  const byoOtherWorkspace = byoEntries.length > 0 && byoEntries.every((e) => e.reason === 'other-workspace');
  const showByoNotice = conv.byoUnresolved.length > 0 && dismissedByo !== byoKey;

  // Provider usage-cap notice: shown when a BYO provider's key hit its billing limit.
  // Keyed on the provider set so a different capped provider re-shows it.
  const [dismissedProviderCap, setDismissedProviderCap] = useState('');
  const providerCapKey = conv.providerCap.join(',');
  const showProviderCapNotice = conv.providerCap.length > 0 && dismissedProviderCap !== providerCapKey;

  // Triage helpers: copy the full transcript (turns + tool I/O + errors) so a
  // "No response" turn can be shared with its underlying system output, and run
  // the host's connection diagnostics. The host owns the clipboard + the
  // `builderforce.diagnose` command, reached over the bridge.
  // (activeChat / associatedProjectId / associatedProject are resolved once, chat-first,
  // near the project directive above — reused here for the header + triage report.)

  const canCopy = hasTranscriptContent({ messages: conv.messages, trace: conv.trace, error: conv.error });
  // Copy DIAGNOSTICS (not just the transcript): gather the chat's identity + Evermind
  // wiring state — the CHAT's own project (what the learn gate keys on, vs the panel's
  // selected project), tenant/user, the project Evermind head (version/mode/learned/
  // queued/last-learned), the last turn's learn-gate outcome, the invited agents, and the
  // linked tickets — then hand it to the shared serializer, which appends a Signals
  // section naming the likely cause of "Connected, yet nothing learns". Every source is
  // best-effort (degrades to null/[]) so the copy never fails on a single bad fetch.
  const copyTranscript = useCallback(async () => {
    const pid = associatedProjectId;
    try {
      const claims = decodeTokenClaims(getToken());
      const mcp = getMcpToolStatus();
      // ONE assembler, shared with the web panel and the headless probe, so the three
      // reports cannot drift field-by-field the way three inline copies did. Every read
      // inside it is best-effort, so one dead endpoint costs a line, not the capture.
      const diagnostics = await gatherChatDiagnostics({
        surface: 'VS Code (VSIX)',
        chatId,
        chatTitle: activeChat?.title ?? null,
        chatVisibility,
        // The mode the run actually bound to (the resolved value, not the raw column) —
        // it decides whether "planned it and stopped" is correct behaviour or a failure.
        mode: chatMode,
        projectId: pid,
        projectName: associatedProject?.name ?? null,
        selectedProjectId: init.project?.id ?? null,
        selectedProjectName: init.project?.name ?? null,
        tenantId: claims.tid ?? null,
        userId: claims.sub ?? null,
        messages: conv.messages,
        // The catalog the HOST built for the last run (local file tools + the platform
        // catalog together — it reports the count on `run.tools`); the status explains a
        // zero. The trace supplies what was ACTUALLY advertised per turn.
        tools: { count: mcp.count, error: mcp.error, loading: mcp.loading },
        trace: conv.trace,
        model: init.model ?? null,
        modelSurface,
        uiVersion: init.extensionVersion ?? null,
        uiBuildId: init.buildId ?? null,
        uiBuiltAt: init.builtAt ?? null,
        // THIS bundle's own stamp, beside the host's above. Equal ids mean one packaged
        // artifact; different ids name which half is stale — the case a report carrying
        // a single version could never distinguish.
        webviewBuildId: WEBVIEW_BUILD_ID,
        webviewBuiltAt: WEBVIEW_BUILT_AT,
        // Whether this machine can run the POSIX git scripts, resolved by the host.
        posixShell: init.posixShell ?? null,
        baseUrl: init.baseUrl ?? null,
        // The chat-scoped reads (agents, tickets, runs) come from ONE shared wiring over
        // the adapter — the web panel spreads the identical call. Hand-wiring them per
        // host is how the two surfaces ended up reading the same endpoints through two
        // different clients; a new chat-scoped read now lands in that file alone.
        ...chatDiagnosticsReads(ticketAdapter, chatId),
        readEvermind: () =>
          pid != null
            ? apiReq<{ version: number; mode: string; inferenceEnabled: boolean; teacherModel: string | null; contributions: number; pending: number; lastLearnedAt: string | null }>(
                `/api/projects/${pid}/evermind/contributions`,
              )
            : Promise.resolve(null),
        // Plan + month-to-date quota. Open to any tenant-scoped JWT (no role gate), so a
        // brand-new free member can produce a report that states their own tier and
        // allowance instead of one that looks like an unexplained capability failure.
        // Shared read-through cache — the same snapshot the `/` Status tab shows.
        readPlan: () => fetchPlanSnapshot(apiReq),
        // Which BUILD produced this capture. `/health` is public; it rides the gateway
        // base so the version reported is the one THIS webview is talking to. The
        // shared helper session-caches it, coalesces callers AND bounds the wait, so a
        // stalled probe can no longer leave the copy pending forever.
        readApiVersion: () => fetchApiVersionVia(() => apiReq<{ version?: string }>('/health').catch(() => null)),
      });
      // The SAME capture as one versioned JSON object: appended to the copied report so a
      // paste carries the machine-readable half, and persisted with the chat so the
      // capture outlives the clipboard. Built from the MERGED trace (live steps plus the
      // steps recovered from durable history) for the same reason the Markdown is — a
      // reopened chat holds none of the earlier run's steps in memory.
      const report = buildChatDiagnosticsReport({
        diagnostics,
        events: traceWithPersistedSteps(conv.messages, conv.trace),
        messages: conv.messages,
        model: init.model,
        running: conv.sending,
        surface: 'VS Code (VSIX)',
      });
      // Best-effort store. The copy must NEVER fail because persistence did: this button
      // exists to make an opaque chat explainable, and a report that reached the
      // clipboard has already done its job whether or not the row landed.
      if (chatId != null) {
        void apiReq(`/api/brain/chats/${chatId}/diagnostics`, {
          method: 'POST',
          body: JSON.stringify({ report }),
        }).catch(() => {});
      }
      post('copy', {
        text: buildTranscript({
          messages: conv.messages,
          trace: conv.trace,
          assistantName: 'BuilderForce',
          model: init.model,
          error: conv.error,
          project: associatedProject,
          chatTitle: activeChat?.title,
          chatId,
          diagnostics,
          report,
          // Whether the run was STILL EXECUTING when the button was pressed. The trace
          // cannot know it, and it changes how the report must be read: a chat copied
          // mid-run has not failed to finish the work, it has not finished it YET.
          running: conv.sending,
          // The live in-flight step, so a report captured mid-run names WHAT the agent
          // was doing at that instant — the single most useful fact when the complaint
          // is "it has been sitting there for a minute".
          activity: conv.activity,
          subagents: subagentDiagnosticsOf(chatId),
        }),
      });
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch (e) {
      // FAIL LOUDLY. The whole point of this button is to make an opaque chat
      // explainable; a silent failure makes the button itself the next opaque thing.
      setCopyState('error');
      conv.setError(
        `${t('app.copyFailed', 'Could not build the chat diagnostics report.')} ${e instanceof Error ? e.message : String(e)}`,
      );
      window.setTimeout(() => setCopyState('idle'), 3000);
    }
  }, [conv, init.model, init.extensionVersion, init.buildId, init.builtAt, init.posixShell, init.baseUrl, modelSurface, associatedProject, associatedProjectId, activeChat?.title, chatVisibility, chatMode, chatId, ticketAdapter, apiReq, init.project?.id, init.project?.name, t]);

  // Consolidate: summarize the whole chat into ONE compact assistant message tagged
  // as a consolidation marker. It's shown back to the user (the "flag"), and the
  // conversation loop seeds the next turn FROM this marker — so a long chat sends
  // its summary as the base context instead of the full (large) history.
  const canConsolidate = chatId != null && conv.messages.length >= 2 && !conv.sending;
  const consolidate = useCallback(async () => {
    if (chatId == null || consolidating) return;
    setConsolidating(true);
    conv.clearError();
    try {
      const result = await persistence.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || t('app.nothingToConsolidate', 'Not enough conversation to consolidate yet.'));
        return;
      }
      await persistence.sendMessages(chatId, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      conv.reloadMessages();
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Consolidate failed');
    } finally {
      setConsolidating(false);
    }
  }, [chatId, consolidating, persistence, conv, reloadChats, t]);

  // Fork: summarize this chat, then create a NEW chat (same project) seeded with
  // that summary as its consolidation marker, and switch to it — continue a fresh,
  // compact conversation without carrying the whole history.
  const fork = useCallback(async () => {
    if (chatId == null || forking) return;
    setForking(true);
    conv.clearError();
    try {
      const result = await persistence.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || t('app.nothingToFork', 'Not enough conversation to fork yet.'));
        return;
      }
      const sourceTitle = activeChat?.title || t('app.newChat', 'New chat');
      const projectId = activeChat?.projectId ?? init.project?.id ?? null;
      const forkTitle = t('app.forkTitle', 'Fork of {title}').replace('{title}', sourceTitle).slice(0, 80);
      const chat = await persistence.createChat({ title: forkTitle, projectId });
      await persistence.sendMessages(chat.id, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      setChatId(chat.id);
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Fork failed');
    } finally {
      setForking(false);
    }
  }, [chatId, forking, persistence, conv, reloadChats, activeChat?.title, activeChat?.projectId, init.project?.id, t]);

  // Begin editing the selected chat's title (only a real, saved chat can be renamed).
  const startRename = useCallback(() => {
    if (chatId == null) return;
    setRenameValue(activeChat?.title ?? '');
    setRenaming(true);
  }, [chatId, activeChat?.title]);

  // Commit the rename: PATCH the title, then refresh the list so the select + the
  // header reflect it. A blank/unchanged title just cancels (no needless write).
  const commitRename = useCallback(async () => {
    const title = renameValue.trim();
    setRenaming(false);
    if (chatId == null || !title || title === activeChat?.title) return;
    try {
      await persistence.updateChat(chatId, { title });
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Rename failed');
    }
  }, [chatId, renameValue, activeChat?.title, persistence, reloadChats, conv]);

  return (
    <div className="bf-app">
      <header className="bf-header">
        {/* The chat's associated project names the panel (falling back to the brand
            when a chat has no project), so it's clear which project this chat is about. */}
        <span className="bf-header__title" title={associatedProject ? associatedProject.name : 'BuilderForce'}>
          {associatedProject ? associatedProject.name : 'BuilderForce'}
        </span>
        {associatedProject
          ? <span className="bf-header__brand">BuilderForce</span>
          : <span className="bf-header__beta">{t('app.beta', 'beta')}</span>}
        <div className="bf-header__spacer" />
        {renaming ? (
          <input
            className="bf-select bf-rename-input"
            autoFocus
            value={renameValue}
            placeholder={t('app.renamePlaceholder', 'Chat name')}
            aria-label={t('app.rename', 'Rename chat')}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
            }}
          />
        ) : (
          <select
            className="bf-select"
            value={chatId ?? ''}
            onChange={(e) => setChatId(e.target.value ? Number(e.target.value) : null)}
            aria-label={t('app.conversation', 'Conversation')}
          >
            <option value="">{t('app.newChat', 'New chat')}</option>
            {chatOptions.map((c) => (
              <option key={c.id} value={c.id}>{chatSwitcherLabel({
                title: c.title,
                id: c.id,
                ticketCount: c.ticketCount,
                ticketProgressPct: c.ticketProgressPct,
                runGlyph: runGlyph(c.id),
              })}</option>
            ))}
          </select>
        )}
        {/* Rename the selected chat — only enabled once a real chat is saved (a
            not-yet-created "New chat" has no server row to PATCH). */}
        <button
          className="bf-btn bf-btn--icon"
          title={t('app.rename', 'Rename chat')}
          aria-label={t('app.rename', 'Rename chat')}
          disabled={chatId == null || renaming}
          onClick={startRename}
        >
          <IconRename />
        </button>
        <button className="bf-btn" title={t('app.newChat', 'New chat')} onClick={() => setChatId(null)}>＋</button>
        <button
          className="bf-btn bf-btn--icon"
          title={copyState === 'error'
            ? t('app.copyFailed', 'Could not build the chat diagnostics report.')
            : t('app.copyChat', 'Copy chat diagnostics (identity + Evermind state + transcript)')}
          aria-label={copyState === 'error'
            ? t('app.copyFailed', 'Could not build the chat diagnostics report.')
            : t('app.copyChat', 'Copy chat diagnostics (identity + Evermind state + transcript)')}
          disabled={!canCopy}
          onClick={() => void copyTranscript()}
        >
          {copyState === 'copied' ? '✓' : copyState === 'error' ? '⚠' : '⧉'}
        </button>
        <button
          className="bf-btn bf-btn--icon"
          title={t('app.diagnostics', 'Run connection diagnostics')}
          aria-label={t('app.diagnostics', 'Run connection diagnostics')}
          onClick={() => post('diagnose')}
        >
          🩺
        </button>
      </header>

      {chatId != null && (
        <div style={{ padding: '0 12px' }}>
          <ChatTicketsPanel
            chatId={chatId}
            projectId={init.project?.id ?? null}
            chatList={ticketChatList}
            adapter={ticketAdapter}
            labels={DEFAULT_CHAT_TICKETS_LABELS}
            onChanged={onTicketsChanged}
            refreshSignal={railRefresh}
            visibility={chatVisibility}
            onSetVisibility={chatIsOwner ? async (v) => { await persistence.updateChat(chatId, { visibility: v }); setChatVisibility(v); } : undefined}
            onOpenTicket={(tk) => post('open.artifact', { kind: tk.kind, ref: tk.ref, projectId: init.project?.id ?? undefined })}
            // "The agent changed code and nothing said so" — the chat's own signal, as a
            // "Changes (N)" pill beside Link ticket / Agents / People. A clean tree
            // registers nothing, so the rail is exactly as it was.
            extensions={pendingChangesExtension ? [pendingChangesExtension] : undefined}
            subagents={subagentRoster}
            // What this conversation cost and what memory saved — rides the chat row.
            spend={activeChat?.spend}
            spendLabels={spendLabels}
            locale={init.locale}
          />
        </div>
      )}

      <div className="bf-body">
        <BrainTimeline
          messages={conv.messages}
          trace={displayTrace}
          streamingText={conv.sending ? conv.streamingText : ''}
          isRunning={conv.sending}
          activity={conv.activity}
          loading={conv.loadingMessages}
          assistantName="BuilderForce"
          labels={tlLabels}
          modelIdentity={composerModels?.identity}
          onAnswerQuestion={answerQuestion}
          onReplayMessage={replayMessage}
          // The editor rates turns too now — before the thumbs moved into the shared
          // action row, a large share of all model calls could not be rated at all.
          onRateMessage={conv.rateMessage}
          ratings={conv.ratings}
        />
      </div>

      {showByoNotice && (
        <div className="bf-notice" role="status">
          <span className="bf-error__msg">
            {(byoOtherWorkspace
              ? t(
                  'app.byoOtherWorkspace',
                  'Your {provider} account is connected in a DIFFERENT workspace, so this run used the shared model pool instead of your own model. Switch to that workspace, or connect it in this one under Settings ▸ API Keys.',
                )
              : t(
                  'app.byoUnused',
                  'Your connected {provider} account couldn’t be used this run (its token looks expired or revoked), so it ran on the shared model pool instead of your own model. Reconnect it in the web app under Settings ▸ API Keys.',
                )
            ).replace('{provider}', byoProviders)}
          </span>
          <div className="bf-error__actions">
            <button
              className="bf-btn bf-btn--icon"
              onClick={() => setDismissedByo(byoKey)}
              title={t('app.dismiss', 'Dismiss')}
              aria-label={t('app.dismiss', 'Dismiss')}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {showProviderCapNotice && (
        <div className="bf-notice" role="status">
          <span className="bf-error__msg">
            {t(
              'app.providerCapHit',
              'Your {providers} API key hit its usage limit this run, so it fell back to the shared model pool. Manage your API keys in the web app under Settings ▸ API Keys.',
            ).replace('{providers}', conv.providerCap.join(', '))}
          </span>
          <div className="bf-error__actions">
            <button
              className="bf-btn bf-btn--icon"
              onClick={() => setDismissedProviderCap(providerCapKey)}
              title={t('app.dismiss', 'Dismiss')}
              aria-label={t('app.dismiss', 'Dismiss')}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <ChatErrorBanner
        className="bf-error"
        error={conv.error}
        action={conv.errorAction}
        onReconnect={reconnect}
        onUpgrade={() => { invalidatePlanSnapshot(); openUpgrade('pricing'); }}
        onValidateCard={() => { invalidatePlanSnapshot(); openUpgrade('billing'); }}
        onDismiss={conv.clearError}
        labels={{
          reconnect: t('app.reconnect', 'Reconnect'),
          upgrade: t('app.upgrade', 'Upgrade'),
          upgradeToPlan: t('app.upgradeToPlan', 'Upgrade to {plan}'),
          addCard: t('app.addCard', 'Add a card'),
          dismiss: t('app.dismiss', 'Dismiss'),
        }}
      />

      {/* The chat's live sub-agents: who works for whom, and the owner's levers. */}
      <SubagentStrip chatId={chatId} labels={init.labels} liveLabels={tlLabels.live} />

      {conv.pendingConfirm && (
        <div className="bf-confirm">
          <span>
            {t('app.confirmRun', 'Run {name}?').split('{name}')[0]}
            <code>{conv.pendingConfirm.name}</code>
            {t('app.confirmRun', 'Run {name}?').split('{name}')[1] ?? ''}
          </span>
          {/* For run_command, show the exact command line so the user approves what
              actually runs, not just the tool name. */}
          {conv.pendingConfirm.name === 'run_command'
            && typeof (conv.pendingConfirm.args as { command?: unknown })?.command === 'string' && (
            <pre className="bf-confirm__cmd">{(conv.pendingConfirm.args as { command: string }).command}</pre>
          )}
          <div className="bf-confirm__actions">
            <button className="bf-btn bf-btn--primary" onClick={() => conv.resolveConfirm(true)}>{t('app.approve', 'Approve')}</button>
            <button className="bf-btn" onClick={() => conv.resolveConfirm(false)}>{t('app.cancel', 'Cancel')}</button>
            <label className="bf-confirm__auto">
              <input type="checkbox" checked={autoApprove} onChange={(e) => { setAutoApproveMode(e.target.checked); if (e.target.checked) conv.resolveConfirm(true); }} />
              {t('app.always', 'Always')}
            </label>
          </div>
        </div>
      )}

      {pendingQuestion && (
        <PendingQuestionBanner
          key={pendingQuestion.messageId}
          payload={pendingQuestion.payload}
          labels={askLabels}
          onAnswer={answerQuestion}
          onReveal={revealQuestion}
        />
      )}

      <VsCodeComposer
        init={init}
        apiReq={apiReq}
        conv={conv}
        value={input}
        onChange={setInput}
        onSubmit={submit}
        chatId={chatId}
        projectId={evermindProjectId}
        ensureChatId={ensureChatId}
        ticketAdapter={ticketAdapter}
        ticketRefresh={ticketRefresh}
        onTicketLinked={bumpTicketRefresh}
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
        session={chatId != null
          ? { canConsolidate, consolidating, forking, onConsolidate: consolidate, onFork: fork }
          : undefined}
      />
    </div>
  );
}
