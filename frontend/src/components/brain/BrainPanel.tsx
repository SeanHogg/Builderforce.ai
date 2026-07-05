'use client';

/**
 * The one Brain UI. Used by BOTH the full-page Brain Storm route
 * (`variant="page"`) and the global docked drawer (`variant="docked"`). All
 * logic comes from the shared hooks (`useBrainChats` / `useBrainConversation`)
 * and the page-action registry — the only thing that differs between variants
 * is chrome (two-column page vs. collapsible drawer).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { BrainTimeline, Avatar } from '@seanhogg/builderforce-brain-ui';
import '@seanhogg/builderforce-brain-ui/styles.css';
import { ChatInput } from '@/components/ChatInput';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import { AttentionDot } from '@/components/AttentionDot';
import { useAttention } from '@/lib/useAttention';
import { RepoContextPicker, type RepoFileSource } from '@/components/brain/RepoContextPicker';
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
  type SuggestedAction,
  type BrainModality,
  type BrainEffort,
  type DirectedRecipient,
  type RecipientChoice,
} from '@/lib/brain';
import type { BrainChat, BrainMessage } from '@/lib/builderforceApi';
import { agentAssignmentsApi, reposApi, runtimeApi, brain, type AgentAssignment, type ProjectRepository, type ChatAgentInvite, type ChatMemberInfo } from '@/lib/builderforceApi';
import { loadAgentPoolCached, type PoolAgent } from '@/lib/agentPool';
import { MODALITIES, getModality } from '@/lib/modality';
import { isBrainAutoApprove, setBrainAutoApprove } from '@/lib/brain/autoApprove';

function formatTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
  onClose,
}: BrainPanelProps) {
  const isPage = variant === 'page';
  const tTimeline = useTranslations('brain.timeline');
  const tCommon = useTranslations('common');
  const tRepo = useTranslations('repoContext');
  const tBrain = useTranslations('brain');

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
  const [historyOpen, setHistoryOpen] = useState(false);
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
  // unworkable. It's read through a ref so `needsConfirm` stays referentially
  // stable, mirrored to state for the toggle UI, and persisted per-browser.
  const [autoApprove, setAutoApprove] = useState(false);
  const autoApproveRef = useRef(false);
  useEffect(() => {
    const on = isBrainAutoApprove();
    autoApproveRef.current = on;
    setAutoApprove(on);
  }, []);
  const setAutoApproveMode = useCallback((on: boolean) => {
    autoApproveRef.current = on;
    setAutoApprove(on);
    setBrainAutoApprove(on);
  }, []);
  const needsConfirm = useCallback(
    (req: { name: string; args: unknown }) => isMutating(req.name, req.args) && !autoApproveRef.current,
    [isMutating],
  );

  // Composer run-shaping toggles (the `/` menu + the `+` menu's web option) —
  // compiled into the ambient system context below so each actually changes the
  // next turn. Mirrors the VS Code Brain composer.
  const [effort, setEffort] = useState<BrainEffort>('balanced');
  const [thinking, setThinking] = useState(false);
  const [webBrowsing, setWebBrowsing] = useState(false);
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
  const [personaSel, setPersonaSel] = useState<string>('default');
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

  const ensureChatId = useCallback(async () => {
    const c = await chats.create();
    return c?.id ?? null;
  }, [chats]);

  // Tell the model which project is in context, so "create a task" / "list
  // specs" without a named project default to it. Covers BOTH the page the user
  // is viewing (viewingProjectId, e.g. the scoped Tasks board) and the IDE's
  // pinned project — pinnedProjectId switches persona/chat-scoping but never told
  // the model the numeric id. Resolve the name from the loaded projects list
  // when available; the id is what the tools actually need.
  const ctxProjectId = viewingProjectId ?? pinnedProjectId;
  // Cross-surface "what's live / what needs me" — decorates each chat row with a
  // status dot (running / needs-answer) that stays live even when another chat is
  // focused. Scoped when a project is in context, tenant-wide on the Brain Storm page.
  const attn = useAttention(ctxProjectId ?? undefined);
  const ambientSystem = useMemo(() => {
    const parts: string[] = [];
    if (extraSystem) parts.push(extraSystem);
    if (ctxProjectId != null) {
      const name = projects.find((p) => p.id === ctxProjectId)?.name;
      parts.push(`The current project is ${name ? `"${name}" ` : ''}(projectId ${ctxProjectId}). When the user asks to create, list, or operate on tasks, specs, or other project-scoped items without naming a project, use projectId ${ctxProjectId} by default. To take them to the result, call navigate_to — do not write out absolute URLs.`);
    }
    // Auto-approve flips the model from "ask before acting" to "act decisively"
    // — the toggle already skips the per-action confirm UI; this keeps the model
    // from asking for permission in prose anyway.
    if (autoApprove) parts.push(BRAIN_AUTO_APPROVE_DIRECTIVE);
    // Effort / Thinking / Browse-the-web composer toggles.
    const composer = buildComposerDirectives({ effort, thinking, web: webBrowsing });
    if (composer) parts.push(composer);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }, [ctxProjectId, projects, extraSystem, autoApprove, effort, thinking, webBrowsing]);

  const conv = useBrainConversation({
    chatId: chats.activeChatId,
    modality,
    extraSystem: ambientSystem,
    systemPrompt: personaSystemPrompt,
    model: personaModel,
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity: chats.touch,
  });

  const { pendingConfirm, resolveConfirm } = conv;
  // "Approve all": run this action and auto-approve the rest of the run/session.
  const approveAll = useCallback(() => {
    setAutoApproveMode(true);
    resolveConfirm(true);
  }, [setAutoApproveMode, resolveConfirm]);

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
    const title = chat.title?.trim() || 'this chat';
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeletingId(chat.id);
    try { await chats.remove(chat.id); } finally { setDeletingId(null); }
  }, [chats]);

  const onAssign = useCallback(async (chatId: number, projectId: number | null) => {
    setBusyId(chatId);
    try { await chats.assignToProject(chatId, projectId); } finally { setBusyId(null); }
  }, [chats]);

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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    // Audited engagement signal: interacting with the AI agent is billable activity.
    trackActivity('agent_message', { weight: 2 });
    // Restore the text if the send fails before it's persisted (e.g. an expired
    // session) so the user's message is never silently lost. `addressedTo` routes
    // the turn: a participant is talked to (no BRAIN run); null runs the BRAIN.
    const ok = await conv.send(text, { addressedTo: recipient });
    if (!ok) setInput((cur) => cur || text);
  }, [input, conv, recipient]);

  // Capture execution: copy the Brain run's LLM/tool/error trace + transcript to
  // the clipboard — the Brain twin of the Observability/Logs "Copy triage info"
  // button, so a misbehaving run can be dropped straight into a bug report.
  const [captureState, setCaptureState] = useState<'idle' | 'copied' | 'error'>('idle');
  const personaLabel = useMemo(() => {
    if (personaSel.startsWith('modality:')) return tBrain('brainModality', { modality: getModality(personaSel.slice('modality:'.length)).label });
    if (personaSel.startsWith('agent:')) {
      const a = brainAgents.find((x) => `agent:${x.agentKind}:${x.agentRef}` === personaSel);
      return a ? tBrain('brainAs', { name: agentName(a) }) : tBrain('brainTitle');
    }
    return tBrain('brainDefault');
  }, [personaSel, brainAgents, agentName, tBrain]);
  const captureExecution = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(conv.buildTriageReport(personaLabel));
      setCaptureState('copied');
    } catch {
      setCaptureState('error');
    }
    setTimeout(() => setCaptureState('idle'), 2000);
  }, [conv, personaLabel]);

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
        fontSize: 13,
        lineHeight: 1,
        background: 'var(--bg-elevated)',
        color: captureState === 'error'
          ? 'var(--red, #ef4444)'
          : captureState === 'copied'
            ? 'var(--green, #22c55e)'
            : 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        cursor: conv.hasTrace ? 'pointer' : 'not-allowed',
        opacity: conv.hasTrace ? 1 : 0.5,
      }}
    >
      {captureState === 'copied' ? '✓' : captureState === 'error' ? '✕' : '⧉'}
    </button>
  );

  // Auto-send a one-shot prompt (e.g. a landing-page prompt replayed after auth).
  // `conv.send` creates+selects a chat on demand, so the conversation renders and
  // streams a reply. Ref-guarded so re-renders never re-send.
  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    const text = initialPrompt?.trim();
    if (!text || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    void conv.send(text);
  }, [initialPrompt, conv]);

  const error = chats.error || conv.error;
  // The banner surfaces either source; dismissing must clear whichever is set.
  const dismissError = useCallback(() => { chats.setError(''); conv.clearError(); }, [chats, conv]);

  // ---- Shared sub-renders ---------------------------------------------------

  const chatRows = (
    <>
      {chats.loading && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>{tCommon('loading')}</div>}
      {!chats.loading && filteredChats.length === 0 && (
        <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          {chats.chats.length === 0 ? tBrain('noChatsYet') : tBrain('noChatsMatch')}
        </div>
      )}
      {filteredChats.map((chat) => {
        const active = chats.activeChatId === chat.id;
        return (
          <div
            key={chat.id}
            className={isPage ? `bs-chat-item ${active ? 'active' : ''}` : undefined}
            role="button"
            tabIndex={0}
            onClick={() => chats.select(chat.id)}
            onKeyDown={(e) => e.key === 'Enter' && chats.select(chat.id)}
            style={isPage ? undefined : {
              padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
              background: active ? 'var(--bg-elevated)' : 'transparent',
              borderLeft: active ? '3px solid var(--coral-bright, #f43f5e)' : '3px solid transparent',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {renamingId === chat.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: '100%', fontSize: 13, padding: 2, border: '1px solid var(--border-subtle)', borderRadius: 4 }}
                />
              ) : chat.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {chat.projectId != null && pinnedProjectId == null && (
                <span style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 4, fontSize: 10 }}>
                  {projectName(chat.projectId)}
                </span>
              )}
              {formatTime(chat.updatedAt)}
              <AttentionDot state={attn.chats[chat.id]?.state} />
            </div>
            {active && renamingId !== chat.id && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setRenamingId(chat.id); setRenameValue(chat.title); }} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{tBrain('rename')}</button>
                <button type="button" onClick={() => onSummarize(chat.id)} disabled={summarizingId === chat.id} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{summarizingId === chat.id ? '…' : tBrain('summarize')}</button>
                <button type="button" onClick={() => onDelete(chat)} disabled={deletingId === chat.id} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', color: 'var(--coral-bright)' }}>{deletingId === chat.id ? '…' : tCommon('delete')}</button>
                {chat.projectId == null && pinnedProjectId == null && (
                  <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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
                      style={{ marginLeft: 0, minWidth: 120, padding: '2px 6px', fontSize: 11 }}
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

  const conversation = (
    <>
      {error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '8px 12px 0', padding: '8px 12px', fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 8 }} role="alert">
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{error}</span>
          <button
            type="button"
            onClick={dismissError}
            title={tCommon('dismiss')}
            aria-label={tCommon('dismiss')}
            style={{ flex: '0 0 auto', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>
      )}
      {chats.activeChatId == null ? (
        <div className={isPage ? 'bs-empty' : undefined} style={isPage ? undefined : { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🧠</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)' }}>{tBrain('brainTitle')}</div>
          <div style={{ fontSize: 13 }}>{tBrain('emptyHint')}</div>
          <button type="button" onClick={() => chats.create()} style={{ padding: '10px 18px', fontSize: 14, fontWeight: 600, background: 'var(--accent, #3b82f6)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer' }}>
            {tBrain('startNewChat')}
          </button>
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
              onChanged={() => { void chats.reload(); conv.reloadMessages(); setParticipantsRefresh((n) => n + 1); }}
            />
          )}
          {showNewProject && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 12px', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                placeholder={tBrain('newProjectPlaceholder')}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProjectAndAssign()}
                style={{ flex: 1, padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
              />
              <button type="button" onClick={createProjectAndAssign} disabled={!newProjectName.trim() || creatingProject} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent, #3b82f6)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {creatingProject ? '…' : tBrain('createAndAssign')}
              </button>
              <button type="button" onClick={() => { setShowNewProject(false); setNewProjectName(''); }} style={{ padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}>{tCommon('cancel')}</button>
            </div>
          )}
          <div className="bs-messages" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <BrainTimeline
              messages={conv.messages}
              trace={conv.trace}
              streamingText={conv.sending ? conv.streamingText : ''}
              isRunning={conv.sending}
              loading={conv.loadingMessages}
              labels={{
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
                apply: tTimeline('apply'),
                createFile: tTimeline('createFile'),
                preview: tTimeline('preview'),
              }}
              onApplyCode={hasTool('apply_code_to_active_file') ? (code: string) => { void runTool('apply_code_to_active_file', { code }); } : undefined}
              onCreateFile={hasTool('create_file') ? (path: string, content: string) => { void runTool('create_file', { path, content }); } : undefined}
              // Reuse the web's rich markdown (mermaid, router links, code-apply) so
              // no feature is lost; the model-authored "next step" JSON is lifted out.
              renderMessage={(msg, ctx) => (
                <ChatMessageContent
                  content={ctx.role === 'assistant' ? parseSuggestedActions(msg.content).content : ctx.text}
                  onApplyCode={ctx.role === 'assistant' && hasTool('apply_code_to_active_file') ? (code) => { void runTool('apply_code_to_active_file', { code }); } : undefined}
                  onCreateFile={ctx.role === 'assistant' && hasTool('create_file') ? (path, content) => { void runTool('create_file', { path, content }); } : undefined}
                />
              )}
              renderStreaming={(text) => <ChatMessageContent content={parseSuggestedActions(text).content} />}
              renderAssistantActions={(msg) => (
                <MessageActions
                  msg={msg}
                  conv={conv}
                  projectId={chats.activeChat?.projectId ?? pinnedProjectId ?? undefined}
                  suggestions={parseSuggestedActions(msg.content).actions}
                  onRunSuggestion={(prompt) => { void conv.send(prompt); }}
                />
              )}
            />
          </div>
          <div className="bs-input-area" style={{ flexShrink: 0, padding: isPage ? undefined : '12px 16px', borderTop: isPage ? undefined : '1px solid var(--border-subtle)' }}>
            {pendingConfirm && <ToolConfirmBar req={pendingConfirm} onDecide={resolveConfirm} onApproveAll={approveAll} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tBrain('actingAs')}</span>
              <Select
                value={personaSel}
                onChange={(e) => setPersonaSel(e.target.value)}
                aria-label={tBrain('personaAria')}
                style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <option value="default">{tBrain('defaultBrain')}</option>
                <optgroup label={tBrain('personas')}>
                  {MODALITIES.map((m) => (
                    <option key={m.id} value={`modality:${m.id}`}>{m.label ?? m.id}</option>
                  ))}
                </optgroup>
                {brainAgents.length > 0 && (
                  <optgroup label={tBrain('assignedAgents')}>
                    {brainAgents.map((a) => (
                      <option key={a.id} value={`agent:${a.agentKind}:${a.agentRef}`}>{agentName(a)}</option>
                    ))}
                  </optgroup>
                )}
              </Select>
              {/* Recipient selector — only once the chat is multi-party. Routes the
                  next message to the BRAIN (executes) or a participant (talked to). */}
              {participants.length > 0 && (
                <>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{tBrain('to')}</span>
                  {recipient && <Avatar name={recipient.name} kind={recipient.kind} size={18} />}
                  <Select
                    value={recipient ? recipient.ref : 'brain'}
                    onChange={(e) => setRecipientChoice(e.target.value === 'brain' ? 'brain' : (participants.find((p) => p.ref === e.target.value) ?? 'brain'))}
                    aria-label={tBrain('recipientPickerTitle')}
                    style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    <option value="brain">{tBrain('brainRecipient')}</option>
                    {participants.map((p) => (
                      <option key={p.ref} value={p.ref}>{p.name}</option>
                    ))}
                  </Select>
                </>
              )}
            </div>
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              placeholder={recipient ? tBrain('messageParticipant', { name: recipient.name }) : tBrain('messagePlaceholder')}
              disabled={conv.sending}
              running={conv.sending}
              onStop={conv.stop}
              stopLabel={tTimeline('stop')}
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
              autoMode={autoApprove}
              onAutoModeChange={setAutoApproveMode}
              showBrainIcon={false}
              showVoice
              pendingAttachments={conv.pendingAttachments}
              onRemoveAttachment={conv.removeAttachment}
            />
            {conv.uploading && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{tBrain('uploading')}</div>}
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
      <div className="bs-shell" style={{ marginBottom: 0 }}>
        <div className="bs-sidebar">
          <div className="bs-sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>{tBrain('brainStorm')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {captureButton}
                <button type="button" onClick={() => chats.create()} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                  {tBrain('newChat')}
                </button>
              </div>
            </div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--muted)' }}>
              {tBrain('projectLabel')}
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{tBrain('newChatsHint')}</span>
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
              style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
          </div>
          <div className="bs-chat-list">{chatRows}</div>
        </div>
        <div className="bs-main">{conversation}</div>
      </div>
    );
  }

  // Docked drawer
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      <div style={{ flexShrink: 0, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>🧠 {tBrain('brainTitle')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {captureButton}
          <button type="button" onClick={() => chats.create()} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'var(--accent, #3b82f6)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{tBrain('newChat')}</button>
          <Link href="/brainstorm" title={tBrain('openFullBrainStorm')} style={{ fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>{tBrain('expand')}</Link>
          {onClose && (
            <button type="button" onClick={onClose} aria-label={tBrain('closeBrain')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          )}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: historyOpen ? '1px solid var(--border-subtle)' : 'none' }}>
        <button type="button" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <span style={{ color: 'var(--text-muted)' }}>{tBrain('chatHistory')}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{historyOpen ? '▼' : '▶'}</span>
        </button>
      </div>
      {historyOpen && (
        <div style={{ flex: '0 1 35%', minHeight: 80, maxHeight: 240, overflow: 'auto', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ padding: '6px 12px' }}>
            <input type="search" placeholder={tBrain('searchChats')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </div>
          {chatRows}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{conversation}</div>
    </div>
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
      style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--coral-bright, #f4726e)', background: 'var(--bg-elevated)' }}
    >
      <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>
        ⚠️ {tBrain.rich('wantsTo', { action: label, b: (chunks) => <strong>{chunks}</strong> })}
      </div>
      {preview && preview !== '{}' && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 8 }}>{preview}</div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onDecide(true)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright, #f4726e)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{tCommon('approve')}</button>
        <button type="button" onClick={onApproveAll} title={tBrain('approveAllTitle')} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--bg-base)', color: 'var(--coral-bright, #f4726e)', border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 8, cursor: 'pointer' }}>{tBrain('approveAll')}</button>
        <button type="button" onClick={() => onDecide(false)} style={{ padding: '6px 14px', fontSize: 13, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}>{tCommon('cancel')}</button>
      </div>
    </div>
  );
}

function MessageActions({ msg, conv, projectId, suggestions, onRunSuggestion }: {
  msg: BrainMessage;
  conv: ReturnType<typeof useBrainConversation>;
  projectId?: number;
  /** Model-authored next-step buttons parsed from this reply. */
  suggestions?: SuggestedAction[];
  onRunSuggestion?: (prompt: string) => void;
}) {
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
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                cursor: conv.sending ? 'wait' : 'pointer',
                background: 'var(--coral-bright, #f4726e)',
                color: 'var(--text-on-accent, #fff)',
                border: 'none',
                borderRadius: 999,
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
      <ChatMessageActions
        onCopy={() => conv.copyMessage(msg)}
        copied={conv.copiedMessageId === msg.id}
        feedback={conv.feedbackMap[msg.id]}
        onFeedback={(value) => conv.submitFeedback(msg, value)}
        projectId={projectId}
        assistantContent={msg.content}
        conversationMessages={conv.messages.map((m) => ({ role: m.role, content: m.content }))}
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
      <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>{chat.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {chat.projectId == null ? (
          <>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
                style={{ minWidth: 140, padding: '4px 8px', fontSize: 12 }}
              />
            </label>
            <button type="button" onClick={onNewProject} style={{ fontSize: 12, padding: '4px 8px', cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}>{tBrain('addProject')}</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{projectName(chat.projectId)}</span>
            <Link href={`/workflows?project=${chat.projectId}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>{tBrain('workflowsArrow')}</Link>
            <Link href={`/ide/${chat.projectId}?chat=${chat.id}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--coral-bright)' }}>{tBrain('openInIde')}</Link>
          </>
        )}
      </div>
    </div>
  );
}
