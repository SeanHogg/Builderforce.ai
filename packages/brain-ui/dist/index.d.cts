import * as React from 'react';
import React__default from 'react';
import { BrainMessage, BrainTraceEvent, DirectedRecipient, ChatInputAttachment } from '@seanhogg/builderforce-brain-embedded';

interface BrainTimelineLabels {
    /** Shown on the live thinking node while a turn streams. */
    thinking: string;
    /** "Thought for {duration}" — must contain the literal `{duration}` token. */
    thoughtFor: string;
    you: string;
    assistant: string;
    input: string;
    output: string;
    error: string;
    loading: string;
    empty: string;
    copy: string;
    copied: string;
    apply: string;
    createFile: string;
    /** Heading for the change preview shown on an edit_file / write_file tool step. */
    preview: string;
}
declare const DEFAULT_TIMELINE_LABELS: BrainTimelineLabels;
interface BrainTimelineProps {
    messages: BrainMessage[];
    trace: BrainTraceEvent[];
    streamingText: string;
    isRunning: boolean;
    loading?: boolean;
    labels?: Partial<BrainTimelineLabels>;
    /** Override the assistant display name (defaults to labels.assistant). */
    assistantName?: string;
    /** Replaces the built-in empty state entirely. */
    emptyState?: React__default.ReactNode;
    /** Render a message's text. Defaults to the shared <Markdown>. The web app
     *  passes its richer ChatMessageBubble here so no feature is lost. */
    renderMessage?: (msg: BrainMessage, ctx: {
        role: 'user' | 'assistant';
        text: string;
    }) => React__default.ReactNode;
    /** Render the live streaming assistant bubble. Defaults to <Markdown>. */
    renderStreaming?: (text: string) => React__default.ReactNode;
    /** Per-assistant-message action row (copy / feedback / suggestions). */
    renderAssistantActions?: (msg: BrainMessage) => React__default.ReactNode;
    onInternalLink?: (href: string) => void;
    onApplyCode?: (code: string) => void;
    onCreateFile?: (path: string, content: string) => void;
    /** Auto-scroll to the newest node while near the bottom (default true). */
    autoScroll?: boolean;
}
/**
 * The unified Brain chat transcript: a vertical lineage of gutter dots (joined by
 * a connecting line) where each step is one node — a user turn (with image
 * bubbles), a "thinking" marker, an assistant reply, a collapsible tool call with
 * Input/Output, or an error. Presentational and theme-driven (CSS variables), so
 * it renders identically in the web app and a VS Code webview.
 */
declare function BrainTimelineInner({ messages, trace, streamingText, isRunning, loading, labels: labelOverrides, assistantName, emptyState, renderMessage, renderStreaming, renderAssistantActions, onInternalLink, onApplyCode, onCreateFile, autoScroll, }: BrainTimelineProps): React__default.JSX.Element;
/**
 * Memoized so an unrelated re-render of the host (e.g. every keystroke in the
 * composer, which lives in the same component tree) does not re-render the whole
 * transcript and re-parse every message's markdown. Callers must pass referentially
 * stable props (memoize `labels` and any `on*` callbacks) for this to take effect.
 */
declare const BrainTimeline: React__default.MemoExoticComponent<typeof BrainTimelineInner>;

interface MarkdownLabels {
    copy: string;
    copied: string;
    apply: string;
    createFile: string;
}
interface MarkdownProps {
    content: string;
    /** Route an in-app link (e.g. `/tasks/12`) through the host's router. */
    onInternalLink?: (href: string) => void;
    /** When set, code blocks show an "Apply" button handing back the code. */
    onApplyCode?: (code: string) => void;
    /** When set, code blocks show a "Create file" button (path heuristically parsed). */
    onCreateFile?: (path: string, content: string) => void;
    labels?: Partial<MarkdownLabels>;
}
/**
 * XSS-safe markdown (react-markdown does not render raw HTML by default) with
 * custom code blocks (copy / apply / create) and router-aware internal links.
 * Self-contained so both the web app and the VS Code webview render assistant
 * replies identically.
 */
declare function MarkdownInner({ content, onInternalLink, onApplyCode, onCreateFile, labels }: MarkdownProps): React__default.JSX.Element;
/**
 * Memoized: parsing markdown through the remark pipeline is expensive, and the
 * transcript re-renders on every streaming token / composer keystroke. Skipping the
 * re-parse of settled messages (unchanged `content`/callbacks) keeps typing snappy.
 */
declare const Markdown: React__default.MemoExoticComponent<typeof MarkdownInner>;

/**
 * Participant avatars — the shared way a chat renders WHO a participant is.
 *
 * A BuilderForce chat is multi-party (the BRAIN + invited agents/humans). Wherever
 * a participant appears — the "→ recipient" badge on a directed message, the
 * composer's recipient chip — it shows a compact colored avatar of their initials
 * so the roster reads at a glance. Presentational and dependency-free; the colored
 * disc reads in BOTH light and dark themes (fixed palette + white text), so it
 * needs no theme tokens.
 */
/** Up to two initials from a display name (e.g. "Bob Developer" → "BD"). */
declare function initialsOf(name: string): string;
/** Deterministic colour for a name, so the same participant is always the same hue. */
declare function avatarColor(seed: string): string;
interface AvatarProps {
    name: string;
    /** 'human' gets a round disc; 'agent' a rounded square, so the two read apart. */
    kind?: DirectedRecipient['kind'];
    /** Diameter in px (default 18). */
    size?: number;
    title?: string;
    style?: React__default.CSSProperties;
}
/** A single participant avatar: initials on a deterministic coloured disc/tile. */
declare function Avatar({ name, kind, size, title, style }: AvatarProps): React__default.JSX.Element;
/** Avatar + name — the "→ recipient" badge shown on a directed message / composer chip. */
declare function ParticipantBadge({ recipient, prefix, size }: {
    recipient: DirectedRecipient;
    prefix?: string;
    size?: number;
}): React__default.JSX.Element;

/**
 * HealthRing — a compact "% done" donut for a work item's health, rendered
 * identically on the web app and inside the VS Code webview. Pure presentational
 * SVG (no chart library): give it a 0–100 percent and it draws a tier-coloured
 * ring with the percentage in the centre. Colours come from `--bf-health-*`
 * theme variables (with sensible fallbacks) so it reads in light AND dark.
 */
interface HealthRingProps {
    /** 0–100 completion. */
    percent: number;
    /** Diameter in px (default 40). */
    size?: number;
    /** Ring thickness in px (default 4). */
    stroke?: number;
    /** Optional caption under the ring (e.g. "3/8"). */
    caption?: string;
    /** Dim the ring (e.g. the ticket no longer exists). */
    muted?: boolean;
    ariaLabel?: string;
}
/** Map a completion percent to a tier colour (CSS var with hex fallback). */
declare function healthRingColor(percent: number, muted?: boolean): string;
declare function HealthRing({ percent, size, stroke, caption, muted, ariaLabel }: HealthRingProps): React.JSX.Element;

/**
 * Shared types for the ChatTicketsPanel — the chat↔ticket surface rendered
 * identically on the web app and inside the VS Code webview. The panel is
 * presentational + self-managing; each host injects a {@link ChatTicketsAdapter}
 * (its own REST calls) and a {@link ChatTicketsLabels} bundle (its own i18n).
 */
/** The work-item kinds a chat can be tied to (planning spine + roadmap + spec + gap). */
type TicketKind = 'portfolio' | 'objective' | 'initiative' | 'roadmap' | 'spec' | 'epic' | 'gap' | 'task';
declare const TICKET_KINDS: TicketKind[];
/** Only these kinds are runnable (a real board ticket an agent can execute). */
declare const RUNNABLE_KINDS: TicketKind[];
type LinkType = 'linked' | 'created';
/** A chat↔ticket link with a live health summary. */
interface TicketLinkVM {
    linkId: number;
    kind: TicketKind;
    ref: string;
    label: string;
    status: string;
    progressPct: number;
    done: number;
    total: number;
    exists: boolean;
    linkType: LinkType;
}
/** A chat that references a ticket (a lineage row). */
interface LineageVM {
    chatId: number;
    title: string;
    linkType: LinkType;
    isArchived: boolean;
}
/** An agent invited into the chat. */
interface ChatAgentVM {
    id: string;
    agentRef: string;
    role: string;
}
/** A human participant of the chat (shared access / audience, migration 0288). */
interface ChatMemberVM {
    id: number;
    userId: string | null;
    name: string;
    email: string;
    /** 'active' (joined) | 'pending' (email invite, not yet an account). */
    status: string;
}
/** A selectable agent from the tenant pool. */
interface AgentOptionVM {
    ref: string;
    name: string;
    meta: string;
    kind: string;
}
/** A pickable ticket for the link form. */
interface TicketOptionVM {
    ref: string;
    label: string;
}
/** Another chat, for the merge picker. */
interface ChatOptionVM {
    id: number;
    title: string;
}
/**
 * Host-provided data access — the only coupling to a backend. The web app wires
 * this to its `brain.*` / `pmoApi` / `tasksApi` clients; the VS Code webview wires
 * it to its bearer-fetch REST client. Same panel, same endpoints, different host.
 */
interface ChatTicketsAdapter {
    listTickets(chatId: number): Promise<TicketLinkVM[]>;
    linkTicket(chatId: number, input: {
        kind: TicketKind;
        ref: string;
        linkType: LinkType;
    }): Promise<void>;
    unlinkTicket(chatId: number, kind: TicketKind, ref: string): Promise<void>;
    listTicketChats(kind: TicketKind, ref: string): Promise<LineageVM[]>;
    consolidate(targetChatId: number, sourceChatIds: number[]): Promise<void>;
    listAgents(chatId: number): Promise<ChatAgentVM[]>;
    inviteAgent(chatId: number, input: {
        agentRef: string;
        agentKind: string;
    }): Promise<void>;
    removeAgent(chatId: number, assignmentId: string): Promise<void>;
    loadAgentPool(): Promise<AgentOptionVM[]>;
    /** Human participants of the chat (shared access, migration 0288). */
    listMembers(chatId: number): Promise<ChatMemberVM[]>;
    /** Invite a human by email; returns the resolution ('active' | 'pending'). */
    inviteMember(chatId: number, email: string): Promise<{
        status: string;
    }>;
    removeMember(chatId: number, memberId: number): Promise<void>;
    /** Pickable tickets per tier for the current project (all tenants tiers). */
    loadTicketOptions(projectId: number | null): Promise<Record<TicketKind, TicketOptionVM[]>>;
    /** Tag an agent to execute a runnable (task/epic) ticket. Returns whether a run
     *  actually started + the agent's display name for the toast. */
    runTicket(kind: TicketKind, ref: string, agentRef: string): Promise<{
        started: boolean;
        agentName: string;
    }>;
}
/** Every visible string. Parametric ones are functions the host localizes. */
interface ChatTicketsLabels {
    none: string;
    spawned: string;
    run: string;
    lineage: string;
    unlink: string;
    pickAgent: string;
    lineageTitle: string;
    lineageEmpty: string;
    merged: string;
    runNoAgent: string;
    runFailed: string;
    link: string;
    agents: string;
    merge: string;
    linkFailed: string;
    kindLabel: string;
    pickTicket: string;
    /** Placeholder for the ticket-picker search box. */
    searchTicket: string;
    linkTypeLabel: string;
    linkTypeLinked: string;
    linkTypeCreated: string;
    linkAction: string;
    noAgents: string;
    removeAgent: string;
    inviteAgent: string;
    agentsHint: string;
    people: string;
    noPeople: string;
    invitePerson: string;
    invitePersonHint: string;
    removePerson: string;
    inviteSent: string;
    invitePending: string;
    visibilityShared: string;
    visibilityLocked: string;
    lockHint: string;
    mergeHint: string;
    mergeNoOthers: string;
    kind: Record<TicketKind, string>;
    ringAria: (label: string, pct: number) => string;
    /** "+N more — refine your search" hint under a capped ticket picker. */
    moreResults: (n: number) => string;
    runStarted: (agent: string) => string;
    mergeAction: (n: number) => string;
    mergedN: (n: number) => string;
}
/** English defaults — the VS Code webview uses these; the web app overrides via next-intl. */
declare const DEFAULT_CHAT_TICKETS_LABELS: ChatTicketsLabels;

interface ChatTicketsPanelProps {
    chatId: number;
    projectId: number | null;
    /** Other chats (for the merge picker). */
    chatList: ChatOptionVM[];
    adapter: ChatTicketsAdapter;
    labels: ChatTicketsLabels;
    /** Called after a change to the chat's roster/lineage — a merge, or an agent
     *  invite/removal — so the host can refresh its chat list (e.g. the sidebar's
     *  per-session participant indicators). */
    onChanged?: () => void;
    /** Bump to force a reload of tickets + agents — the host raises this when the
     *  Brain mutates work items via MCP tools (link/merge/invite/task move) so the
     *  panel doesn't go stale after a change it didn't originate. */
    refreshSignal?: number;
    /** Current LOCK state of the chat. When provided (with {@link onSetVisibility})
     *  the People section shows a shared/locked toggle. Owner-gated by the host. */
    visibility?: 'shared' | 'locked';
    /** Flip the chat's LOCK state (owner only). Omit to hide the toggle. */
    onSetVisibility?: (v: 'shared' | 'locked') => Promise<void>;
}
declare function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility }: ChatTicketsPanelProps): React.JSX.Element;
/**
 * Memoized: this panel sits directly under the composer, so it would otherwise
 * reconcile its whole subtree (health-ring SVGs, selects, link/merge/agents forms)
 * on every keystroke and streaming token. Callers must pass referentially stable
 * props (memoize `chatList` and `onChanged`) for the memo to take effect.
 */
declare const ChatTicketsPanel: React.MemoExoticComponent<typeof ChatTicketsPanelInner>;

/**
 * The invited participants of a chat, resolved to display names, as addressable
 * recipients — the shared source for a composer's recipient picker and any
 * participant roster. Reads the invited list (changes on invite/remove → keyed on
 * `refreshSignal`) and the stable agent pool (the adapter caches it, so this
 * shares the ChatTicketsPanel's fetch rather than duplicating it).
 *
 * Lives here (not in a host) so the web app and the VS Code webview derive the
 * exact same participant set the same way.
 */
declare function useChatParticipants(adapter: ChatTicketsAdapter, chatId: number | null, refreshSignal?: number): DirectedRecipient[];

/**
 * Pure transcript view-model — frame-work agnostic so the SAME logic drives the
 * web app and the VS Code webview. It merges the durable message list (user +
 * assistant turns) with the live execution trace (LLM turns → "thinking", tool
 * calls → input/output, errors) into one chronologically-ordered list of
 * timeline nodes the renderer maps 1:1 onto gutter dots.
 *
 * No React, no DOM — just data in, nodes out — so it's unit-testable and reused
 * verbatim across surfaces.
 */

interface TimelineImage {
    url: string;
    name?: string;
}
type TimelineNode = {
    key: string;
    kind: 'user';
    ts: number;
    order: number;
    message: BrainMessage;
    text: string;
    images: TimelineImage[];
} | {
    key: string;
    kind: 'assistant';
    ts: number;
    order: number;
    message: BrainMessage;
    text: string;
} | {
    key: string;
    kind: 'thinking';
    ts: number;
    order: number;
    durationMs?: number;
    step: number;
} | {
    key: string;
    kind: 'tool';
    ts: number;
    order: number;
    label: string;
    args: unknown;
    result: unknown;
    isError: boolean;
    durationMs?: number;
} | {
    key: string;
    kind: 'error';
    ts: number;
    order: number;
    label: string;
    message: string;
} | {
    key: string;
    kind: 'streaming';
    ts: number;
    order: number;
    text: string;
};
interface BuildTimelineInput {
    messages: BrainMessage[];
    trace: BrainTraceEvent[];
    streamingText: string;
    isRunning: boolean;
}
/** Pull the attachment list a message stored in its metadata JSON (best-effort). */
declare function attachmentsOf(message: BrainMessage): ChatInputAttachment[];
/**
 * Build the ordered timeline. The persisted assistant `message` trace events are
 * dropped (the durable assistant message already carries that text); `llm` turns
 * become "thinking" nodes, `tool`/`error` become their own steps. Everything is
 * sorted by timestamp with a per-kind tie-break, then a stable index tie-break.
 */
declare function buildTimeline(input: BuildTimelineInput): TimelineNode[];
/**
 * The stable, settled portion of the timeline — everything derived from the durable
 * `messages` and `trace` (the expensive map + sort). Split out from {@link buildTimeline}
 * so a live streaming turn (whose text ticks on every token) can be appended cheaply
 * without re-mapping and re-sorting the whole conversation per token.
 */
declare function buildSettledTimeline(messages: BrainMessage[], trace: BrainTraceEvent[]): TimelineNode[];
/** The trailing live-streaming assistant bubble, or null when nothing is streaming.
 *  Always sorts last (max timestamp), so callers append it after the settled nodes. */
declare function streamingNode(streamingText: string, isRunning: boolean): TimelineNode | null;
/** Compact human duration for a "Thought for …" label (e.g. 0s, 2s, 12s). */
declare function formatDuration(ms: number | undefined): string;
/** Pretty-print a tool arg/result payload for the IN/OUT panels. */
declare function formatPayload(value: unknown): string;

/**
 * Project 360 model — the shape returned by `GET /api/projects/:id/360` and
 * consumed by <Project360View>. Kept in the shared UI package so every surface
 * (the VS Code webview today, the web app next) renders the SAME contract.
 * Mirrors the API's `computeProject360` output.
 */
type HealthTier = 'healthy' | 'watch' | 'at_risk' | 'critical';
interface Project360Action {
    kind: 'board' | 'approvals' | 'brain' | 'run-task' | 'open-task';
    label: string;
    text?: string;
    task?: {
        id: number;
        key?: string;
        title: string;
    };
}
interface Project360Gap {
    id: string;
    dimension: string;
    severity: 'high' | 'medium' | 'low';
    title: string;
    detail?: string;
    action?: Project360Action;
}
interface Project360Dimension {
    key: string;
    label: string;
    pillar: string;
    score: number;
    tier: HealthTier;
    color: string;
    summary: string;
    gaps: Project360Gap[];
}
interface Project360Pillar {
    key: string;
    label: string;
    score: number;
    tier: HealthTier;
    color: string;
}
interface Project360Member {
    ref: string;
    kind: 'human' | 'host' | 'cloud';
    name: string;
    status: 'working' | 'awaiting' | 'blocked' | 'idle' | 'available';
    reason: string;
    taskId?: number;
    taskKey?: string;
    taskTitle?: string;
}
interface Project360 {
    project: {
        id: number;
        name: string;
        key?: string;
        status?: string;
    };
    hasData: boolean;
    overall: {
        score: number;
        tier: HealthTier;
        color: string;
        progressPct: number;
    };
    counts: {
        total: number;
        completed: number;
        open: number;
        blocked: number;
        overdue: number;
        unassigned: number;
        inProgress: number;
        activeRuns: number;
        workers: number;
    };
    pillars: Project360Pillar[];
    dimensions: Project360Dimension[];
    gaps: Project360Gap[];
    workforce: Project360Member[];
    generatedAt: string;
}
/** UI strings — defaulted to English, overridable so the host can localize
 *  (the VS Code webview feeds its `vscode.l10n` bundle; the web app next-intl). */
interface Project360Labels {
    title: string;
    subtitle: string;
    overall: string;
    progress: string;
    refresh: string;
    openBoard: string;
    improveAll: string;
    connecting: string;
    loadError: string;
    noData: string;
    noDataHint: string;
    missingItems: string;
    noGaps: string;
    workforce: string;
    noWorkforce: string;
    allDimensions: string;
    counts_open: string;
    counts_blocked: string;
    counts_overdue: string;
    counts_running: string;
    status_working: string;
    status_awaiting: string;
    status_blocked: string;
    status_idle: string;
    status_available: string;
    member_run: string;
    member_open: string;
    improveSeedIntro: string;
}
declare const DEFAULT_PROJECT360_LABELS: Project360Labels;

/**
 * <Project360View> — the whole-picture project management surface. A two-ring
 * health wheel, the overall score + counts, a severity-ranked "missing items"
 * checklist whose every row carries a one-click improve action, and the live
 * workforce (who is working / idle and why). Presentational + reusable: it takes
 * the {@link Project360} model and a single `onAction` callback, so the VS Code
 * webview and the web app drive it identically. Themed via `--bf-*` variables →
 * works in light and dark, and reflows to one column on a narrow panel.
 */
interface Project360ViewProps {
    data: Project360 | null;
    loading?: boolean;
    error?: string | null;
    labels?: Partial<Project360Labels>;
    /** Perform a gap/workforce/header action (open board, ask Brain, run/open a task…). */
    onAction?: (action: Project360Action) => void;
    onRefresh?: () => void;
}
declare function Project360View({ data, loading, error, labels, onAction, onRefresh }: Project360ViewProps): React.JSX.Element;

/**
 * The Project 360 wheel — a two-ring sunburst. Inner ring = the four pillars,
 * outer ring = their eight dimensions (two per pillar, aligned above it), each
 * arc coloured by its health tier. The centre shows the overall score. Presentational
 * only: it takes the model + a selection callback and draws SVG (no chart library),
 * themed via `--bf-*` variables + the tier colours the API already resolved.
 */
interface SunburstProps {
    pillars: Project360Pillar[];
    dimensions: Project360Dimension[];
    overall: {
        score: number;
        color: string;
    };
    selected?: string | null;
    onSelect?: (dimensionKey: string | null) => void;
    ariaLabel?: string;
}
declare function Sunburst({ pillars, dimensions, overall, selected, onSelect, ariaLabel }: SunburstProps): React.JSX.Element;

/**
 * Generic project-list model — the shared contract for every list-shaped project
 * page rendered natively in a bundled-React webview (Backlog, PRDs, and future
 * list views). One presentational <ProjectListView> renders any of them; each host
 * screen maps its API response into this model, so the transport/theme/empty-error
 * handling is written once (DRY) and the per-view code is just a fetch + a mapper.
 */

type ProjectListTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
/** A work item to auto-link to the chat when the row's action opens one. */
interface ProjectListTicketRef {
    kind: TicketKind;
    ref: string;
    title?: string;
}
interface ProjectListBadge {
    label: string;
    tone?: ProjectListTone;
}
/** A row action, forwarded verbatim to the host (which owns the actual command). */
interface ProjectListAction {
    kind: 'open-task' | 'brain' | 'open-360';
    label?: string;
    /** For `brain`: the seed prompt. */
    text?: string;
    /** For `open-task`: the task to open a working session for. */
    task?: {
        id: number;
        key?: string;
        title: string;
        taskType?: 'task' | 'epic' | 'gap';
    };
    /** The work item this row represents — the host auto-links it to the opened chat
     *  so the conversation is tied to (and has context on) the item that spawned it. */
    ticket?: ProjectListTicketRef;
}
interface ProjectListItem {
    id: string | number;
    /** Short human key shown as a monospace chip (e.g. a task key or spec id). */
    key?: string;
    title: string;
    subtitle?: string;
    badges?: ProjectListBadge[];
    /** Clicking the row (and its primary button) raises this. */
    action?: ProjectListAction;
}
interface ProjectListGroup {
    key: string;
    label: string;
    tone?: ProjectListTone;
    items: ProjectListItem[];
}
interface ProjectListModel {
    groups: ProjectListGroup[];
    total: number;
}
/** UI strings — English defaults, overridable so the host can localize (the VS Code
 *  webview feeds its `vscode.l10n` bundle; the web app next-intl). */
interface ProjectListLabels {
    refresh: string;
    connecting: string;
    loadError: string;
    empty: string;
    emptyHint: string;
    items: string;
}
declare const DEFAULT_PROJECT_LIST_LABELS: ProjectListLabels;

/**
 * <ProjectListView> — the shared, presentational surface for every list-shaped
 * project page (Backlog, PRDs, …). It takes a {@link ProjectListModel} (groups of
 * rows with badges + a per-row action) and a single `onAction` callback, so the VS
 * Code webview and the web app drive it identically. Themed via `--bf-*` variables
 * → works in light and dark, and reflows to one column on a narrow panel. Loading,
 * error, and empty are all handled here so a page never renders blank.
 */
interface ProjectListViewProps {
    title: string;
    subtitle?: string;
    data: ProjectListModel | null;
    loading?: boolean;
    error?: string | null;
    labels?: Partial<ProjectListLabels>;
    onAction?: (action: ProjectListAction) => void;
    onRefresh?: () => void;
}
declare function ProjectListView({ title, subtitle, data, loading, error, labels, onAction, onRefresh }: ProjectListViewProps): React.JSX.Element;

export { type AgentOptionVM, Avatar, type AvatarProps, BrainTimeline, type BrainTimelineLabels, type BrainTimelineProps, type BuildTimelineInput, type ChatAgentVM, type ChatOptionVM, type ChatTicketsAdapter, type ChatTicketsLabels, ChatTicketsPanel, type ChatTicketsPanelProps, DEFAULT_CHAT_TICKETS_LABELS, DEFAULT_PROJECT360_LABELS, DEFAULT_PROJECT_LIST_LABELS, DEFAULT_TIMELINE_LABELS, HealthRing, type HealthRingProps, type HealthTier, type LineageVM, type LinkType, Markdown, type MarkdownLabels, type MarkdownProps, ParticipantBadge, type Project360, type Project360Action, type Project360Dimension, type Project360Gap, type Project360Labels, type Project360Member, type Project360Pillar, Project360View, type Project360ViewProps, type ProjectListAction, type ProjectListBadge, type ProjectListGroup, type ProjectListItem, type ProjectListLabels, type ProjectListModel, type ProjectListTicketRef, type ProjectListTone, ProjectListView, type ProjectListViewProps, RUNNABLE_KINDS, Sunburst, type SunburstProps, TICKET_KINDS, type TicketKind, type TicketLinkVM, type TicketOptionVM, type TimelineImage, type TimelineNode, attachmentsOf, avatarColor, buildSettledTimeline, buildTimeline, formatDuration, formatPayload, healthRingColor, initialsOf, streamingNode, useChatParticipants };
