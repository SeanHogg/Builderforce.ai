import * as React from 'react';
import React__default from 'react';
import { BrainMessage, BrainTraceEvent, DirectedRecipient, EvermindRecallItem, EvermindLearnTarget, ChatInputAttachment } from '@seanhogg/builderforce-brain-embedded';

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
    /** <QuestionCard> copy (ask_user) — carried here so a host passes ONE label bundle. */
    askSubmit: string;
    askAnswered: string;
    /** Provenance chip: the badge shown when the tenant's OWN connected frontier
     *  account served the turn. */
    accountOwn: string;
    /** Provenance chip: the badge for a turn served by the shared model pool. */
    accountShared: string;
    /** Provenance chip: the badge for a shared-pool turn when the tenant HAS a
     *  connected account that wasn't used — the case worth flagging. */
    accountByoUnused: string;
    /** Provenance chip tooltip: shown on the "🧠 Evermind vN" badge when the
     *  project's own self-learning model generated this reply. */
    ranOnEvermind: string;
    /** Evermind recall step title — must contain `{count}` and `{version}`. */
    recallTitle: string;
    /** Tooltip on the recall step explaining what it means. */
    recallHint: string;
    /** Evermind learn step — the turn was contributed back. Must contain `{version}`. */
    learnTitle: string;
    /** Tooltip on the learn step. */
    learnHint: string;
    /** Evermind SKIPPED-learn step — the turn did NOT contribute, and why. Must contain
     *  `{reason}` (filled from {@link learnSkipReason}). */
    learnSkippedTitle: string;
    /** Tooltip on the skipped-learn step. */
    learnSkippedHint: string;
    /** Human phrase per skip reason, substituted into {@link learnSkippedTitle}. */
    learnSkipReason: {
        'not-attached': string;
        'not-seeded': string;
        frozen: string;
    };
    /** Per-Evermind CONTRIBUTED line for a multi-target fan-out. Must contain `{name}`,
     *  `{projectId}`, `{version}`. */
    learnTargetContributed: string;
    /** Per-Evermind SKIPPED line for a multi-target fan-out. Must contain `{name}`,
     *  `{projectId}`, `{reason}` (filled from {@link learnSkipReason}). */
    learnTargetSkipped: string;
    /** Evermind reconcile step — the turn updated learned memories. Must contain
     *  `{count}` and `{version}`. */
    reconcileTitle: string;
    /** Tooltip on the reconcile step. */
    reconcileHint: string;
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
    /** Post the user's answer to an agent's `ask_user` question as their next turn.
     *  When set, an assistant message carrying an ask-user block renders a clickable
     *  <QuestionCard>; without it the block degrades to plain text. */
    onAnswerQuestion?: (answer: string) => void;
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
declare function BrainTimelineInner({ messages, trace, streamingText, isRunning, loading, labels: labelOverrides, assistantName, emptyState, renderMessage, renderStreaming, renderAssistantActions, onInternalLink, onApplyCode, onCreateFile, onAnswerQuestion, autoScroll, }: BrainTimelineProps): React__default.JSX.Element;
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
 * The "ask the user a question" protocol — shared by the web app and the VS Code
 * webview so a clarifying question renders identically as a clickable card on both.
 *
 * The agent emits its question as a fenced ```ask-user block carrying a small JSON
 * payload (produced server-side when the model calls the `ask_user` tool — a
 * schema-validated call is far more reliable than asking a weak model to hand-format
 * JSON in prose). {@link parseAskUser} lifts that payload out of an assistant message
 * and {@link stripAskUser} removes the raw block so the surrounding prose still reads
 * cleanly; <BrainTimeline> renders the payload with <QuestionCard>. If the block is
 * absent or malformed, both degrade gracefully (no card; the fenced block just shows
 * as normal code), so a question is never lost.
 */
interface AskUserOption {
    label: string;
    description?: string;
}
interface AskUserPayload {
    question: string;
    options: AskUserOption[];
    /** Allow more than one option to be chosen (checkboxes + submit) instead of a
     *  single click. */
    multiSelect?: boolean;
}
/** Copy for <QuestionCard> — defaulted in English, overridable per host for i18n. */
interface AskUserLabels {
    /** Submit button for a multi-select card. */
    askSubmit: string;
    /** Shown on the card once the user has answered (buttons disabled). */
    askAnswered: string;
    /** <PendingQuestionBanner> heading — the chat is blocked on this answer. */
    askPending: string;
    /** <PendingQuestionBanner> link to scroll the question's card into view. */
    askJumpTo: string;
}
declare const DEFAULT_ASK_USER_LABELS: AskUserLabels;
/** Extract the ask-user payload from an assistant message, or null if none/invalid. */
declare function parseAskUser(text: string): AskUserPayload | null;
/** Remove the raw ask-user fenced block so the message's prose reads cleanly beside
 *  the rendered card. Collapses the whitespace the removed block leaves behind. */
declare function stripAskUser(text: string): string;
/**
 * Serialize a payload into the canonical fenced block the agent runtime emits and
 * {@link parseAskUser} reads. Shared so the producer (server) and consumer (UI) can
 * never drift on the format.
 */
declare function serializeAskUser(payload: AskUserPayload): string;
/** The minimal message shape {@link selectPendingAskUser} needs — structural on
 *  purpose, so this module stays free of a brain-embedded import. */
interface AskUserMessageLike {
    id: number;
    role: string;
    content: string;
}
/** An unanswered question and the message carrying it. */
interface PendingAskUser {
    payload: AskUserPayload;
    /** The assistant message the question rides in (lets a host reveal its card). */
    messageId: number;
}
/** The DOM id of a rendered question card. ONE convention, shared by the timeline
 *  that stamps it and any host that scrolls to it — so the two can never drift. */
declare function askUserAnchorId(messageId: number): string;
/**
 * The question the conversation is currently BLOCKED on, or null when there is none.
 * Walks back from the newest turn: the last assistant `ask-user` block wins, but a
 * user turn after it means the question was already answered (answering posts the
 * choice as the next user turn), so nothing is pending.
 *
 * Shared so a host never re-derives "is there an open question" — the same predicate
 * drives the pinned banner and any host-side pending affordance.
 */
declare function selectPendingAskUser(messages: readonly AskUserMessageLike[]): PendingAskUser | null;
/**
 * A clarifying question rendered as clickable options. Single-select sends the
 * chosen label on click; multi-select collects checkboxes behind a submit button.
 * The chosen label(s) are handed to `onAnswer`, which the host posts as the user's
 * next turn — so the model's question and the user's answer stay in the transcript.
 */
declare function QuestionCard({ payload, labels, onAnswer, anchorId, }: {
    payload: AskUserPayload;
    labels?: Partial<AskUserLabels>;
    onAnswer: (answer: string) => void;
    /** DOM id for scroll-to (see {@link askUserAnchorId}); omit when not targetable. */
    anchorId?: string;
}): React.JSX.Element;
/**
 * The open question, pinned at the composer. A long transcript buries the agent's
 * `ask_user` card, so a chat that is BLOCKED on an answer looks merely idle — this
 * restates the live question where the user is already typing, and answers it through
 * the very same <QuestionCard> (no second options UI to drift), so one click unblocks
 * the run. `onReveal` scrolls the original card into view for the surrounding context.
 *
 * Pair with {@link selectPendingAskUser}; render nothing when it returns null.
 */
declare function PendingQuestionBanner({ payload, labels, onAnswer, onReveal, }: {
    payload: AskUserPayload;
    labels?: Partial<AskUserLabels>;
    onAnswer: (answer: string) => void;
    onReveal?: () => void;
}): React.JSX.Element;

/**
 * ConsolidateForkControl — the shared "compress this chat / branch it into a new
 * one" control, rendered identically on the web Brain composer and inside the VS
 * Code webview (which historically hand-rolled the same two buttons).
 *
 * Presentational only: it renders two buttons and calls back. The host owns the
 * actual consolidation/fork logic (summarize the chat, append the consolidation
 * marker, or create + seed a forked chat) and the busy/enabled state. Colors come
 * exclusively from theme CSS variables (with layered fallbacks) so the SAME markup
 * reads correctly in the web app's light/dark themes and the VS Code editor theme —
 * no hardcoded hex that only works in one theme.
 */
/** Copy for the two buttons — defaulted in English, overridable per host for i18n. */
interface ConsolidateForkLabels {
    consolidate: string;
    consolidating: string;
    fork: string;
    forking: string;
}
declare const DEFAULT_CONSOLIDATE_FORK_LABELS: ConsolidateForkLabels;
interface ConsolidateForkControlProps {
    /** Whether the chat is long enough / in a state where consolidation makes sense. */
    canConsolidate: boolean;
    /** A consolidation is in flight. */
    consolidating: boolean;
    /** A fork is in flight. */
    forking: boolean;
    onConsolidate(): void;
    onFork(): void;
    labels?: Partial<ConsolidateForkLabels>;
    className?: string;
}
/**
 * Two buttons: Consolidate (compress the chat into a summary marker the rest of
 * the conversation builds on) and Fork (branch that summary into a new chat).
 * Both are disabled when consolidation isn't possible or either action is busy,
 * so a host can't fire a second op mid-flight.
 */
declare function ConsolidateForkControl({ canConsolidate, consolidating, forking, onConsolidate, onFork, labels, className, }: ConsolidateForkControlProps): React.JSX.Element;

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
/** A pending human question associated with one of this chat's linked tasks. */
interface ChatQuestionVM {
    id: string;
    description: string;
    taskId: number | null;
    createdAt?: string;
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
    /** Server-side typeahead over ONE tier: up to N (ref,label) hits whose
     *  title/name/goal/key matches `query` (empty = newest first). Replaces the old
     *  "load EVERY ticket then filter in the DOM" — fast AND complete on a huge tenant. */
    searchTickets(kind: TicketKind, query: string, projectId: number | null): Promise<TicketOptionVM[]>;
    /** Tag an agent to execute a runnable (task/epic) ticket. Returns whether a run
     *  actually started + the agent's display name for the toast. */
    runTicket(kind: TicketKind, ref: string, agentRef: string): Promise<{
        started: boolean;
        agentName: string;
    }>;
    /** Pending question/feedback requests for work linked to this chat. */
    listQuestions(chatId: number): Promise<ChatQuestionVM[]>;
    /** Deliver an answer and resume the waiting run. */
    answerQuestion(id: string, responseText: string): Promise<void>;
}
/** Every visible string. Parametric ones are functions the host localizes. */
interface ChatTicketsLabels {
    none: string;
    spawned: string;
    run: string;
    /** Open the linked work item / artifact (board card, OKR, spec) in its own view. */
    open: string;
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
    questions: string;
    noQuestions: string;
    answerPlaceholder: string;
    submitAnswer: string;
    answering: string;
    linkFailed: string;
    kindLabel: string;
    pickTicket: string;
    /** Placeholder for the ticket-picker search box. */
    searchTicket: string;
    /** Shown while a typeahead request is in flight. */
    searching: string;
    /** Shown when a search returns no tickets. */
    noMatches: string;
    /** Hint under a result list that hit the server cap — type to narrow. */
    refine: string;
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
    /** Title on the collapsed ticket header — click to reveal the ring grid. */
    showTickets: string;
    /** Title on the expanded ticket header — click to collapse the ring grid. */
    hideTickets: string;
    kind: Record<TicketKind, string>;
    ringAria: (label: string, pct: number) => string;
    /** N-linked-tickets count shown in the collapsible header. */
    ticketCount: (n: number) => string;
    /** Aria label for the collapsed header's overall-progress ring. */
    overallAria: (pct: number) => string;
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
    /** Open a linked work item / artifact in its own view — the host routes it (web:
     *  SPA nav to the board/OKR/spec; VS Code: a bridge message the extension handles).
     *  When provided, each ticket's label becomes a clickable "open the artifact" link
     *  so every item the Brain created from this chat is one click from its board card. */
    onOpenTicket?: (tk: TicketLinkVM) => void;
}
declare function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility, onOpenTicket }: ChatTicketsPanelProps): React.JSX.Element;
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
 * @-mention autocomplete — the shared composer typeahead that lets a user direct
 * the next chat turn at an invited participant (an agent OR a person) by typing
 * "@". The single source of truth for the interaction, rendered identically on the
 * web app's <ChatInput> and inside the VS Code webview's composer.
 *
 * Headless-ish: {@link useMentionAutocomplete} owns the token/selection state and
 * returns handlers you spread onto YOUR <textarea> plus a `popup` node you render
 * inside a `position: relative` composer container. Picking a participant strips
 * the "@query" fragment (the picked recipient is shown by the composer's "To:"
 * chip, so it need not linger in the body) and calls `onPick` — wire that to the
 * host's `setRecipientChoice`, reusing the whole directed-message routing spine.
 *
 * Theme-aware via the same CSS-var fallback chain the ChatTicketsPanel uses, so the
 * popup reads in BOTH the web app (light/dark) and the editor's active theme.
 */

interface MentionLabels {
    /** Heading above the list, e.g. "Direct to". */
    title?: string;
    /** Row sub-label for an invited agent, e.g. "Agent". */
    agent?: string;
    /** Row sub-label for an invited person, e.g. "Person". */
    human?: string;
}
interface UseMentionAutocompleteOptions {
    /** Ref to the composer's <textarea> — read for the live caret position. */
    textareaRef: React__default.RefObject<HTMLTextAreaElement | null>;
    /** Current composer text (controlled). */
    value: string;
    /** Setter for the composer text (same one the textarea's onChange calls). */
    setValue: (v: string) => void;
    /** The chat's invited participants (agents + humans) offered by the picker. */
    participants: DirectedRecipient[];
    /** Called with the participant the user picked — wire to `setRecipientChoice`. */
    onPick: (r: DirectedRecipient) => void;
    labels?: MentionLabels;
    /** Suppress the picker entirely (e.g. while a run is streaming). */
    disabled?: boolean;
}
interface MentionAutocomplete {
    /**
     * Attach to the textarea's onKeyDown BEFORE your own logic. Returns true when it
     * consumed the key (nav / select / escape) — when true you must NOT also submit
     * or insert a newline for that key.
     */
    onKeyDown: (e: React__default.KeyboardEvent<HTMLTextAreaElement>) => boolean;
    /** Attach to the textarea's onSelect so a caret move re-detects the token. */
    onSelect: () => void;
    /** The popup element; render it inside a `position: relative` container. */
    popup: React__default.ReactNode;
    /** True while the picker is open (its nav keys are being intercepted). */
    open: boolean;
}
declare function useMentionAutocomplete(opts: UseMentionAutocompleteOptions): MentionAutocomplete;

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
/** Why a turn did not feed the project Evermind (mirrors the api's `BrainLearnSkipReason`). */
type BrainLearnSkipReason = 'not-attached' | 'not-seeded' | 'frozen';
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
    kind: 'recall';
    ts: number;
    order: number;
    version: number;
    count: number;
    items: EvermindRecallItem[];
} | {
    key: string;
    kind: 'learn';
    ts: number;
    order: number;
    version: number;
    skipped?: BrainLearnSkipReason;
    targets?: EvermindLearnTarget[];
} | {
    key: string;
    kind: 'reconcile';
    ts: number;
    order: number;
    version: number;
    count: number;
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
 *
 * Tool + memory steps come from the live `trace` during a run and are ALSO persisted
 * as `role:'tool'` messages (so they survive a reload — the trace is in-memory only).
 * A step present in both is rendered once (dedup by {@link stepSig}); a prior run's
 * step, present only in the messages, still shows.
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
 * Shared types for the <EvermindConsole> — the per-project Evermind inspect-and-train
 * surface rendered identically on the web app and inside the VS Code sidebar webview.
 * The console is presentational + self-managing; each host injects an
 * {@link EvermindConsoleAdapter} (its own REST calls) and an {@link EvermindConsoleLabels}
 * bundle (its own i18n). See [[evermind-learning-architecture]].
 */
type EvermindMode = 'connected' | 'offline-frozen';
/** One inspectable contribution the coordinator merged into a version. */
interface EvermindRecentEntry {
    /** Stable unique id — targets a specific learned memory (Validate highlight / detail). */
    id: number;
    /** 'text' = a run/exemplar adapted here; 'delta' = a pre-diffed weight delta. */
    kind: 'text' | 'delta';
    /** The version this contribution was merged into. */
    version: number;
    /** Epoch ms the merge landed. */
    at: number;
    /** FedAvg sample weight. */
    weight: number;
    /** The task prompt the run addressed (text-path only). */
    prompt?: string;
    /** The run/exemplar text that was learned (text-path only). */
    text?: string;
}
/** A scored recall match — a learned memory plus its 0..1 relevance to a task. */
interface EvermindValidateMatch extends EvermindRecentEntry {
    /** Lexical relevance of this memory to the validated task, 0..1. */
    score: number;
}
/** The Validate result: which learned memories would answer a candidate task. */
interface EvermindValidateResult {
    prompt: string;
    version: number;
    seeded: boolean;
    /** Ranked best-first; empty when nothing learned matches the task. */
    matches: EvermindValidateMatch[];
    /** Id of the memory most likely used to respond, or null if none matched. */
    primaryId: number | null;
    /** Which ranker produced these matches: the model's own SSM embedding (semantic)
     *  or a lexical fallback when the model couldn't be reached. */
    method: 'embedding' | 'lexical';
}
/** The latest automatic pre/post regression check: the previous vs merged model scored
 *  on the same held-out set of prior taught examples. `delta = baseLoss - newLoss`. */
interface EvermindEvalPoint {
    version: number;
    at: number;
    baseLoss: number;
    newLoss: number;
    /** positive = improved / retained on prior tasks; negative = regressed. */
    delta: number;
    evalSize: number;
}
/** The head summary + live learning activity for a project's Evermind. */
interface EvermindConsoleData {
    version: number;
    seeded: boolean;
    mode: EvermindMode;
    contributions: number;
    inferenceEnabled: boolean;
    teacherModel: string | null;
    lastLearnedAt: string | null;
    /** Contributions queued but not yet merged (in the coordinator's debounce window). */
    pending: number;
    recent: EvermindRecentEntry[];
    /** Latest automatic regression check (▲/▼ vs the previous version), or null. */
    eval?: EvermindEvalPoint | null;
}
/**
 * The outcome of importing a local builderforce-memory snapshot into this Evermind:
 * how many raw facts were absorbed + merged (and the resulting version), plus how many
 * source entries were then compacted to terse stubs and the bytes that recovered. A
 * host returns `null` from {@link EvermindConsoleAdapter.importMemory} when the user
 * cancels the file picker (a no-op, not an error).
 */
interface MemoryImportReport {
    /** The file the user imported (basename), for the confirmation notice. */
    fileName: string;
    /** Raw facts accepted into the learn queue. */
    absorbed: number;
    /** Facts skipped (too short / rejected), with the reason count rolled up. */
    skipped: number;
    /** Contributions merged into the model by the closing flush. */
    merged: number;
    /** Model version after the merge — stamped into each compacted stub. */
    version: number;
    /** Source entries rewritten to `[absorbed→Evermind vN]` stubs. */
    compacted: number;
    /** Bytes removed from the snapshot by compaction (the context-bloat recovered). */
    bytesSaved: number;
}
/** A published Studio Evermind model that can seed a project's learnable base. */
interface EvermindSeedModel {
    slug: string;
    name: string;
}
/** The teacher picker's options: the plan's coding models + whether teachers are allowed. */
interface EvermindTeacherOptions {
    models: string[];
    isPaid: boolean;
}
/**
 * Host-provided data access + mutations — the only coupling to a backend. The web
 * app wires this to its `projectEvermindApi` client; the VS Code webview wires it to
 * its bearer-fetch REST client. Same console, same endpoints, different host.
 */
interface EvermindConsoleAdapter {
    /** Read the console payload (head summary + queued depth + recent-learned ring). */
    loadData(): Promise<EvermindConsoleData>;
    /** Publishable Evermind models for the unseeded seed picker (managers only). */
    loadSeedModels(): Promise<EvermindSeedModel[]>;
    /** The teacher picker's model list + plan gate (managers only). */
    loadTeacherOptions(): Promise<EvermindTeacherOptions>;
    seedFromModel(slug: string): Promise<void>;
    setInference(enabled: boolean): Promise<void>;
    setMode(mode: EvermindMode): Promise<void>;
    setTeacher(model: string | null): Promise<void>;
    /** Teach from raw text (a transcript / exemplar); `prompt` is the task it answered. */
    teach(text: string, prompt?: string): Promise<void>;
    /** Force a merge now; returns how many merged + the resulting version. */
    flush(): Promise<{
        merged: number;
        version: number;
    }>;
    /** Validate a candidate task: which learned memories would answer it (ranked). */
    validate(prompt: string): Promise<EvermindValidateResult>;
    /**
     * OPTIONAL — import a local builderforce-memory snapshot into this Evermind and
     * compact the absorbed facts to stubs. Only hosts with local filesystem access (the
     * VS Code editor) implement it; the web app leaves it undefined, so the console hides
     * the Import control there. Resolves to a {@link MemoryImportReport}, or `null` when
     * the user cancels the file picker.
     */
    importMemory?(): Promise<MemoryImportReport | null>;
}
/** Every visible string. Parametric ones are functions the host localizes. */
interface EvermindConsoleLabels {
    title: string;
    description: string;
    loading: string;
    managerOnlyHint: string;
    statusSeeded: (version: number) => string;
    statusUnseeded: string;
    evalDelta: (pct: string) => string;
    evalFlat: string;
    evalTooltip: (version: number, base: string, next: string, size: number) => string;
    pickModelLabel: string;
    noModels: string;
    notSetUp: string;
    enableCta: string;
    working: string;
    versionLabel: string;
    contributionsLabel: string;
    pendingLabel: string;
    lastLearnedLabel: string;
    neverLearned: string;
    formatWhen: (atMs: number) => string;
    inferenceLabel: string;
    inferenceHint: string;
    learningLabel: string;
    learningHint: string;
    on: string;
    off: string;
    connected: string;
    frozen: string;
    teacherLabel: string;
    teacherHint: string;
    teacherNone: string;
    teacherPaidOnly: string;
    /** Shown when a teacher IS pinned: explains teaching is now automatic. */
    teacherActiveHint: (model: string) => string;
    teachTitle: string;
    teachHint: string;
    teachPromptPlaceholder: string;
    teachTextPlaceholder: string;
    teachCta: string;
    teaching: string;
    taught: string;
    teachTeacherTitle: string;
    teachTeacherHint: (model: string) => string;
    teachTaskPlaceholder: string;
    teachTeacherCta: string;
    flushCta: string;
    flushing: string;
    flushedNone: string;
    flushedN: (merged: number, version: number) => string;
    importTitle: string;
    importHint: string;
    importCta: string;
    importing: string;
    /** Success: N facts absorbed into vX, M entries compacted to stubs, K bytes recovered. */
    importDone: (absorbed: number, version: number, compacted: number, savedKb: string) => string;
    /** The picked file had nothing learnable (all too short / already stubbed). */
    importNothing: string;
    validateCta: string;
    validating: string;
    validateHint: string;
    validateResultTitle: (prompt: string) => string;
    validateEmpty: string;
    validatePrimaryBadge: string;
    validateScore: (pct: number) => string;
    validateClear: string;
    /** Honest label for how the ranking was produced (semantic embedding vs lexical). */
    validateMethod: (method: 'embedding' | 'lexical') => string;
    inspectTitle: string;
    inspectEmpty: string;
    kindText: string;
    kindDelta: string;
    deltaEntry: string;
    versionTag: (version: number) => string;
    weightTag: (weight: number) => string;
    viewDetail: string;
    hideDetail: string;
    detailPromptLabel: string;
    detailTextLabel: string;
    refresh: string;
    errorGeneric: string;
}
/** English defaults — the VS Code webview seeds these; the web app overrides via next-intl. */
declare const DEFAULT_EVERMIND_LABELS: EvermindConsoleLabels;

/**
 * <EvermindConsole> — the per-project Evermind inspect-and-train surface, rendered
 * identically on the web app (embedded in the IDE agent panel) and in the VS Code
 * sidebar webview. Presentational + self-managing: it loads through the injected
 * {@link EvermindConsoleAdapter}, refreshes on a light poll, and drives the
 * manager-gated training controls (seed / inference / learning mode / teacher),
 * the "teach from a transcript" producer path, a "learn now" flush, and the
 * recent-contributions inspection list. Themed via cascading `--bf-*` CSS variables
 * so it reads natively in both light and dark, on the web and in the editor.
 *
 * All colours resolve through the injected host tokens; the write controls are
 * disabled (not hidden) when `canManage` is false, mirroring the web RoleGate.
 * See [[evermind-learning-architecture]].
 */

interface EvermindConsoleProps {
    adapter: EvermindConsoleAdapter;
    /** Whether the viewer can change settings (manager). Controls are disabled, not hidden. */
    canManage: boolean;
    /** i18n overrides; unspecified keys fall back to English defaults. */
    labels?: Partial<EvermindConsoleLabels>;
    /** Poll interval (ms) for the live pending/recent readout. 0 disables. Default 20s. */
    refreshMs?: number;
    /** Name of the project this console is scoped to. Shown in the header so the same
     *  panel on two surfaces (web tab vs VS Code sidebar) never looks like contradictory
     *  states for "the same project" when they are in fact different projects. */
    projectName?: string;
    /** Show the "Recently learned" list. Default true; a host that renders its own
     *  learnings surface (e.g. the web Studio's region-filterable panel) passes false. */
    showRecent?: boolean;
    /** Show the inline `↻` refresh button in the header. Default true. A host that
     *  drives refresh from its OWN chrome (e.g. the VS Code sidebar view's title bar)
     *  passes false and bumps {@link refreshSignal} instead, so the control lives in
     *  the one place that host expects it rather than duplicated inside the card. */
    showHeaderRefresh?: boolean;
    /** A monotonic counter a host bumps to trigger an in-place reload from OUTSIDE the
     *  console (e.g. a title-bar refresh action). Each new value re-fetches without the
     *  loading flash — the same reload the inline `↻` runs. Undefined/0 = no external refresh. */
    refreshSignal?: number;
    /** Called whenever a Validate runs (or is cleared, with null) — lets a host lift
     *  the recall result to a companion surface (e.g. highlight the matched memories
     *  on the web Studio's Knowledge Map). The console also renders the result inline. */
    onValidate?: (result: EvermindValidateResult | null) => void;
}
declare function EvermindConsole({ adapter, canManage, labels, refreshMs, projectName, showRecent, showHeaderRefresh, refreshSignal, onValidate }: EvermindConsoleProps): React__default.JSX.Element;

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
    /** `taskType` lets the host open a chat tied to the RIGHT ticket kind — an epic
     *  or gap links to its own kind rather than a generic task. */
    task?: {
        id: number;
        key?: string;
        title: string;
        taskType?: 'task' | 'epic' | 'gap';
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
    /** Work-item type of the assigned task — threaded into open/run actions so a
     *  chat opened from a person card links to the correct ticket kind. */
    taskType?: 'task' | 'epic' | 'gap';
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

export { type AgentOptionVM, type AskUserLabels, type AskUserOption, type AskUserPayload, Avatar, type AvatarProps, BrainTimeline, type BrainTimelineLabels, type BrainTimelineProps, type BuildTimelineInput, type ChatAgentVM, type ChatOptionVM, type ChatTicketsAdapter, type ChatTicketsLabels, ChatTicketsPanel, type ChatTicketsPanelProps, ConsolidateForkControl, type ConsolidateForkControlProps, type ConsolidateForkLabels, DEFAULT_ASK_USER_LABELS, DEFAULT_CHAT_TICKETS_LABELS, DEFAULT_CONSOLIDATE_FORK_LABELS, DEFAULT_EVERMIND_LABELS, DEFAULT_PROJECT360_LABELS, DEFAULT_PROJECT_LIST_LABELS, DEFAULT_TIMELINE_LABELS, EvermindConsole, type EvermindConsoleAdapter, type EvermindConsoleData, type EvermindConsoleLabels, type EvermindConsoleProps, type EvermindMode, type EvermindRecentEntry, type EvermindSeedModel, type EvermindTeacherOptions, HealthRing, type HealthRingProps, type HealthTier, type LineageVM, type LinkType, Markdown, type MarkdownLabels, type MarkdownProps, type MentionAutocomplete, type MentionLabels, ParticipantBadge, type PendingAskUser, PendingQuestionBanner, type Project360, type Project360Action, type Project360Dimension, type Project360Gap, type Project360Labels, type Project360Member, type Project360Pillar, Project360View, type Project360ViewProps, type ProjectListAction, type ProjectListBadge, type ProjectListGroup, type ProjectListItem, type ProjectListLabels, type ProjectListModel, type ProjectListTicketRef, type ProjectListTone, ProjectListView, type ProjectListViewProps, QuestionCard, RUNNABLE_KINDS, Sunburst, type SunburstProps, TICKET_KINDS, type TicketKind, type TicketLinkVM, type TicketOptionVM, type TimelineImage, type TimelineNode, type UseMentionAutocompleteOptions, askUserAnchorId, attachmentsOf, avatarColor, buildSettledTimeline, buildTimeline, formatDuration, formatPayload, healthRingColor, initialsOf, parseAskUser, selectPendingAskUser, serializeAskUser, streamingNode, stripAskUser, useChatParticipants, useMentionAutocomplete };
