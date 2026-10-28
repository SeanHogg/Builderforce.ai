import * as react from 'react';
import react__default, { ReactNode, HTMLAttributes, KeyboardEvent } from 'react';
import { BrainRunActivity, ChatErrorAction, ChatActivityLabels, BrainMessage, BrainTraceEvent, ModelIdentityContext, AskUserPayload, ModelFallbackChannel, ModelFallbackEvent, QueuedItem, LocalModelRow as LocalModelRow$1, InferenceMode, ModelChoiceLabels, ChatModelSelection, ChatModelOptions, LocalModelStore, Effort, DirectedRecipient, RecipientChoice, BrainPersonaChoice, BrainPersonaAgent, SavingsSourceKey, SpendSavingsSummary, ChatTicket, ChatDiagnosticsSources, ChatActivity, EvermindRecallItem, EvermindLearnTarget, ChatInputAttachment, ChatDiagnosticsPlanSnapshot, ChatMode, ContextUsage } from '@seanhogg/builderforce-brain-embedded';
export { AskUserMessageLike, AskUserOption, AskUserPayload, BUILDERFORCE_PRODUCT_NAME, ChatModelOptions, ChatModelSelection, DEFAULT_MODEL_IDENTITY, MODEL_CATEGORIES, ModelCategory, ModelChoiceLabels, ModelIdentityContext, ModelItem, PROJECT_EVERMIND_MODEL_PREFIX, PendingAskUser, QueuedItem, QueuedTurns, QueuedTurnsOptions, RoutedProduct, activeModelKey, askUserAnchorId, buildModelItems, byoVendorLabel, displayModelName, filterModelItems, isManagerRole, modelCategoryLabel, modelInUse, parseAskUser, perMillionUsd, premiumCostLabel, productForPlan, productModelName, revealsModelId, selectPendingAskUser, serializeAskUser, stripAskUser } from '@seanhogg/builderforce-brain-embedded';

/**
 * THE clipboard button of this package.
 *
 * The tool step's Command / Input / Output / preview panels wear it as a labelled
 * chip; a message wears it as an icon. One implementation, because two would drift
 * on the confirmation timing alone.
 *
 * Its label contract is deliberately NARROW — two strings, not the whole transcript
 * bundle — so any surface can mount it without owning a `BrainTimelineLabels`.
 */
interface CopyLabels {
    copy: string;
    copied: string;
}
declare function CopyButton({ text, labels, icon }: {
    text: string;
    labels: CopyLabels;
    icon?: boolean;
}): react.JSX.Element;

/**
 * ONE settled tool step in the transcript: what the agent ran, and what came back.
 *
 * Split out of `BrainTimeline.tsx` because it is its own thing with its own reason to
 * change — how a call is DISPLAYED — while the timeline's reason to change is how a
 * conversation is ORDERED. Every surface that mounts the transcript gets this
 * component, so a shell step reads the same in the web Brain panel, on the Canvas
 * dock and in the VS Code editor.
 *
 * The header is the row you skim: outcome, tool, and the concrete subject — the file,
 * the query, the command line — so a run's steps can be read without opening any of
 * them. A shell step then opens by default onto its terminal exchange, because "did
 * it actually run the tests, and what did they say" is the question a transcript
 * exists to answer, and a caret is a poor place to keep the answer.
 */
interface ToolStepLabels extends CopyLabels {
    /** Heading for the raw argument panel. */
    input: string;
    /** Heading for the result panel — and for a shell step's terminal output. */
    output: string;
    /** Heading for the change preview shown on an edit_file / write_file step. */
    preview: string;
    /** Shown in place of terminal output when a command printed nothing. */
    noOutput: string;
    /** Non-zero exit chip — must contain the literal `{code}` token. */
    exitCode: string;
}
/** The shape this component needs from a timeline tool node. */
interface ToolStepNode {
    label: string;
    args: unknown;
    result: unknown;
    isError: boolean;
    durationMs?: number;
}
declare function ToolStep({ node, labels }: {
    node: ToolStepNode;
    labels: ToolStepLabels;
}): react__default.JSX.Element;

/**
 * The in-flight step, animated.
 *
 * The timeline renders SETTLED steps: a tool appears once it has finished, with
 * its duration attached. That leaves the whole time a step is actually running
 * with nothing to show but a static "Thinking…" line — so a `search_code` that
 * takes 67 seconds and a wedged extension host look exactly alike, and the only
 * honest thing a user can conclude is that the product hung.
 *
 * This component is the missing half. It renders the CURRENT phase from
 * `BrainRunActivity` (published on entry by the run store, not on completion),
 * with three things a static label cannot carry:
 *
 *  1. **Motion** — a rotating ring, a travelling shimmer on the label, and an
 *     indeterminate progress bar. Motion is the signal; the words are the detail.
 *  2. **Subject** — WHICH tool, on WHAT file or query. "Reading
 *     LandingCanvasHero.module.css" is progress; "Thinking…" is not.
 *  3. **Elapsed** — a live counter, ticking here rather than in the parent, plus
 *     an explicit reassurance once a step passes {@link SLOW_AFTER_MS}. A user
 *     who can see 1m 07s and climbing knows the difference between slow and stuck.
 *
 * Self-contained by design: it owns its own timer, decides its own visibility
 * (returns null when nothing is in flight), and takes a narrow prop contract, so
 * it drops into the web panel, the VS Code webview or the canvas dock unchanged.
 * The `awaiting` phase deliberately does NOT animate — nothing is progressing
 * while the run waits on a human, and pretending otherwise is a lie in motion.
 */
/** Past this, a step gets an explicit "still working" reassurance. */
declare const SLOW_AFTER_MS = 12000;
interface LiveActivityLabels {
    /** Phase lines. `tool` / `awaiting` must contain `{tool}`. */
    starting: string;
    thinking: string;
    writing: string;
    /** The model is streaming a tool call's arguments — must contain `{tool}`. */
    composing: string;
    /** Appended to {@link composing} once bytes are known — must contain `{bytes}`. */
    composed: string;
    tool: string;
    awaiting: string;
    finishing: string;
    /** Appended when the step names a subject — must contain `{target}`. */
    on: string;
    /** Loop iteration chip — must contain `{step}`. */
    step: string;
    /** Shown once a step passes {@link SLOW_AFTER_MS} — must contain `{elapsed}`. */
    slow: string;
    /** Accessible name for the whole indicator. */
    ariaLabel: string;
}
declare const DEFAULT_LIVE_ACTIVITY_LABELS: LiveActivityLabels;
/** Elapsed, formatted for a live counter (0s → 59s → 1m 07s). */
declare function formatElapsed(ms: number): string;
interface LiveActivityProps {
    /** The in-flight step, or null when the run is idle. */
    activity: BrainRunActivity | null | undefined;
    /** True while the run is executing. A run can be running with no phase yet. */
    isRunning: boolean;
    labels?: Partial<LiveActivityLabels>;
}
declare function LiveActivityInner({ activity, isRunning, labels: partial }: LiveActivityProps): react__default.JSX.Element | null;
/**
 * Memoized: this component re-renders once a second on its own timer, and it sits
 * inside a transcript that re-renders on every streamed token. Without the memo the
 * two multiply.
 */
declare const LiveActivity: react__default.MemoExoticComponent<typeof LiveActivityInner>;

/**
 * The MODEL MOVES a run records — the transcript re-packed for the window of the model
 * about to serve it (`llm.handoff`, brain-embedded's window fit) and a local-first turn
 * that fell over from an on-device model (`llm.local_fallback`) — read from the step's
 * structured args into the line the transcript shows.
 *
 * The step's `result` is the diagnostics sentence (English, for triage and copied
 * reports); the reader's line is composed HERE from the facts, through the
 * `brain.timeline.modelMove*` catalog keys, so it reads in the viewer's language on
 * every surface. Model refs are language-neutral and shown as they are.
 *
 * Pure: no React.
 */
/** One model move, as the transcript renders it. */
type ModelMove = {
    kind: 'packed';
    from?: string;
    to: string;
    dropped: number;
    how: 'summarized' | 'recalled' | 'elided';
    tokens: number;
    fits: boolean;
} | {
    kind: 'verbatim';
    from?: string;
    to: string;
    tokens: number;
} | {
    kind: 'localFallback';
    from: string;
    to: string;
};
/** The catalog strings a model-move line is composed from (`brain.timeline.*`). */
interface ModelMoveLabels {
    /** Must contain `{models}`, `{dropped}`, `{how}` and `{tokens}`. */
    modelMovePacked: string;
    /** Must contain `{models}` and `{tokens}`. */
    modelMoveVerbatim: string;
    /** Appended when the packed transcript still exceeds the window. */
    modelMoveOverWindow: string;
    modelMoveHowSummarized: string;
    modelMoveHowRecalled: string;
    modelMoveHowElided: string;
    /** Must contain `{from}` and `{to}`. */
    modelMoveLocalFallback: string;
    /** Tooltip on a model-move line. */
    modelMoveHint: string;
}
declare const DEFAULT_MODEL_MOVE_LABELS: ModelMoveLabels;
/** The move a step records, or null when the step is not one (or its args are unreadable). */
declare function modelMoveOf(label: string, args: unknown): ModelMove | null;
/** The reader's line for a move, in the catalog's words. */
declare function modelMoveLine(move: ModelMove, labels: ModelMoveLabels): string;

/**
 * The chat's error banner — the message AND the fix.
 *
 * A turn that fails on an entitlement ("…require a validated card on file. Add
 * and validate a card in Settings ▸ Billing to unlock.") is only actionable if
 * the surface takes the user there. The verdict is decided ONCE, server-side,
 * and carried through the run store as {@link ChatErrorAction} — so this
 * component reads a verdict rather than pattern-matching error prose, and the
 * button can never contradict the sentence above it.
 *
 * Shared because both chat surfaces hit the same wall: the VS Code webview and
 * the web app's <BrainPanel> render the same failures from the same hook, and a
 * user who upgrades from one and returns to the other should not find a
 * different (or missing) remedy.
 *
 * Self-gating: renders nothing without an error, and decides its own actions from
 * the verdict — the host passes handlers, never a `canX` flag.
 */
interface ChatErrorBannerLabels {
    /** Re-exchange an expired session token. */
    reconnect: string;
    /** Upgrade CTA when the server named no specific plan. */
    upgrade: string;
    /** Upgrade CTA naming the plan — must contain the literal `{plan}` token. */
    upgradeToPlan: string;
    /** Billing CTA when the plan is fine but no validated card is on file. */
    addCard: string;
    /** Sign in — offered when no model can serve the turn (signed out, nothing local). */
    signIn: string;
    /** What the banner says for that case — replaces the raw `not_signed_in` code. */
    noModel: string;
    /** What the banner says when nothing on this device can serve and the gateway is not
     *  an option (Local only, or signed in with no cloud route) — replaces `no_local_model`. */
    noLocalModel: string;
    /** Move this person onto Hybrid (local first, then the cloud). */
    switchToHybrid: string;
    /** Open where a model for this device is downloaded. */
    downloadLocalModel: string;
    /** What the banner says when the person runs Specific model with nothing picked —
     *  replaces `no_specific_model`. */
    noSpecificModel: string;
    /** Open the composer's Model tab, where a model is picked. */
    pickModel: string;
    /** The on-device engine crashed (a wasm trap) — replaces `bfi_engine_crashed`. */
    engineCrashed: string;
    /** The engine serving the model went away mid-answer — replaces `page_engine_detached`. */
    engineDetached: string;
    /** The model trapped repeatedly and is refused this session — replaces `model_keeps_crashing`. */
    modelKeepsCrashing: string;
    /** Open where on-device models are managed (removed) — offered beside "Pick a model"
     *  for a model that keeps crashing. */
    manageLocalModels: string;
    /** `platform_refused` where only the mode opens it (Local only holds the cloud, or the
     *  queue that carries the run's writes) — replaces `platform_*_disabled`. */
    platformRefusedMode: string;
    /** `platform_refused` by the account-sync switch — replaces `platform_synchronize_disabled`. */
    platformRefusedSync: string;
    /** `platform_refused` by another advanced platform switch (model downloads, direct
     *  providers, external MCP, git remotes). */
    platformRefusedSetting: string;
    dismiss: string;
}
declare const DEFAULT_CHAT_ERROR_LABELS: ChatErrorBannerLabels;
interface ChatErrorBannerProps {
    /** The message to show. Falsy ⇒ the banner renders nothing. */
    error: string;
    /** The server-decided remedy, from `useBrainConversation().errorAction`. */
    action: ChatErrorAction | null;
    onDismiss: () => void;
    /**
     * Re-authenticate. Omit on a surface with no in-place reconnect (the web app
     * redirects to login instead) — the button then isn't offered.
     */
    onReconnect?: () => void;
    /**
     * Send the user somewhere they can raise their plan. Omit to suppress the
     * button (e.g. a logged-out surface that owns its own sign-up upsell).
     */
    onUpgrade?: () => void;
    /** Send the user somewhere they can put a validated card on file. */
    onValidateCard?: () => void;
    /** Sign in (or open where a local model is started) — for the `sign_in` verdict. */
    onSignIn?: () => void;
    /** For the `no_local_model` verdict: move onto Hybrid. Omit when the person already
     *  runs Hybrid (the cloud route is out for another reason) — the button then isn't offered. */
    onSwitchToHybrid?: () => void;
    /** For the `no_local_model` verdict: open where a local model is downloaded. Also the
     *  "Manage on-device models" remedy for a model that keeps crashing (it is removed there). */
    onDownloadLocalModel?: () => void;
    /** For the `no_specific_model` verdict: open the composer's Model tab (the one that
     *  raised it), where a model is picked or the mode changed. Also "try another model"
     *  for a model that keeps crashing. */
    onPickModel?: () => void;
    labels?: Partial<ChatErrorBannerLabels>;
    /** Extra styles merged into the banner container, for host-specific chrome. */
    style?: react__default.CSSProperties;
    /** Class on the banner container — the VS Code webview styles via its own CSS. */
    className?: string;
    /**
     * `alert` (default) for a failed turn. `status` for a passive notice the run still
     * finished through — a connected account it could not use, a provider key at its cap —
     * which a screen reader should announce politely rather than interrupt with.
     */
    role?: 'alert' | 'status';
}
declare function ChatErrorBanner({ error, action, onDismiss, onReconnect, onUpgrade, onValidateCard, onSignIn, onSwitchToHybrid, onDownloadLocalModel, onPickModel, labels: labelOverrides, style, className, role, }: ChatErrorBannerProps): react__default.JSX.Element | null;

/**
 * Every string the transcript renders. It EXTENDS {@link ToolStepLabels} rather than
 * restating those five: the tool step is its own component with its own narrow
 * contract, and a host that passes this bundle satisfies that contract by
 * construction — which is what keeps the two from drifting apart.
 */
interface BrainTimelineLabels extends ToolStepLabels, ModelMoveLabels {
    /** Shown on the live thinking node while a turn streams. */
    thinking: string;
    /**
     * Copy for the ANIMATED in-flight indicator (<LiveActivity>) — which tool is
     * running, on what, and for how long. Carried in this bundle so a host passes
     * ONE set of labels for the whole transcript rather than two.
     */
    live: LiveActivityLabels;
    /** "Thought for {duration}" — must contain the literal `{duration}` token. */
    thoughtFor: string;
    /** Summary of a collapsed `<think>` block inside a reply. */
    thought: string;
    /** Muted note above a reply RESCUED from the model's reasoning — the run ended
     *  inside its `<think>` block, so the transcript shows the reasoning as the reply
     *  rather than a collapsed line and nothing else. See `strandedReplyKey`. */
    replyFromThought: string;
    /** Muted note above a reply the user STOPPED mid-stream — what the model had written
     *  when Stop was pressed, kept so the reader can see what went wrong and (from the
     *  provenance chip) which model did it. See `stoppedTurn.ts` in brain-embedded. */
    stoppedReply: string;
    you: string;
    assistant: string;
    /** Beside a SUB-AGENT's name: whose it is — must contain `{owner}`. */
    subagentOf: string;
    /** Beside the chat's own agent once sub-agents have spoken: it is their owner. */
    ownerTag: string;
    error: string;
    loading: string;
    empty: string;
    /** Per-message "send this again" action — re-asks the model with the same text,
     *  from a user turn or an assistant one. */
    replay: string;
    /** Thumbs up / down on an assistant reply. */
    rateUp: string;
    rateDown: string;
    apply: string;
    createFile: string;
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
    /** Memory-first answer step: a saved reply was replayed and no model ran. */
    memoryAnswerCache: string;
    /** Memory-first answer step: the project's Evermind replied and no other model ran.
     *  Must contain `{version}`. */
    memoryAnswerEvermind: string;
    /** Tooltip on the memory-first answer step. */
    memoryAnswerHint: string;
    /** Deterministic answer step: "where is X defined?" answered from the workspace symbol
     *  index and no model ran. */
    memoryAnswerSymbols: string;
    /** Tooltip on the symbol-index answer step. */
    memoryAnswerSymbolsHint: string;
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
    /** Auto-compaction step — the run folded older steps into a memory note to stay
     *  within the context window. Must contain `{count}`. */
    contextCompacted: string;
    /** Tooltip on the auto-compaction step. */
    contextCompactedHint: string;
    /** The button above a long transcript that renders the next page of older steps.
     *  Must contain `{count}`. */
    showEarlier: string;
    /** Below a window moved back in time: render the next page of newer steps. `{count}`. */
    showNewer: string;
    /** …or go straight back to the newest page. */
    jumpToLatest: string;
    /**
     * RUN-ACTIVITY line templates (run milestones + agent dispatch). Templates, not
     * sentences: the server records only the FACTS, and each surface composes the line in
     * its own language — which is the only way these can be localized at all, since the
     * server has no idea who will read the chat. See `chatActivity.ts` for the contract.
     */
    activity: ChatActivityLabels;
    /**
     * The error step row's sentences — the SAME bundle (and the same `chatErrorMessage`)
     * the chat's error banner reads, so a refused turn reads identically in the banner and
     * in the transcript, never as its raw code (`platform_send_disabled`). Catalog keys
     * `chatError.<field>`; omitted ⇒ the banner's English defaults.
     */
    chatError?: Partial<ChatErrorBannerLabels>;
}
declare const DEFAULT_TIMELINE_LABELS: BrainTimelineLabels;

/** +1 up, -1 down, 0 = cleared. Mirrors the `llm_action_ratings.rating` domain. */
type MessageRating = 1 | -1 | 0;

interface BrainTimelineProps {
    messages: BrainMessage[];
    trace: BrainTraceEvent[];
    streamingText: string;
    isRunning: boolean;
    /**
     * What the run is doing RIGHT NOW, from the run store's snapshot. Drives the
     * animated in-flight row. Omitted ⇒ the row still animates off `isRunning`
     * alone, it just cannot name the step — so an older host degrades rather than
     * regressing to the static line this replaced.
     */
    activity?: BrainRunActivity | null;
    loading?: boolean;
    labels?: Partial<BrainTimelineLabels>;
    /** Who is reading — decides whether a reply's provenance chip may name the upstream
     *  model or shows the routing product instead. Omitted ⇒ masked (fail closed). */
    modelIdentity?: ModelIdentityContext;
    /** Override the assistant display name (defaults to labels.assistant). */
    assistantName?: string;
    /** Replaces the built-in empty state entirely. */
    emptyState?: react__default.ReactNode;
    /** Render a message's text. Defaults to the shared <Markdown>. The web app
     *  passes its richer ChatMessageBubble here so no feature is lost. */
    renderMessage?: (msg: BrainMessage, ctx: {
        role: 'user' | 'assistant';
        text: string;
    }) => react__default.ReactNode;
    /** Render the live streaming assistant bubble. Defaults to <Markdown>. */
    renderStreaming?: (text: string) => react__default.ReactNode;
    /** Host-specific EXTRAS on an assistant message (feedback, export, suggestions).
     *  Copy and "send again" are built in — see {@link MessageActions} — so a host never
     *  re-implements them. */
    renderAssistantActions?: (msg: BrainMessage) => react__default.ReactNode;
    /** Re-send a message's text as the next turn. When omitted the "send again" action
     *  hides itself, so a read-only transcript offers only copy. */
    onReplayMessage?: (msg: BrainMessage, role: 'user' | 'assistant') => void;
    /**
     * Rate an assistant reply. Wiring it renders the thumbs; omitting it hides them,
     * so a read-only transcript (or a surface with no signed-in rater) offers none.
     * The host is responsible for filing the rating against the model that served the
     * turn — see `llm_action_ratings` / `POST /api/llm/ratings`.
     */
    onRateMessage?: (msg: BrainMessage, rating: MessageRating) => void;
    /** The rating THIS viewer has already given, keyed by message id. */
    ratings?: Record<number, 1 | -1>;
    onInternalLink?: (href: string) => void;
    onApplyCode?: (code: string) => void;
    onCreateFile?: (path: string, content: string) => void;
    /** Post the user's answer to an agent's `ask_user` question as their next turn.
     *  When set, an assistant message carrying an ask-user block renders a clickable
     *  <QuestionCard>; without it the block degrades to plain text. */
    onAnswerQuestion?: (answer: string) => void;
    /** Auto-scroll to the newest node while near the bottom (default true). */
    autoScroll?: boolean;
    /**
     * Scroll this transcript message into view and highlight it. The nonce lets a host
     * ask again for the same id (clicking the same speech bubble twice) without the
     * jump no-op'ing. Absent or null ⇒ no jump, no highlight.
     */
    revealMessage?: {
        id: number;
        nonce: number;
    } | null;
    /**
     * Which conversation this is (its chat id). The render window belongs to ONE
     * conversation: another one opens on its newest page. Omitted ⇒ the first node's key
     * stands in, which a host whose message list is a moving tail should not rely on.
     */
    conversationKey?: string | number | null;
}
/**
 * The unified Brain chat transcript: a vertical lineage of gutter dots (joined by
 * a connecting line) where each step is one node — a user turn (with image
 * bubbles), a "thinking" marker, an assistant reply, a collapsible tool call with
 * Input/Output, or an error. Presentational and theme-driven (CSS variables), so
 * it renders identically in the web app and a VS Code webview.
 */
declare function BrainTimelineInner({ messages, trace, streamingText, isRunning, activity, loading, labels: labelOverrides, modelIdentity, assistantName, emptyState, renderMessage, renderStreaming, renderAssistantActions, onReplayMessage, onRateMessage, ratings, onInternalLink, onApplyCode, onCreateFile, onAnswerQuestion, autoScroll, revealMessage, conversationKey, }: BrainTimelineProps): react__default.JSX.Element;
/**
 * Memoized so an unrelated re-render of the host (e.g. every keystroke in the
 * composer, which lives in the same component tree) does not re-render the whole
 * transcript and re-parse every message's markdown. Callers must pass referentially
 * stable props (memoize `labels` and any `on*` callbacks) for this to take effect.
 */
declare const BrainTimeline: react__default.MemoExoticComponent<typeof BrainTimelineInner>;

/** Figures a parameterised label is rendered with. */
type LabelValues = Readonly<Record<string, string | number>>;
/** A host's string for a canonical label key, or undefined when its catalog has none. */
type LabelLookup = (key: string, values?: LabelValues) => string | undefined;
/**
 * Every string field of `defaults`, read at `prefix + field`. Functions and nested
 * objects are carried over untouched; an empty string counts as "none".
 */
declare function stringsFrom<T extends object>(defaults: T, lookup: LabelLookup, prefix?: string): T;
/**
 * A lookup over a FLAT host bundle (`key → text`, `{name}` placeholders) — the shape the
 * VS Code extension posts. `keyOf` maps a canonical key to the bundle's key (return
 * undefined to leave it to the default); `format` renders a numeric figure for the
 * host's locale before it is substituted.
 */
declare function bundleLookup(bundle: Readonly<Record<string, string>>, keyOf: (key: string) => string | undefined, format?: (value: number) => string): LabelLookup;

/**
 * The ONE reading of the transcript's copy catalog into `<BrainTimeline>`'s label shape.
 *
 * Every host keeps the transcript's strings in its own catalog — the web app in
 * `brain.timeline` (next-intl), the VS Code webview in its `tl.*` l10n bundle, the Chrome
 * extension in the web catalog bundled per locale — and each used to hand-map ~50 keys
 * onto {@link BrainTimelineLabels}. Three copies of one table drift; this is the table.
 *
 * A host passes a LOOKUP over the canonical key paths (the `brain.timeline` names:
 * `thinking`, `live.starting`, `activityStarted`, `learnSkipReasonFrozen`, …) and gets
 * every label, each falling back to the package's English default when its catalog has
 * no string for it. Placeholders (`{duration}`, `{tool}`, `{agent}` …) are the renderer's
 * own tokens, so a catalog string is used exactly as written.
 *
 * Pure: no React, no i18n library. A host memoizes the result (the transcript is
 * `React.memo`'d on its label object).
 */

/** A string for a canonical key path, or undefined when the catalog has none — the
 *  package-wide {@link LabelLookup} contract, read by key path. */
type TimelineCatalogLookup = LabelLookup;
/** A lookup over a nested catalog object (`messages.brain.timeline`). */
declare function timelineCatalogLookup(namespace: unknown): TimelineCatalogLookup;
/** The animated in-flight row's copy (`live.*`). */
declare function liveActivityLabelsFrom(lookup: TimelineCatalogLookup, overrides?: Partial<LiveActivityLabels>): LiveActivityLabels;
/** Run-milestone / agent-dispatch activity templates (`activity*`). */
declare function chatActivityLabelsFrom(lookup: TimelineCatalogLookup): BrainTimelineLabels['activity'];
/** The whole transcript's copy. `overrides` is for copy a surface words on purpose. */
declare function timelineLabelsFrom(lookup: TimelineCatalogLookup, overrides?: Partial<BrainTimelineLabels>): BrainTimelineLabels;

/**
 * How ONE tool step presents itself — pure, framework-free, and shared by every
 * surface that mounts the transcript (the web Brain panel, the Canvas dock, the
 * VS Code webview).
 *
 * The transcript used to render every step the same way: the tool's name, then its
 * arguments as raw JSON and its result as raw JSON, both folded away behind a caret.
 * For a SHELL step that is the least readable form of the two things a reader
 * actually wants — the command that ran, and what it printed. `{"command":"pnpm -w
 * test"}` above `{"ok":true,"exitCode":0,"stdout":"…"}` is a transcript of the
 * transport, not of the work; every other agent chat shows the command and its
 * terminal output, because that is what you check when you want to know whether the
 * agent really ran the build.
 *
 * So a command-shaped call gets a {@link CommandRun}: the command on its own line and
 * the combined stdout/stderr as terminal text, with the exit code called out when it
 * is non-zero. Detection is STRUCTURAL (an argument named `command`, a result shaped
 * like a shell result) rather than a list of tool names, so it covers `run_command`,
 * a gateway MCP shell tool and any future one without an allow-list to maintain.
 *
 * Nothing is ever hidden to achieve this: the raw argument JSON is still rendered for
 * whatever the command line did not already show, and the raw result JSON is dropped
 * ONLY when every field in it is one the terminal panel already displays.
 */
/** A change an edit_file / write_file call carries in its own arguments. */
type ToolPreview = {
    kind: 'edit';
    path: string;
    oldText: string;
    newText: string;
} | {
    kind: 'write';
    path: string;
    content: string;
};
/** A shell step, presented as a terminal exchange rather than as two JSON blobs. */
interface CommandRun {
    /** The command line that ran. */
    command: string;
    /** Combined stdout/stderr (plus any error text), trailing blank lines trimmed. */
    output: string;
    /** The process exit code when the result reported one. */
    exitCode: number | null;
    /** Whether the call succeeded, from the result's own `ok`, else from the exit code. */
    ok: boolean;
    /** True when {@link output} already carries everything the raw result JSON would —
     *  the only case in which it is safe to stop rendering that JSON as well. */
    outputComplete: boolean;
}
/** Everything a tool step renders, decided once so the renderer only lays it out. */
interface ToolStepView {
    /** The concrete thing the call was about, for the collapsed header line. */
    subject: string | null;
    /** The subject is one file path, so a narrow header must elide its START: the basename
     *  is what tells `src/pages/Home.jsx` from `src/pages/Home.css`, and an end ellipsis
     *  rendered both as `src/pages/Home…` — two different reads that looked like a
     *  duplicate call (session `local-148925cf`). */
    subjectIsPath: boolean;
    command: CommandRun | null;
    preview: ToolPreview | null;
    /** Raw argument JSON, minus anything the command line already shows. `''` = omit. */
    argsText: string;
    /** Raw result JSON. `''` = the terminal panel already shows all of it. */
    resultText: string;
    /** Whether the step opens expanded: a command and a failure both exist to be read. */
    defaultOpen: boolean;
}
/**
 * The shell command a call ran, or null when it isn't a command-shaped call. Detected
 * from the ARGUMENTS, so it holds for any tool that takes a command line.
 */
declare function commandOf(args: unknown): string | null;
/**
 * Read a shell result into the terminal half of a {@link CommandRun}. A result that is
 * a bare string is taken as its output verbatim — that IS the whole result.
 */
declare function shellOutcomeOf(result: unknown): Omit<CommandRun, 'command'>;
/** An edit_file / write_file tool call carries the change itself in its args, so we
 *  can render a readable preview (a before/after diff for edits, the new content for
 *  writes) instead of only the raw JSON — detected structurally so it works regardless
 *  of the tool's display label. */
declare function toolPreview(args: unknown): ToolPreview | null;
/** Decide how one tool step presents itself. */
declare function toolStepView({ args, result, isError }: {
    args: unknown;
    result: unknown;
    isError: boolean;
}): ToolStepView;

interface MarkdownLabels {
    copy: string;
    copied: string;
    apply: string;
    createFile: string;
    /** Summary of a collapsed `<think>` block. */
    thought: string;
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
declare function MarkdownInner({ content, onInternalLink, onApplyCode, onCreateFile, labels }: MarkdownProps): react__default.JSX.Element;
/**
 * Memoized: parsing markdown through the remark pipeline is expensive, and the
 * transcript re-renders on every streaming token / composer keystroke. Skipping the
 * re-parse of settled messages (unchanged `content`/callbacks) keeps typing snappy.
 */
declare const Markdown: react__default.MemoExoticComponent<typeof MarkdownInner>;

/**
 * THE inline chat title — a chat's own name, edited where it is shown.
 *
 * Every AI surface names the open chat in its header, and until now the only way to
 * change that name was a Rename button on a chat-history row: you had to leave the
 * conversation, find the right row, open its actions, and type into a field there.
 * This is the same edit without the detour — click the title, and it becomes a text
 * field in place; Enter saves, Escape puts it back.
 *
 * THE RULES, and why each exists:
 *
 * - it renders as a BUTTON, not a form control, so the header looks exactly as it did
 *   until you ask for the field. A permanent input in a header reads as an unfinished
 *   control on all three surfaces.
 * - click (or Enter/Space on the button — it is a real `<button>`) swaps to an input,
 *   focused with its text SELECTED, so typing replaces the title rather than appending.
 * - Enter commits, Escape reverts, blur commits — but ONLY a non-blank value. A blank
 *   title is never saved: it is how a chat ends up unnamed, and the save path
 *   (`useBrainChats.rename`) guards it too.
 * - the session commits AT MOST ONCE. Enter unmounts the field, and its blur would
 *   otherwise fire and commit the same value a second time; `settled` is the same
 *   guard the shared history row uses (`useChatRowActions`).
 * - a successful commit shows the new title immediately, before the host's chat list
 *   has re-read it, so the header never flickers back to the old name.
 * - with no chat yet there is nothing to rename, and the affordance is not rendered at
 *   all — a "New chat" placeholder must not invite an edit that cannot be saved.
 *
 * The draft lives in local state, so a parent re-render (a streaming turn, a chat list
 * refresh) does not wipe what someone is in the middle of typing.
 */
interface InlineChatTitleLabels {
    /** The un-edited title's accessible name — "Edit title", plus the current title. */
    edit: string;
    /** The field's accessible name. */
    label: string;
    /** Announced when the edit is committed / reverted (a polite status). */
    save: string;
    /** Announced as the accessible name of the revert affordance. */
    cancel: string;
}
declare const DEFAULT_INLINE_CHAT_TITLE_LABELS: InlineChatTitleLabels;
interface InlineChatTitleProps {
    /** The chat's current title, or the host's placeholder when there is no chat yet. */
    title: string;
    /** The chat being named — `null` while there is none, which renders no affordance. */
    chatId?: number | null;
    /** Persist the new title. Called at most once per edit, and never for a blank value. */
    onRename?: (id: number, title: string) => Promise<unknown> | void;
    /** The host's copy — never hardcoded English at a call site. */
    labels?: Partial<InlineChatTitleLabels>;
    /** Extra class on the wrapper (a host's own layout hook). */
    className?: string;
    /** The committed title as the button shows it — a host with longer/wrapping chrome. */
    titleClassName?: string;
}
declare function InlineChatTitle({ title, chatId, onRename, labels: overrides, className, titleClassName, }: InlineChatTitleProps): react.JSX.Element;

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
    /** <PendingQuestionBanner> close button's accessible name. */
    askDismiss: string;
}
declare const DEFAULT_ASK_USER_LABELS: AskUserLabels;
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
}): react.JSX.Element;
/**
 * The open question, pinned at the composer. A long transcript buries the agent's
 * `ask_user` card, so a chat that is BLOCKED on an answer looks merely idle — this
 * restates the live question where the user is already typing, and answers it through
 * the very same <QuestionCard> (no second options UI to drift), so one click unblocks
 * the run. `onReveal` scrolls the original card into view for the surrounding context.
 *
 * It closes itself once answered — and on its × — rather than waiting for the user's
 * turn to come back through the transcript: the answer may be queued behind a run that
 * is still settling, and a banner restating a question already answered reads as the
 * click having failed (chat #133). The card in the transcript stays; dismissing only
 * unpins it. Hosts key it by the question's message id so the NEXT question opens a
 * fresh banner.
 *
 * Pair with {@link selectPendingAskUser}; render nothing when it returns null.
 */
declare function PendingQuestionBanner({ payload, labels, onAnswer, onReveal, }: {
    payload: AskUserPayload;
    labels?: Partial<AskUserLabels>;
    onAnswer: (answer: string) => void;
    onReveal?: () => void;
}): react.JSX.Element | null;

/**
 * THE sentence a failed turn is shown with — ONE derivation for every place a failure is
 * read: the chat's error banner (`ChatErrorBanner`) and the transcript's error step row
 * (`timeline/StepRows` `ErrorRow`), on every host that renders them (web, canvas, the VS
 * Code webview, Rovr). The verdict (`chatErrorAction`) names the case; a verdict with a
 * sentence of its own replaces the raw sentinel (`no_local_model`, `bfi_engine_crashed`,
 * `platform_send_disabled`, …); anything else keeps the server's own words.
 */

declare function chatErrorMessage(error: string, action: ChatErrorAction | null, labels: ChatErrorBannerLabels): string;

interface ModelFallbackNoticeLabels {
    /** The line — must contain the literal `{model}` token. */
    fallback: string;
    dismiss: string;
}
declare const DEFAULT_MODEL_FALLBACK_LABELS: ModelFallbackNoticeLabels;
/** The channel's latest undismissed fallback, re-rendering on each report / dismiss. */
declare function useModelFallback(channel: ModelFallbackChannel | null | undefined): ModelFallbackEvent | null;
interface ModelFallbackNoticeProps {
    channel: ModelFallbackChannel | null | undefined;
    labels?: Partial<ModelFallbackNoticeLabels>;
    className?: string;
}
declare function ModelFallbackNotice({ channel, labels: partial, className }: ModelFallbackNoticeProps): react.JSX.Element | null;

/**
 * The human-in-the-loop approval — ONE bar for every surface that pauses a run on a
 * mutating tool call (`BrainRunSnapshot.pendingConfirm`): the web Brain panel, the VS
 * Code chat and its sub-agent strip, and Rovr's side panel. Extracted from the web's
 * BrainToolConfirmBar; it carries what the other copies had and it lacked:
 *
 * - the exact command line for `run_command` (VS Code), so the person approves what
 *   actually runs, not just the tool name;
 * - an optional "always" lever (`onApproveAll`) — omitted ⇒ not offered;
 * - a `children` slot for a host's own WHY and WHAT (Rovr's safety reasons, the element
 *   it would act on, a masked sensitive value) — given ⇒ the raw-args preview stands down;
 * - focus on Approve when it appears (keyboard-first, as Rovr had it).
 *
 * Presentational and theme-driven (`--bf-*`); a host passes handlers and copy, never a
 * `canX` flag.
 */
interface ToolConfirmBarLabels {
    /** The question — must contain `{name}`, replaced by the tool name in `<code>`. */
    prompt: string;
    approve: string;
    /** The "always" lever's label (approve this and stop asking). */
    approveAll: string;
    /** Tooltip for the "always" lever. */
    approveAllTitle?: string;
    deny: string;
    /** Accessible name of the bar. */
    aria: string;
}
declare const DEFAULT_TOOL_CONFIRM_LABELS: ToolConfirmBarLabels;
/** THE confirm bar's copy from a host catalog (canonical keys = the field names). */
declare function toolConfirmLabelsFrom(lookup: LabelLookup): ToolConfirmBarLabels;
interface ToolConfirmBarProps {
    req: {
        name: string;
        args: unknown;
    };
    onApprove: () => void;
    onDeny: () => void;
    /** Approve and stop asking. Omit and the lever is not offered. */
    onApproveAll?: () => void;
    /** Replaces the `prompt` sentence (a host whose question is richer than "Run X?"). */
    title?: ReactNode;
    /** A host's own detail rows. Given ⇒ the generic args preview is not shown. */
    children?: ReactNode;
    labels?: Partial<ToolConfirmBarLabels>;
    className?: string;
}
/** What the person is approving, in one line: the command for a shell call, else the args. */
declare function toolConfirmPreview(req: {
    name: string;
    args: unknown;
}): {
    command: string | null;
    args: string;
};
declare const ToolConfirmBar: react.MemoExoticComponent<({ req, onApprove, onDeny, onApproveAll, title, children, labels: labelOverrides, className, }: ToolConfirmBarProps) => react.JSX.Element>;

/**
 * THE Brain mark — one glyph, one working animation, every surface (web canvas, Brain
 * panel, Studio, the floating launcher, VS Code, Rovr). Moved here from the web app so
 * the editor and the browser panel wear the same identity instead of their own.
 *
 * The glyph is the BuilderForce logo (`brandLogo.ts`) — the product's own mark, not a
 * generic icon. It owns the PROCESSING signal: a ring breathing out of the mark plus a
 * gentle pulse of the glyph. That is a shape, not words — the live activity row narrates
 * the phase. The ring takes the host's accent (`currentColor`).
 * Styles: `.bf-mark*` in styles.css (reduced motion holds the ring steady).
 */
interface BrainMarkProps {
    /** A turn is in flight: the mark breathes and a ring pulses out of it. */
    running?: boolean;
    /** Glyph size — any CSS length. Defaults to `1em` so it inherits its host's type. */
    size?: number | string;
}
declare function BrainMark({ running, size }: BrainMarkProps): react.JSX.Element;

/**
 * The ONE header every AI surface wears — extracted from the web Brain panel's docked
 * header and now also the canvas dock, the canvas Chat lens, the VS Code chat and Rovr.
 *
 * One row that never wraps: the mark (breathing while a turn runs) and the name, then
 * the host's context (the only part that shrinks — its chips ellipsize), presence, the
 * host's own actions, then the standard levers — History, New chat, Expand, Close —
 * each offered only when the host supplies its handler or slot (no `canX` flags).
 *
 * Presentational and theme-driven (`--bf-*`, `.bf-shead*` in styles.css).
 */
interface SurfaceHeaderLabels {
    historyShow: string;
    historyHide: string;
    newChat: string;
    close: string;
}
declare const DEFAULT_SURFACE_HEADER_LABELS: SurfaceHeaderLabels;
interface SurfaceHeaderHistory {
    open: boolean;
    onToggle: () => void;
    /** Unread messages in OTHER chats — badged on the History lever. */
    unread?: number;
    /** id of the element the lever shows/hides. Referenced only while open — the list is
     *  not in the DOM while closed, and aria-controls must not point at a missing id. */
    controls?: string;
}
interface SurfaceHeaderProps {
    /** The agent's name as this surface calls it (Brain, BuilderForce, Rovr). */
    title: ReactNode;
    /** A turn is in flight — the mark breathes. */
    running?: boolean;
    /** What the agent is working with (chips, a chat picker) — the part that shrinks. */
    context?: ReactNode;
    /** Who else is here (avatars). */
    presence?: ReactNode;
    /** The host's own icon actions, before the standard levers. */
    actions?: ReactNode;
    history?: SurfaceHeaderHistory;
    onNewChat?: () => void;
    /** The expand lever — a host link to its full page (a router link stays the host's). */
    expand?: ReactNode;
    onClose?: () => void;
    labels?: Partial<SurfaceHeaderLabels>;
    className?: string;
}
declare function SurfaceHeader({ title, running, context, presence, actions, history, onNewChat, expand, onClose, labels: overrides, className, }: SurfaceHeaderProps): react.JSX.Element;
/** A header lever's glyph — stroke icons sized off the button, colour inherited. */
declare function HeaderIcon({ d }: {
    d: string;
}): react.JSX.Element;
/** The expand glyph, for a host's `expand` link. */
declare const EXPAND_ICON_PATH = "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7";

/**
 * The ONE way back into a closed AI surface — extracted from the app-wide floating
 * launcher and now also the canvas's edge pill. It wears the header's mark (breathing
 * while a turn runs), an optional visible label (the pill form), and one count badge:
 * `awaiting` (a person must answer — pulses) outranks `unread` (informational).
 *
 * Placement is the host's (`className`): a fixed corner FAB, or an edge pill on the board.
 */
interface SurfaceLauncherBadge {
    count: number;
    tone: 'awaiting' | 'unread';
    /** Accessible sentence for the count ("2 runs need you"). */
    label: string;
}
interface SurfaceLauncherProps {
    onOpen: () => void;
    /** Accessible name / tooltip — what opening does, or what is happening. */
    label: string;
    running?: boolean;
    /** Visible text beside the mark (the pill form); omitted ⇒ icon-only. */
    text?: ReactNode;
    badge?: SurfaceLauncherBadge | null;
    /** Mark size (any CSS length). */
    markSize?: number | string;
    className?: string;
    /** Extra attributes a host's tests and styles key on (data-side, data-testid…). */
    dataAttrs?: Record<`data-${string}`, string>;
}
declare function SurfaceLauncher({ onOpen, label, running, text, badge, markSize, className, dataAttrs }: SurfaceLauncherProps): react.JSX.Element;

interface SurfaceTab {
    /** Stable id — also the state key the console persists selection under. */
    id: string;
    label: string;
    /** Optional count/marker shown on the tab (e.g. "2" findings, "!" refused). */
    badge?: string;
    /** How the badge reads: a problem, or neutral information. */
    badgeTone?: 'bad' | 'info';
    content: ReactNode;
}
interface SurfaceTabsProps {
    tabs: SurfaceTab[];
    activeId: string;
    onSelect: (id: string) => void;
    /** Accessible name for the strip (localized by the host). */
    label: string;
    /** Namespace for the generated ids, so two consoles on one page never collide. */
    idPrefix: string;
    /** Host classes — a side panel makes the strip + panel fill its height. */
    className?: string;
    panelClassName?: string;
}
declare function SurfaceTabs({ tabs, activeId, onSelect, label, idPrefix, className, panelClassName }: SurfaceTabsProps): react.JSX.Element;

/**
 * <AiSurface> — the ONE body every AI modality mounts (the web Brain panel and Studio
 * column, the canvas Chat lens and board dock, the guest drawer, the VS Code panel, the
 * Rovr side panel). Extracted from the web panel's conversation column
 * (`BrainConversation`), whose order is the design's anatomy:
 *
 *   header · rail · thread (or the empty state) · notices · footer
 *
 * It owns ORDER and the column's flex contract, nothing else — each slot is the shared
 * part (`SurfaceHeader`, `ChatTicketsPanel`, `BrainTimeline` / `SurfaceEmptyState`,
 * `ChatErrorBanner`, `SurfaceFooter`) bound by its host. Notices sit between the thread
 * and the footer, so what went wrong reads next to the box you answer it from, on every
 * host instead of above the thread on some and below it on others.
 */
interface AiSurfaceProps {
    header?: ReactNode;
    /** The conversation's rail (linked tickets, spend) — hosts pass it once a chat exists. */
    rail?: ReactNode;
    /** The transcript (`BrainTimeline`). Ignored while `empty` is given. */
    thread?: ReactNode;
    /** Before the first message (`SurfaceEmptyState`); given ⇒ shown instead of the thread. */
    empty?: ReactNode;
    /** Banners about the run — the error card, allowance, provider fallbacks. */
    notices?: ReactNode;
    /** The pinned footer (`SurfaceFooter`): approval, open question, composer. */
    footer?: ReactNode;
    /** Host placement / palette mapping. */
    className?: string;
    /** Accessible name for the region (localized by the host). */
    label?: string;
    /** Extra attributes a host keys on (test ids, session-replay masking) — as `SurfaceFooter`. */
    dataAttrs?: Record<`data-${string}`, string>;
}
declare function AiSurface({ header, rail, thread, empty, notices, footer, className, label, dataAttrs }: AiSurfaceProps): react.JSX.Element;

/**
 * <SurfaceFooter> — the pinned bottom of every AI surface, extracted from the web
 * panel's `BrainComposerArea`: the tool approval, the open ask-user question, the
 * composer, then a one-line status (uploading…) and a footnote (the AI disclosure).
 *
 * Pinned in BOTH states of a surface (empty and in-thread), so the input never jumps
 * when the first message turns the empty state into a conversation.
 */
interface SurfaceFooterProps {
    /** A pending tool approval (`ToolConfirmBar`). */
    confirm?: ReactNode;
    /** The open ask-user question (`PendingQuestionBanner`). */
    question?: ReactNode;
    /** Live sub-agents and similar strips that belong with the run, above the box. */
    above?: ReactNode;
    /** The composer (`BrainComposer` through the host's adapter). */
    composer: ReactNode;
    /** A transient one-liner under the box (uploading…). */
    status?: ReactNode;
    /** A quiet note under everything (the AI disclosure). */
    footnote?: ReactNode;
    className?: string;
    /** Extra attributes a host keys on (session-replay masking, test ids). */
    dataAttrs?: Record<`data-${string}`, string>;
}
declare function SurfaceFooter({ confirm, question, above, composer, status, footnote, className, dataAttrs }: SurfaceFooterProps): react.JSX.Element;

/**
 * <SurfaceEmptyState> — an AI conversation before its first message: a greeting, the
 * host's controls and the starting points. Moved from the web Brain panel
 * (`BrainEmptyState`) so the editor and Rovr open on the same screen.
 *
 * `page` — a centred hero with the composer in the middle (the full Brain page).
 * `docked` — a side column: a compact greeting and the starters scroll ABOVE a composer
 * the host pins in its `SurfaceFooter`, in the same place it stays once the chat has
 * started, so the first message does not make the input jump.
 *
 * There is no "Start new chat" button: this IS a new chat, and sending (or picking a
 * starter) creates it. Mode is chosen in the composer's `/` menu, not a second toggle here.
 */
interface SurfaceEmptyStateProps {
    layout: 'page' | 'docked';
    /** The greeting line (docked) / the surface's name (page). */
    title: string;
    /** One line under it — follows the armed mode. */
    hint: string;
    /** Host-owned controls above the starters (the new-chat project picker). */
    controls?: ReactNode;
    /** Page layout only — docked hosts render the composer in their pinned footer. */
    composer?: ReactNode;
    /** The starting points (`StarterGroup`s of `StarterTile`s). */
    starters?: ReactNode;
}
declare function SurfaceEmptyState({ layout, title, hint, controls, composer, starters }: SurfaceEmptyStateProps): react.JSX.Element;

/**
 * The empty state's starting points — ONE tile and ONE group shape for every kind of
 * starter (onboarding, Work-mode jobs, "what are we making?" capabilities, the editor's
 * and Rovr's fixed starts), so the lists a person scans before the first message read
 * as one list on every host. Moved from the web Brain panel.
 *
 * A tile is a row (icon · label · one-line hint), not a card: in a ~340px docked column
 * cards showed two options above the fold; rows show the whole set. The grid is
 * `auto-fill` / `minmax(min(100%, 220px), 1fr)` — one column docked, up to three on a
 * full page, never overflowing a 360px viewport.
 */
declare function StarterGroup({ heading, ariaLabel, children }: {
    heading: string;
    ariaLabel?: string;
    children: ReactNode;
}): react.JSX.Element;
interface StarterTileProps {
    /** The host's icon element (web `Icon`, an inline SVG) — never an emoji. */
    icon?: ReactNode;
    label: string;
    hint: string;
    onClick: () => void;
    /** Toggle tiles (a capability) show their armed state. */
    pressed?: boolean;
    disabled?: boolean;
}
declare function StarterTile({ icon, label, hint, onClick, pressed, disabled }: StarterTileProps): react.JSX.Element;

/**
 * The ONE chat-history list every AI surface opens from its header's History lever —
 * moved from the web Brain panel (`BrainChatList` / `BrainChatRow`) so the editor's and
 * Rovr's native `<select>` pickers become the same rows.
 *
 * A row is the title (or its rename input), a meta line the host fills (project tag,
 * time, attention, unread — `meta`), and its revealed actions: Rename / Summarize /
 * Delete, each offered only when the host supplies its handler, plus host extras
 * (`extraActions`, e.g. "Add to project"). Rows reveal actions per-row, not "whatever
 * is selected": opening a chat leaves the history view, so tying actions to the
 * selection put them somewhere nobody can see.
 */
interface ChatHistoryLabels {
    loading: string;
    /** No chats at all. */
    empty: string;
    /** Chats exist, but none match the host's filter. */
    noMatch: string;
    actions: string;
    /** "Actions for {title}". */
    actionsAria: string;
    rename: string;
    summarize: string;
    delete: string;
    archive: string;
}
declare const DEFAULT_CHAT_HISTORY_LABELS: ChatHistoryLabels;
/** THE chat-history copy from a host catalog (canonical keys = the field names). */
declare function chatHistoryLabelsFrom(lookup: LabelLookup): ChatHistoryLabels;
interface ChatHistoryChat {
    id: number;
    title: string;
    ticketCount?: number | null;
    ticketProgressPct?: number | null;
}
interface ChatHistoryListProps {
    loading?: boolean;
    /** How many chats exist before the host's filter (picks empty vs no-match). */
    total: number;
    /** The rows (`ChatHistoryRow`s) — the host maps its own chat model onto them. */
    children?: ReactNode;
    labels?: Partial<ChatHistoryLabels>;
    id?: string;
    className?: string;
}
declare function ChatHistoryList({ loading, total, children, labels: overrides, id, className }: ChatHistoryListProps): react.JSX.Element;
interface ChatHistoryRowProps {
    chat: ChatHistoryChat;
    active: boolean;
    onOpen: (id: number) => void;
    /** The meta line under the title (project tag, time, attention, unread). */
    meta?: ReactNode;
    /** A glyph before the title (a live run, a question waiting). */
    marker?: ReactNode;
    actionsOpen?: boolean;
    onToggleActions?: (id: number) => void;
    renaming?: boolean;
    renameValue?: string;
    onStartRename?: (chat: ChatHistoryChat) => void;
    onRenameChange?: (value: string) => void;
    onSubmitRename?: (id: number, value: string) => void;
    onCancelRename?: () => void;
    onSummarize?: (id: number) => void;
    summarizing?: boolean;
    onArchive?: (chat: ChatHistoryChat) => void;
    archiving?: boolean;
    /** The chat is already archived, so its row does not offer Archive again. */
    archived?: boolean;
    onDelete?: (chat: ChatHistoryChat) => void;
    deleting?: boolean;
    /** Host actions after the standard ones (the web's "Add to project"). */
    extraActions?: ReactNode;
    labels?: Partial<ChatHistoryLabels>;
    className?: string;
}
/** One chat-history row: title (or its rename input), meta line, and its revealed actions. */
declare const ChatHistoryRow: react.MemoExoticComponent<({ chat, active, onOpen, meta, marker, actionsOpen, onToggleActions, renaming, renameValue, onStartRename, onRenameChange, onSubmitRename, onCancelRename, onSummarize, summarizing, onArchive, archiving, archived, onDelete, deleting, extraActions, labels: overrides, className, }: ChatHistoryRowProps) => react.JSX.Element>;

/** What a row action needs of a chat — the shared history row hands back this much. */
interface ChatRowRef {
    id: number;
    title: string;
}
interface UseChatRowActionsOptions {
    /** Open the chat (the host switches to it, and closes / leaves its history view). */
    onOpen: (id: number) => void;
    /** Reveal the opened row's actions — a host that keeps the list beside the thread
     *  (the web Brain page) instead of leaving it on open. */
    revealActionsOnOpen?: boolean;
    /** Persist a new title. Only called for a non-blank title that actually changed. */
    rename: (id: number, title: string) => Promise<unknown> | void;
    /** Rows offer Summarize only when the host supplies it. */
    summarize?: (id: number) => Promise<unknown> | void;
    /**
     * Archive a chat — put it away rather than remove it. Rows offer Archive only when
     * the host supplies it, and never for a chat already archived.
     */
    archive?: (chat: ChatRowRef) => Promise<unknown> | void;
    /** Is this chat already archived? A row in that state does not offer Archive. */
    isArchived?: (id: number) => boolean;
    /** Rows offer Delete only when the host supplies it. */
    remove?: (chat: ChatRowRef) => Promise<unknown> | void;
    /** Asked before `remove`; false cancels. Hosts word and render their own confirm. */
    confirmDelete?: (chat: ChatRowRef) => Promise<boolean>;
    /** The web's "Add to project" (null = take it out of its project). */
    assign?: (chatId: number, projectId: number | null) => Promise<unknown> | void;
}
/** The action props a `ChatHistoryRow` takes, bound to one chat. */
type ChatRowActionProps = Pick<ChatHistoryRowProps, 'onOpen' | 'actionsOpen' | 'onToggleActions' | 'renaming' | 'renameValue' | 'onStartRename' | 'onRenameChange' | 'onSubmitRename' | 'onCancelRename' | 'onSummarize' | 'summarizing' | 'onArchive' | 'archiving' | 'archived' | 'onDelete' | 'deleting'>;
/**
 * THE chat-history row state and its per-row actions (open, reveal actions, rename,
 * summarize, archive, delete, assign) — every host's `ChatHistoryRow`s bind through it
 * (web Brain panel, the editor's chat surface, Rovr), so the rules live once:
 *
 * - one row's actions are revealed at a time, toggled from its "more" button;
 * - Rename is inline; a blank or unchanged title just cancels (no needless write), and
 *   Enter commits once — the input unmounts on Enter and its blur would commit again;
 * - Summarize / Archive / Delete / Assign each mark their row busy while in flight;
 * - Delete asks the host's `confirmDelete` first.
 * - `isArchived(id)` decides whether a row OFFERS Archive: a chat the host already
 *   holds as archived has none to offer, so the menu never offers the state it is in.
 *
 * Hold it ABOVE the list, at surface/panel level: a history list unmounts while the
 * conversation is shown (a docked tab, the editor's History lever), and a row's open
 * actions or in-flight rename must still be there when the user comes back.
 *
 * Handlers read the host's callbacks through a ref, so they keep their identity
 * across renders and the memoized rows do not re-render on every parent render.
 */
declare function useChatRowActions(options: UseChatRowActionsOptions): {
    actionsChatId: number | null;
    renamingId: number | null;
    renameValue: string;
    setRenameValue: react.Dispatch<react.SetStateAction<string>>;
    summarizingId: number | null;
    archivingId: number | null;
    deletingId: number | null;
    busyId: number | null;
    openChat: (id: number) => void;
    toggleActions: (id: number) => void;
    startRename: (chat: ChatRowRef) => void;
    cancelRename: () => void;
    submitRename: (id: number, value: string) => Promise<void>;
    onSummarize: (id: number) => Promise<void>;
    onArchive: (chat: ChatRowRef) => Promise<void>;
    onDelete: (chat: ChatRowRef) => Promise<void>;
    onAssign: (chatId: number, projectId: number | null) => Promise<void>;
    rowProps: (id: number) => ChatRowActionProps;
};
type ChatRowActions = ReturnType<typeof useChatRowActions>;

/**
 * A notice about the run that the person can wave away — until something NEW happens.
 *
 * Moved from the web panel's banner hook (`useBrainPanelBanners`) so the editor's two
 * run notices (a connected account the gateway could not use, a provider key that hit
 * its usage cap) and the web's provider-cap banner share one rule instead of three
 * copies of it: dismissal is keyed on the exact set of values, so a different
 * provider (or reason) re-shows the notice rather than staying hidden.
 */
declare function useDismissibleNotice(values: readonly string[]): {
    show: boolean;
    dismiss: () => void;
};

/**
 * Fixed next steps as chips above an empty box — "what now?" answered without a model
 * call. A chip seeds the box; the person reads it, edits it and sends it. Extracted from
 * the web's ComposerSuggestions; `BrainComposer` renders it from its `suggestions` prop
 * and decides when (an empty box, no turn running), so no host re-derives that.
 */
interface ComposerSuggestion {
    id: string;
    label: string;
    onSelect: () => void;
}
declare const SuggestionRow: react.MemoExoticComponent<({ items, ariaLabel }: {
    items: readonly ComposerSuggestion[];
    ariaLabel: string;
}) => react.JSX.Element | null>;

/**
 * Turns the person composed while a run was in flight — each waits for the run to
 * finish, or (where the host can) is STEERED into it now. Extracted from the VS Code
 * chat's QueuedMessages; it replaces the web's count-only receipt and Rovr's line, so
 * every surface lists the same held turns the same way. Renders nothing when empty.
 */
interface QueuedTurnChipsLabels {
    list: string;
    hint: string;
    steer: string;
    steerHint: string;
    remove: string;
}
declare const DEFAULT_QUEUED_TURN_LABELS: QueuedTurnChipsLabels;
interface QueuedTurnChipsProps<T> {
    items: readonly QueuedItem<T>[];
    /** The text a held turn carries (identity for string queues). */
    textOf: (value: T) => string;
    onRemove: (id: number) => void;
    /** Put a held turn into the running turn now. Omitted ⇒ turns can only wait. */
    onSteer?: (item: QueuedItem<T>) => void;
    /** Whether THIS turn can be steered (e.g. one addressed to a person cannot). */
    canSteer?: (item: QueuedItem<T>) => boolean;
    labels?: Partial<QueuedTurnChipsLabels>;
}
declare function QueuedTurnChips<T>({ items, textOf, onRemove, onSteer, canSteer, labels: overrides }: QueuedTurnChipsProps<T>): react.JSX.Element | null;

/**
 * WHERE a turn goes, as one chip in the composer's tool row — extracted from the canvas's
 * scope chip (IN the whole board / the selection / a frame). A host supplies the options
 * and decides whether there is anything to choose; the chip is a native select so it is
 * keyboard- and screen-reader-complete everywhere. With NO `onChange` there is nothing to
 * choose (Rovr acts on the tab it is in) and the chip is a plain label of `value`. (Who a turn is addressed TO is the
 * shared `RecipientPicker`.)
 */
interface ContextChipOption<V extends string> {
    value: V;
    label: string;
    disabled?: boolean;
}
interface ContextChipProps<V extends string> {
    /** Accessible name — what this chip chooses. */
    label: string;
    value: V;
    /** The choices; omitted with `onChange` ⇒ the read-only form (`value` is shown as text). */
    options?: readonly ContextChipOption<V>[];
    onChange?: (value: V) => void;
    /** A small leading glyph. */
    icon?: ReactNode;
    /** A host's own class (the canvas paints the chip in its own palette). */
    className?: string;
}
declare function ContextChipImpl<V extends string>({ label, value, options, onChange, icon, className }: ContextChipProps<V>): react.JSX.Element;
declare const ContextChip: typeof ContextChipImpl;

interface PromptPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    /** Text entry for the prompt. Always occupies the first, full-width row. */
    input: ReactNode;
    /** The tools: `+` and the `/` options menu. They wrap. */
    actions: ReactNode;
    /**
     * WHO is answering and WHAT you are addressing — "Acting as", the capability,
     * "To", a canvas scope. Each of these self-hides until it has something to say, and
     * rides in the tool row after the tools: the box keeps ONE row of controls under the
     * text, on a phone and in a 300px editor sidebar alike.
     */
    context?: ReactNode;
    /**
     * The ONE trailing control — the mic, Send or Stop (see `promptTrailingAction`).
     *
     * It lives in its own trailing region rather than at the end of `actions` because
     * "the thing that sends the message sits at the far right edge" is a property of the
     * composer, not of each host. It never wraps onto a second line.
     */
    primaryAction?: ReactNode;
    /** Chips, queued turns, or other state shown above the text entry. */
    status?: ReactNode;
    /** Popovers such as the shared @-mention picker. */
    overlay?: ReactNode;
    active?: boolean;
    dragging?: boolean;
}
/**
 * The single structural shell for every BuilderForce prompt surface — the web Brain,
 * the canvas and Studio dock, the editor panel — and the model the desktop apps' boxes
 * copy: one filled box, the text on top, one row of controls under it.
 *
 * Hosts own behavior and individual controls, but input/status/action placement,
 * focus treatment, spacing, and panel shape live here so no surface can grow a
 * different composer again. The `/` trigger's quiet "Work ▾" face is this package's
 * stylesheet, scoped to `.bf-prompt-panel`.
 */
declare function PromptPanel({ input, context, actions, primaryAction, status, overlay, active, dragging, className, style, ...rest }: PromptPanelProps): react.JSX.Element;

/**
 * What a composer's ONE trailing button is right now: the mic, Send, or Stop.
 *
 * Every prompt surface — the web composer, the editor panel, the desktop app — used
 * to answer this on its own, so the editor showed a mic in the text row AND a Send
 * button, and Stop beside a Queue button, while the web shared one slot. They are never
 * useful at the same time, so one slot holds whichever applies:
 *
 * - a live recording keeps the mic (as Stop dictation) in place, even once phrases land
 *   in the box — otherwise the first phrase would swap it for Send and strand the
 *   recording;
 * - text to send wins next, including mid-run, where Send queues the follow-up;
 * - an empty box during a run interrupts it;
 * - an empty idle box offers the mic, where the runtime can listen;
 * - otherwise Send, disabled until there is text.
 */
type PromptTrailingAction = 'voice' | 'send' | 'stop';
interface PromptTrailingState {
    /** The box holds text the host would accept now. */
    canSubmit: boolean;
    /** A turn is streaming. */
    running: boolean;
    /** The host can interrupt the running turn. */
    canStop: boolean;
    /** The host offers dictation AND the runtime supports it. */
    voice: boolean;
    /** Dictation is live. */
    recording: boolean;
}
declare function promptTrailingAction({ canSubmit, running, canStop, voice, recording }: PromptTrailingState): PromptTrailingAction;

/**
 * Dictation into a composer through the runtime's Speech Recognition — the one hook
 * every React prompt surface uses (web composer, editor panel).
 *
 * Each final phrase is appended to the CURRENT text, read through `getValue` at the
 * moment it lands rather than the text as it stood when recording began, so typing
 * while dictating is never overwritten. `supported` is false where the runtime cannot
 * listen (several embedded webviews), and a host then shows no mic at all rather than a
 * button that does nothing.
 */
declare function useVoiceDictation(getValue: () => string, onChange: (value: string) => void): {
    supported: boolean;
    recording: boolean;
    startVoice: () => void;
    stopVoice: () => void;
};

/**
 * The copy of the on-device model list — the page engines' catalog rows a person
 * downloads, runs and removes. Hosts pass their own localized bundle (the web app via
 * next-intl, the editor webview via `vscode.l10n`, Rovr via `chrome.i18n`); the English
 * defaults keep the list readable unmapped. Model and engine names are brands and come
 * from the catalog untranslated.
 *
 * Placeholders are substituted by the list itself: `{size}` (a formatted byte count),
 * `{percent}` (0–100), `{tokens}` (a formatted context window) and `{count}` (a number
 * of models).
 */

interface LocalModelLabels {
    /** Heading above the downloadable catalog. */
    localCatalogHeading: string;
    /** The download action, e.g. "Download (1.2 GB)". */
    localDownload: string;
    /** Progress line while downloading. */
    localDownloading: string;
    localCancel: string;
    localRemove: string;
    /** Accessible name of a ready row's overflow (⋯) button. */
    localMoreActions: string;
    /** Badge on a model that may take a tool (agent) turn. */
    localTools: string;
    /** The context window, e.g. "32K context". */
    localContext: string;
    localDownloadFailed: string;
    localReasonWebgpu: string;
    localReasonF16: string;
    localReasonBuffer: string;
    localReasonVram: string;
    /** Runs without a GPU only on a device with more memory than this one has. */
    localReasonMemory: string;
    localReasonEngine: string;
    /** Badge on a `bfi` row saying where it runs here: on the GPU (WebGPU) or the CPU. */
    localBackendGpu: string;
    localBackendCpu: string;
    /** Section headings: what the curated models are for. */
    localGroupTools: string;
    localGroupChat: string;
    localGroupCoding: string;
    localGroupReasoning: string;
    localGroupMath: string;
    /** The expander over every other model, e.g. "All models (63)". */
    localAllModels: string;
    /** Collapses that expander again. */
    localFewerModels: string;
}
declare const DEFAULT_LOCAL_MODEL_LABELS: LocalModelLabels;
/** Every field of {@link LocalModelLabels} — the ONE key table hosts read their catalog by. */
declare const LOCAL_MODEL_LABEL_FIELDS: ReadonlyArray<keyof LocalModelLabels>;
/** A host's string for one label field, or undefined when its catalog has none. */
type LocalModelLabelLookup = (field: keyof LocalModelLabels) => string | undefined;
/**
 * The on-device list's copy from a host catalog. Each host used to hand-map the same
 * fields onto its own keys (next-intl, `vscode.l10n`, `chrome.i18n`); a host now
 * passes a lookup by field and every label it lacks falls back to the English default.
 * Placeholders (`{size}`, `{percent}`, `{tokens}`) must come back literal.
 */
declare function localModelLabelsFrom(lookup: LocalModelLabelLookup): LocalModelLabels;
/** Why a row is unsupported → the label that says so. A registry, so a new fit code
 *  is one entry here rather than a branch in the row. */
declare const LOCAL_UNSUPPORTED_LABEL: Record<NonNullable<LocalModelRow$1['reason']>, keyof LocalModelLabels>;
/** Where a row runs → its badge. A registry, so a new backend is one entry here. */
declare const LOCAL_BACKEND_LABEL: Record<NonNullable<LocalModelRow$1['backend']>, keyof LocalModelLabels>;

/**
 * The copy of the INFERENCE MODE control (the `/` menu's Model tab) and its first-run
 * prompt — the same strings on the web app, Rovr and the VS Code webview. Hosts read them
 * through the `/` menu's key table (`promptOptionsLabelsFrom` — these fields are part of
 * `PromptOptionsLabels`), so a host maps each canonical key onto its own catalog once.
 */

interface InferenceModeLabels {
    /** Heading of the control in the Model tab. */
    inferenceMode: string;
    inferenceModeHybrid: string;
    inferenceModeHybridHint: string;
    inferenceModeLocalOnly: string;
    inferenceModeLocalOnlyHint: string;
    inferenceModeSpecific: string;
    inferenceModeSpecificHint: string;
    /** Tag beside the recommended mode. */
    inferenceModeRecommended: string;
    /** The first-run prompt's question. */
    inferenceModeAskTitle: string;
    /** One line under it: that the choice can be changed later, and where. */
    inferenceModeAskBody: string;
}
declare const DEFAULT_INFERENCE_MODE_LABELS: InferenceModeLabels;
/** The canonical key fields, for a host's catalog-coverage test. */
declare const INFERENCE_MODE_LABEL_FIELDS: ReadonlyArray<keyof InferenceModeLabels>;
/** A mode's name and one-line description. */
declare function inferenceModeCopy(mode: InferenceMode, labels: InferenceModeLabels): {
    name: string;
    hint: string;
};

/**
 * The contract for the composer's `/` control — the ONE place a prompt panel
 * exposes run shaping (effort, thinking), WHICH MODEL IS IN USE, and how to
 * change it.
 *
 * Model choice used to live in a second control beside the `/` menu (a labelled
 * chip on the web, a chip that punted to a VS Code QuickPick in the editor), so
 * the composer had two different affordances for "what runs this turn" and the
 * editor's list could not even be read without leaving the panel. One control,
 * one contract, both hosts.
 *
 * The MODEL half of that contract (which models exist, their order, and who pays
 * for each) lives in brain-embedded's `modelChoice` — the VS Code extension HOST
 * shares it too, and it cannot import React.
 */

/**
 * Every user-facing string in the menu. Hosts pass their own localized bundle
 * (the web app via next-intl, the VS Code webview via the host's `vscode.l10n`
 * bundle); the English defaults below keep the component usable unmapped.
 */
interface PromptOptionsLabels extends ModelChoiceLabels, LocalModelLabels, InferenceModeLabels {
    /** Trigger title/aria — the menu as a whole. */
    options: string;
    /** Section heading for the conversation-mode block (Chat | Work). */
    mode: string;
    /** Section heading + row label for persistent project memory. */
    memory: string;
    /** Auto-approve canvas/tool actions for the next turn. */
    autoMode: string;
    /** Explains that Auto mode executes actions without a confirmation step. */
    autoModeHint: string;
    /** Section heading for the actions that act on the CHAT itself (consolidate, fork). */
    conversation: string;
    consolidate: string;
    consolidating: string;
    /** What consolidating actually does to the rest of the conversation. */
    consolidateHint: string;
    fork: string;
    forking: string;
    forkHint: string;
    /** Why neither conversation action can run yet (too short a chat, or a live run). */
    sessionUnavailable: string;
    effort: string;
    effortQuick: string;
    effortBalanced: string;
    effortThorough: string;
    thinking: string;
    on: string;
    off: string;
    /** Section heading for the model block. */
    model: string;
    /** Heading of the read-only "what is running this turn" row. */
    modelInUse: string;
    searchModels: string;
    filterModels: string;
    chooseModel: string;
    noModels: string;
    all: string;
    /** Shown instead of the list when the tenant may not pin a model at all. */
    modelLocked: string;
    accountSettings: string;
    /** Tab heading for account / usage / Evermind details. Hosts may omit it — the merge fills English "Status". */
    status?: string;
}
declare const DEFAULT_PROMPT_OPTIONS_LABELS: PromptOptionsLabels;
/** Merge a host's partial overrides over the English defaults. */
declare function promptOptionsLabels(overrides?: Partial<PromptOptionsLabels>): PromptOptionsLabels;
/**
 * THE `/` menu's copy from a host catalog — the ONE key table every host reads it
 * through (every field by name, the on-device list's included). A key the catalog lacks
 * keeps the English default; row templates (`{runtime}`, `{size}` …) must come back
 * literal — the menu fills them per row.
 */
declare function promptOptionsLabelsFrom(lookup: LabelLookup): PromptOptionsLabels;

/** One selectable conversation mode. `value` is the host's stable, non-translatable id. */
interface PromptOptionsModeChoice {
    value: string;
    label: string;
    hint?: string;
    icon?: string;
}
/**
 * Conversation mode for this turn — on BuilderForce, Chat vs Work.
 *
 * It lives in the `/` menu rather than beside it for the same reason the model does:
 * a composer that grows one pill per setting is a composer nobody can use on a phone.
 * The trigger keeps naming the ARMED mode, so "can this turn dispatch real work?" is
 * still answerable without opening anything.
 */
interface PromptOptionsMode {
    value: string;
    onChange: (value: string) => void;
    choices: PromptOptionsModeChoice[];
}
/** Persistent memory for this conversation, when the host has one to offer. */
interface PromptOptionsMemory {
    enabled: boolean;
    onChange: (on: boolean) => void;
    /** What being on/off means here — shown under the label. */
    describe?: (on: boolean) => string;
    /** Why it cannot be used right now. Set ⇒ the row is inert and states the reason. */
    unavailableReason?: string;
}
/** Whether tool and canvas actions run without a separate approval prompt. */
interface PromptOptionsAutoMode {
    enabled: boolean;
    onChange: (on: boolean) => void;
    /** What enabling this setting means on the current host. */
    description?: string;
}
/**
 * The two actions that act on the CONVERSATION rather than on the next turn:
 * consolidate it into a compact summary, or fork that summary into a new chat.
 *
 * They used to be two always-visible pills in the action row on both hosts (the
 * web composer through a `ConsolidateForkControl`, the VS Code webview through a
 * hand-rolled copy of the same two buttons) — four controls that were inert for
 * most of a chat's life and, on a narrow panel, crowded out Send. Here they get
 * room to say what they do, and the host only supplies state + handlers.
 */
interface PromptOptionsSession {
    /** The chat is long enough / idle enough for a summary to mean anything. */
    canConsolidate: boolean;
    consolidating?: boolean;
    forking?: boolean;
    onConsolidate: () => void;
    onFork: () => void;
}

/** The mode wiring a host hands the composer. */
interface PromptOptionsInferenceMode {
    /** The mode in force (the chosen one, else the host's derived default). */
    value: InferenceMode;
    onChange: (mode: InferenceMode) => void | Promise<void>;
    /**
     * The person has not chosen yet and should be asked before their next turn (a first run —
     * the host decides who is asked: signed in everywhere, and on the web an anonymous
     * visitor too, for whom it is the Hybrid opt-in). THE first-run gate
     * (`useInferenceModeGate`) then holds that turn behind the question.
     */
    needsChoice?: boolean;
}
interface InferenceModeControlProps {
    inferenceMode?: PromptOptionsInferenceMode;
    labels: InferenceModeLabels;
    /** Called after a pick (the menu closes itself). */
    onPicked?: () => void;
}
declare function InferenceModeControl({ inferenceMode, labels, onPicked }: InferenceModeControlProps): react.JSX.Element | null;

/** Model wiring for the `/` menu. Omit it on a surface with no model choice. */
interface PromptOptionsModel {
    selection: ChatModelSelection;
    options: ChatModelOptions;
    onChange: (selection: ChatModelSelection) => void;
    /**
     * What the host will actually send while the selection is `auto` — a configured
     * default or a `project_evermind:<id>` pin. Shown as the model in use, because
     * "Auto" alone does not answer the question the user opened the menu to ask.
     */
    effective?: string;
    /**
     * Who is reading: which routing product funds their turns, and whether the gateway
     * would accept a pin from them at all. ONE object rather than a `canChoose` boolean
     * beside it, because the two answers are the same fact — a viewer who may not pin is
     * on the product, and must be told so by name instead of being shown an upstream id
     * next to a list they cannot use. Omitted ⇒ free + no choice (fail closed).
     */
    identity?: ModelIdentityContext;
    /**
     * The host's on-device model store (brain-embedded `createPageEngineSet().store`) —
     * the port through which the menu lists, downloads and removes page-engine models.
     * The menu never learns which host it is in; omit it where no page engine runs.
     */
    localStore?: LocalModelStore;
    /**
     * The viewer's entitlement is not known yet (the host's catalog has not loaded, or
     * could not be read). The menu then offers what needs no entitlement — on-device
     * models — and does NOT claim the plan forbids choosing: that sentence is shown only
     * once `identity.canChoose` is known to be false.
     */
    identityPending?: boolean;
}

interface PromptOptionsMenuProps {
    labels?: Partial<PromptOptionsLabels>;
    disabled?: boolean;
    mode?: PromptOptionsMode;
    memory?: PromptOptionsMemory;
    autoMode?: PromptOptionsAutoMode;
    /** Consolidate / fork this chat. Omit on a surface with no chat behind it. */
    session?: PromptOptionsSession;
    effort?: Effort;
    onEffortChange?: (effort: Effort) => void;
    /** What a level really costs at this host's current state (answer/thinking budgets). */
    describeEffort?: (effort: Effort) => string;
    thinking?: boolean;
    onThinkingChange?: (on: boolean) => void;
    describeThinking?: (on: boolean) => string;
    model?: PromptOptionsModel;
    /** Where models run (Hybrid · Local only · Specific) — the top of the Model tab. */
    inferenceMode?: PromptOptionsInferenceMode;
    /**
     * A host's request to OPEN the menu on a tab (e.g. a "Download a local model" remedy
     * sending the person to the Model tab). Each new `token` opens it once; the same token
     * again does nothing, so a re-render never re-opens a menu the person closed.
     */
    openOn?: PromptOptionsOpenRequest;
    /**
     * Host-owned account / usage / Evermind details for the Status tab. The menu
     * never fetches billing itself — each host already has its own plan snapshot.
     * Omit on a surface with nothing to show besides `onAccountSettings`.
     */
    status?: ReactNode;
    /** The Spend tab: its name and body (the composer wires `WorkSpendPanel`). Absent ⇒ no tab. */
    spend?: {
        label: string;
        content: ReactNode;
    };
    onAccountSettings?: () => void;
    className?: string;
}
type PromptOptionsTab = 'mode' | 'effort' | 'model' | 'status' | 'spend';
/** Open the `/` menu on `tab`; bump `token` for each new request. */
interface PromptOptionsOpenRequest {
    tab: PromptOptionsTab;
    token: number;
}
/**
 * The composer's `/` control: everything that shapes the NEXT TURN — the mode it
 * runs in, whether it remembers, whether actions auto-apply, run shaping (effort,
 * thinking), the model in use and the model picker, plus account status. One
 * affordance, shared by every BuilderForce prompt surface (web Brain, Creation
 * Canvas, the VS Code webview).
 *
 * The popover is tabbed (Mode, Effort, Model, Status, Spent) so the user is not scrolling
 * a single mixed list to find the setting they opened the menu for. The trigger
 * still states the two consequential ones (the armed mode, the model in use) so
 * nothing has to be opened to read what will happen.
 *
 * Self-gating: renders nothing until a host wires at least one section.
 */
declare function PromptOptionsMenu({ labels: labelOverrides, disabled, mode, memory, autoMode, session, effort, onEffortChange, describeEffort, thinking, onThinkingChange, describeThinking, model, inferenceMode, openOn, status, spend, onAccountSettings, className, }: PromptOptionsMenuProps): react.JSX.Element | null;

interface LocalModelRowProps {
    row: LocalModelRow$1;
    labels: LocalModelLabels;
    /** This row is the pinned model. */
    active: boolean;
    /** Its last download failed. */
    failed?: boolean;
    /** BCP 47 locale for numbers; the runtime's when omitted. */
    locale?: string;
    onSelect(ref: string): void;
    onDownload(ref: string): void;
    onCancel(ref: string): void;
    onRemove(ref: string): void;
}
declare function LocalModelRow({ row, labels, active, failed, locale, onSelect, onDownload, onCancel, onRemove }: LocalModelRowProps): react.JSX.Element;

interface LocalModelsState {
    /** The catalog rows, or null until the store first answers. Empty without a store. */
    rows: LocalModelRow$1[] | null;
    /** Refs whose last download failed (cleared when retried). */
    failed: ReadonlySet<string>;
    download(ref: string): void;
    cancel(ref: string): void;
    remove(ref: string): void;
}
declare function useLocalModels(store: LocalModelStore | undefined): LocalModelsState;

interface LocalModelListProps {
    state: LocalModelsState;
    labels: LocalModelLabels;
    /** The pinned ref, when it is one of these rows. */
    activeRef?: string;
    locale?: string;
    /** Omit the heading (a host that titles the section itself). */
    hideHeading?: boolean;
    onSelect(ref: string): void;
}
declare function LocalModelList({ state, labels, activeRef, locale, hideHeading, onSelect }: LocalModelListProps): react.JSX.Element | null;

declare function requestComposerMenu(composerId: string, tab?: PromptOptionsTab): void;
/** The latest open request for THIS composer, for `ComposerOptions.openMenu`. */
declare function useComposerMenuRequest(composerId: string | undefined): PromptOptionsOpenRequest | undefined;

interface InferenceModeFirstRunProps {
    labels: InferenceModeLabels;
    onChoose: (mode: InferenceMode) => void;
}
declare function InferenceModeFirstRun({ labels, onChoose }: InferenceModeFirstRunProps): react.JSX.Element;

interface InferenceModeGate {
    /** The question is showing (a send is held behind it). */
    asking: boolean;
    /** Run `send` now, or hold it behind the question. True = it ran now. */
    request: (send: () => void) => boolean;
    /** The person's answer: apply the mode, then run the held send. */
    choose: (mode: InferenceMode) => void;
}
declare function useInferenceModeGate(inferenceMode: PromptOptionsInferenceMode | undefined): InferenceModeGate;

/**
 * THE remedies for the shared banner's "nothing can take this turn, and signing in would
 * not help" verdicts — `no_local_model`, `no_specific_model`, and an on-device model that
 * keeps crashing — derived ONCE for every host (the web Brain, the guest panel, the
 * canvas's Brain object, the VS Code webview, Rovr). Each host used to spell the same
 * three rules out itself, and each spelled them slightly differently (one dismissed the
 * banner, one did not; none re-sent the refused turn after moving onto Hybrid).
 *
 *   - "Switch to Hybrid" — offered only while Local only is what rules the cloud out. It
 *     applies the mode FIRST, then re-sends the refused turn when the host can (`retry`),
 *     so the person's request is answered rather than left for them to type again.
 *   - "Download a local model" — the host's download place when it has one (the editor's
 *     model picker, Rovr's settings), else this composer's `/` menu on its Model tab.
 *   - "Pick a model" — this composer's `/` menu on its Model tab (Run models + the picker).
 *
 * Every remedy dismisses the banner: the menu or the new mode is now the answer to it.
 * The menu opened is the one beside the banner (`composerId`), never every composer on
 * the page. The host's own mode and where-to-download are its ports — nothing else here
 * is per host.
 */

interface ModelRemedyPorts {
    /** The mode in force, or undefined while the host has not read it yet. */
    mode: InferenceMode | undefined;
    /** Apply a mode — the same handler the `/` menu's Run models control calls. */
    setMode: (mode: InferenceMode) => void | Promise<void>;
    /** The composer beside the banner — its `/` menu is the one the remedies open. */
    composerId: string;
    /** Clear the banner (the run's error). */
    onDismiss: () => void;
    /** Where this host downloads an on-device model; omitted ⇒ the composer's Model tab. */
    downloadLocalModel?: () => void;
    /** Re-send the turn the verdict refused, once the mode has moved. Omitted ⇒ not re-sent. */
    retry?: () => void;
}
type ModelRemedies = Pick<ChatErrorBannerProps, 'onSwitchToHybrid' | 'onDownloadLocalModel' | 'onPickModel'>;
declare function modelRemedies({ mode, setMode, composerId, onDismiss, downloadLocalModel, retry }: ModelRemedyPorts): ModelRemedies;
/**
 * THE composer wiring for a host's mode — every host hands the shared composer the same
 * shape from the same three facts. `needsChoice` is "never chosen", signed in OR
 * anonymous (operator decision): the first-run question asks everyone once, and for an
 * anonymous person it is the Hybrid opt-in. Who is signed in decides the DEFAULT `value`
 * (the host's derivation), never whether the person is asked.
 */
declare function inferenceModeOption(state: {
    value: InferenceMode;
    chosen: boolean;
    onChange: PromptOptionsInferenceMode['onChange'];
}): PromptOptionsInferenceMode;

/**
 * THE keyboard model for a `role="radiogroup"` of buttons — ONE tab stop (the checked
 * radio, or the first when none is checked: roving `tabIndex`), Arrow keys move focus
 * between the radios (and wrap), Home / End jump to the first / last. Moving focus does
 * not choose — Space / Enter (the button's own click) does, because on these groups a
 * choice changes something real (where the next turn runs, how the cloud is funded).
 *
 * Shared by the inference-mode control and the web's cloud-funding card, so the two
 * radio groups a person meets on the same settings journey behave identically.
 */

/** Where a key moves focus from `index`, or null for a key the group does not handle. */
declare function rovingRadioNextIndex(key: string, index: number, count: number): number | null;
interface RovingRadioItemProps<T extends HTMLElement> {
    ref: (el: T | null) => void;
    tabIndex: 0 | -1;
    onKeyDown: (event: KeyboardEvent<T>) => void;
}
/**
 * `count` radios, `checkedIndex` the checked one (-1 / out of range = none). Spread
 * `itemProps(index)` on each radio button.
 */
declare function useRovingRadioGroup<T extends HTMLElement = HTMLButtonElement>(count: number, checkedIndex: number): {
    itemProps: (index: number) => RovingRadioItemProps<T>;
};

/**
 * Pure formatting for an on-device model row — what the row SAYS, separated from how it
 * renders so the copy rules are testable and shared by every host's list.
 *
 * Numbers go through `Intl` with the host's locale (undefined = the runtime's), so a
 * download size reads "1.2 GB" in English and "1,2 GB" in German without a catalog
 * entry per unit.
 */

/** A download size: gigabytes to one decimal from 1 GB up, whole megabytes below. */
declare function formatDownloadSize(bytes: number, locale?: string): string;
/** A parameter count in compact notation ("8.2B"). */
declare function formatParams(params: number, locale?: string): string;
/** A context window in the "32K" form model cards use. */
declare function formatContextTokens(tokens: number): string;

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
    style?: react__default.CSSProperties;
}
/** A single participant avatar: initials on a deterministic coloured disc/tile. */
declare function Avatar({ name, kind, size, title, style }: AvatarProps): react__default.JSX.Element;
/**
 * The "→ recipients" badge on a directed user turn: who it was put to. One recipient
 * reads "→ [avatar] Name"; a group turn stacks up to `max` avatars and names them,
 * with "+N" for the rest (the full list is in the tooltip). Renders nothing for a
 * BRAIN turn.
 */
declare function RecipientsBadge({ recipients, max, size }: {
    recipients: readonly DirectedRecipient[];
    max?: number;
    size?: number;
}): react__default.JSX.Element | null;

/**
 * Open/close state for a composer popover — the ONE implementation of "opens on the
 * trigger, closes on an outside press or Escape" that every composer menu shares: the
 * `/` options menu, the recipient and persona pickers, and the VS Code webview's `+`
 * menu. Attach `rootRef` to the element that contains BOTH the trigger and the
 * popover, so a press inside either never counts as outside.
 */
declare function usePopover<T extends HTMLElement = HTMLDivElement>(): {
    open: boolean;
    toggle: () => void;
    close: () => void;
    show: () => void;
    rootRef: react.RefObject<T | null>;
};

interface RecipientPickerLabels {
    /** Eyebrow on the pill, e.g. "To". */
    to: string;
    /** Names the control and heads its list, e.g. "Send to". */
    title: string;
    /** The BRAIN row, e.g. "BuilderForce". */
    brain: string;
    /** What sending to the BRAIN does, e.g. "Runs it". */
    brainHint: string;
    /** What sending to an invited agent does, e.g. "Replies & acts". */
    agentHint: string;
    /** What sending to an invited person does, e.g. "Notified". */
    humanHint: string;
}
declare const DEFAULT_RECIPIENT_PICKER_LABELS: RecipientPickerLabels;
interface RecipientPickerProps {
    /** The chat's invited participants. None ⇒ the control does not render. */
    participants: readonly DirectedRecipient[];
    /** The EFFECTIVE recipient of the next message (null = the BRAIN). */
    recipient: DirectedRecipient | null;
    /** An explicit pick: the BRAIN, or a participant. */
    onChoose: (choice: Exclude<RecipientChoice, null>) => void;
    labels?: Partial<RecipientPickerLabels>;
    disabled?: boolean;
    /** Wrap the chosen participant's avatar — the web adds its personality hovercard. */
    renderAvatar?: (recipient: DirectedRecipient, avatar: react__default.ReactNode) => react__default.ReactNode;
}
/**
 * The composer's "To" control: who the next message goes to. The BRAIN (the default)
 * executes it; an invited agent replies and can act; an invited person is notified.
 * ONE control for the web composer and the VS Code webview, so the two cannot route a
 * message differently or describe the same choice in different words.
 *
 * Self-gating: a chat with no participants has nothing to route, so nothing renders.
 */
declare function RecipientPicker({ participants, recipient, onChoose, labels, disabled, renderAvatar }: RecipientPickerProps): react__default.JSX.Element | null;

/**
 * Who the next message goes to, as composer state — shared by every composer so
 * routing behaves identically on the web and in the editor.
 *
 * `choice` is the explicit pick (`null` = auto, `'brain'`, or a participant). It resets
 * when `resetKey` changes (switching chats) and drops a participant who has since left
 * the roster. The effective `recipient` then follows {@link resolveRecipient}: an
 * explicit BRAIN pick wins, else an explicit participant, else a leading @mention in
 * `input`, else the BRAIN (null).
 */
declare function useRecipientChoice({ participants, input, resetKey }: {
    participants: DirectedRecipient[];
    input: string;
    resetKey: unknown;
}): {
    recipient: DirectedRecipient | null;
    choice: RecipientChoice;
    choose: react.Dispatch<react.SetStateAction<RecipientChoice>>;
};

interface PersonaPickerLabels {
    /** Eyebrow on the pill, e.g. "Acting as". */
    actingAs: string;
    /** Names the control, e.g. "Brain agent or persona". */
    title: string;
    defaultBrain: string;
    /** Heading over the modality personas. */
    personas: string;
    /** Heading over the Brain-assigned agents. */
    assignedAgents: string;
}
declare const DEFAULT_PERSONA_PICKER_LABELS: PersonaPickerLabels;
/** A modality persona as the host names it (the label is the host's translation). */
interface PersonaModalityOption {
    id: string;
    label: string;
    icon?: string;
}
interface PersonaPickerProps {
    value: BrainPersonaChoice;
    onChange: (value: BrainPersonaChoice) => void;
    modalities: readonly PersonaModalityOption[];
    /** Agents assigned to the Brain; the group is omitted when there are none. */
    agents: readonly BrainPersonaAgent[];
    labels?: Partial<PersonaPickerLabels>;
    disabled?: boolean;
    /**
     * The surface's own default choice. While no agent is assigned and the choice is
     * still this one, the picker renders nothing: "Acting as: Brain" with nobody else
     * to act as is a row of chrome that says nothing. It reappears once an agent is
     * assigned or the person moves off the default (from a prior pick or a seed).
     */
    quietAt?: BrainPersonaChoice;
}
/**
 * The composer's "Acting as" control: WHO the Brain answers as — the default Brain,
 * a modality persona, or an agent assigned to the Brain. ONE control for the web
 * composer and the VS Code webview; what a choice DOES to the run is the shared
 * persona domain's (`brainPersona.ts`), so this component only offers and names.
 */
declare function PersonaPicker({ value, onChange, modalities, agents, labels, disabled, quietAt }: PersonaPickerProps): react.JSX.Element | null;

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
declare function HealthRing({ percent, size, stroke, caption, muted, ariaLabel }: HealthRingProps): react.JSX.Element;

/**
 * The chat's "this turn left code on disk" list.
 *
 * A Brain turn can edit the workspace through its local tools, and until this existed
 * the conversation was the ONLY record that it had: the transcript said "the file
 * change has been made", the ticket rail showed a task in progress, and nothing
 * anywhere told you there were now unreviewed edits in the working tree — let alone
 * gave you a way to look at them.
 *
 * The COUNT lives in the ticket rail's pill row (a `ChatTicketsExtension` the host
 * registers — see ChatTicketsPanel), so it sits beside Link ticket / Agents / People
 * instead of as a separate block above the rail that pushed the rail under the
 * header. This is the drawer that pill opens: the hint, each file's real diff, and
 * the review action. It renders the working set as the HOST reports it — the host
 * owns what "pending" means (its git working tree) and what "open" does (the editor's
 * own diff viewer); this component owns only how it reads.
 *
 * Self-gating, per the shared-component rule: nothing pending ⇒ it renders nothing.
 */
/** What happened to one file. Mirrors the host's git vocabulary. */
type PendingChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'typechange';
/** One uncommitted file, as a surface renders it. */
interface PendingChangeVM {
    /**
     * Stable, host-defined identity for this row — the React key, and what the host
     * recognises the row by when `onOpenChange` hands it back. Opaque here on purpose:
     * the displayed path is repo-relative and two repositories can hold the same one,
     * so it is not an identity. Defaults to the path when a host has nothing better.
     */
    id?: string;
    /** Repo-relative path — what the user reads. Display only; see {@link id}. */
    path: string;
    status: PendingChangeKind;
    /** Already staged in the index. Shown, because it changes what "commit" will do. */
    staged: boolean;
    /** Repository name; shown only when more than one repository has pending work. */
    repo?: string;
}
interface PendingChangesLabels {
    /** The pill's word in the ticket rail; the rail appends the count itself. */
    pill: string;
    /** Summary sentence (the pill's tooltip). Must contain the literal `{count}` token. */
    summary: string;
    /** Summary sentence for exactly one change. */
    summaryOne: string;
    /** Explains WHY the list is there, at the top of the drawer. */
    hint: string;
    review: string;
    staged: string;
    /** Per-status words, shown beside each path. */
    status: Record<PendingChangeKind, string>;
}
declare const DEFAULT_PENDING_CHANGES_LABELS: PendingChangesLabels;
/** Merge a host's partial label bundle over the defaults (status words included). */
declare function resolvePendingChangesLabels(overrides?: Partial<PendingChangesLabels>): PendingChangesLabels;
/** "3 uncommitted changes" / "1 uncommitted change" — the ONE place the sentence is built. */
declare function pendingChangesSummary(count: number, labels: PendingChangesLabels): string;
interface PendingChangesListProps {
    /** The uncommitted files. Empty ⇒ the list renders nothing. */
    changes: PendingChangeVM[];
    /** Open one file's diff. */
    onOpenChange: (change: PendingChangeVM) => void;
    /**
     * Take the user to the full review surface (the editor's Changes / Source Control
     * view). Omit on a surface that has none — the button then isn't offered.
     */
    onReview?: () => void;
    labels?: Partial<PendingChangesLabels>;
    className?: string;
    style?: react__default.CSSProperties;
}
declare function PendingChangesList({ changes, onOpenChange, onReview, labels: labelOverrides, className, style, }: PendingChangesListProps): react__default.JSX.Element | null;

/**
 * The copy of the spend & savings readouts — the chat's spend pill and the Status tab's
 * period card. Hosts pass their own localized bundle (next-intl on the web,
 * `vscode.l10n` in the editor, `chrome.i18n` in Rovr); the English defaults keep both
 * readable unmapped.
 *
 * Placeholders, substituted by the components: `{amount}` (a formatted dollar figure),
 * `{tokens}` (a formatted token count), `{pct}` (0–100), `{count}`, `{days}`.
 */

interface SpendLabels {
    /** Pill: "{amount} spent". */
    spent: string;
    /** Pill: "{amount} saved" — measured only. */
    saved: string;
    /** Pill: "≈{amount} saved" — when any part is an estimate. */
    savedApprox: string;
    /** Token count, e.g. "{tokens} tok". */
    tokens: string;
    /** Accessible name / title of the pill. */
    pillTitle: string;
    /** Breakdown heading: what the conversation cost. */
    spendHeading: string;
    platform: string;
    yourKey: string;
    /** Under "your key": priced at the provider's list price. */
    yourKeyHint: string;
    /** Tokens on models without a price, e.g. "{tokens} tokens on unpriced models". */
    unpriced: string;
    /** Breakdown heading: what memory saved. */
    savedHeading: string;
    /** Share of the would-be bill memory removed, e.g. "{pct}% of the bill". */
    savedShare: string;
    /** Marks an estimated row. */
    estimated: string;
    measured: string;
    /** Row count suffix, e.g. "{count}×". */
    events: string;
    /** Nothing saved yet. */
    nothingSaved: string;
    /** Status card heading, e.g. "AI spend · last {days} days". */
    periodHeading: string;
    /** One label per saving source. */
    sources: Record<SavingsSourceKey, string>;
    /** One explanation per saving source (tooltip). */
    sourceHints: Record<SavingsSourceKey, string>;
}
declare const DEFAULT_SPEND_LABELS: SpendLabels;
/** Merge a host's partial overrides over the English defaults (nested maps too). */
declare function spendLabels(overrides?: Partial<SpendLabels>): SpendLabels;
/**
 * THE spend & savings copy from a host catalog — the ONE key table every host reads it
 * through: each field by name, and `sources.<source>` / `sourceHints.<source>` by the
 * server's saving-source key. A key the catalog lacks keeps the English default;
 * `{amount}`/`{tokens}`/`{pct}`/`{count}`/`{days}` must come back literal.
 */
declare function spendLabelsFrom(lookup: LabelLookup): SpendLabels;

/**
 * Shared types for the ChatTicketsPanel — the chat↔ticket surface rendered
 * identically on the web app and inside the VS Code webview. The panel is
 * presentational + self-managing; each host injects a {@link ChatTicketsAdapter}
 * (its own REST calls) and a {@link ChatTicketsLabels} bundle (its own i18n).
 */
/** The work-item kinds a chat can be tied to (planning spine + roadmap + spec + gap +
 *  the two team ceremonies). Mirrors `TICKET_KINDS` in the api's ChatTicketService. */
type TicketKind = 'portfolio' | 'objective' | 'initiative' | 'roadmap' | 'spec' | 'epic' | 'gap' | 'task' | 'retro' | 'poker';
declare const TICKET_KINDS: TicketKind[];
/**
 * Only these kinds are RUNNABLE — a board ticket an agent can be dispatched to execute.
 *
 * The ceremonies are deliberately absent, and that is the whole distinction between
 * "linkable" and "runnable": a retrospective and an estimation session are work a TEAM
 * performs together, so a chat can be tied to one and its progress read back, but there
 * is nothing for a single agent to go and do. Offering "run an agent on this retro"
 * would be a control that cannot mean anything.
 */
declare const RUNNABLE_KINDS: TicketKind[];
type LinkType = 'linked' | 'created';
/**
 * The work item a ticket hangs UNDER — the epic a task belongs to, or the epic a
 * sub-epic sits beneath. Mirrors `TicketParent` in the api's ChatTicketService.
 */
interface TicketParentVM {
    kind: TicketKind;
    ref: string;
    /** The parent's title, as the rail renders it ("↳ in Advisor Platform"). */
    label: string;
}
/** A chat↔ticket link with a live health summary. */
interface TicketLinkVM {
    linkId: number;
    kind: TicketKind;
    ref: string;
    label: string;
    status: string;
    /**
     * 0–100 completion percentage for the linked work item.
     *
     * `progressPct === 100` is the authoritative completion signal: it is emitted
     * ONLY once the work item is fully complete (a leaf that is marked done, or a
     * container whose every child/target is done — i.e. `done === total`). It is
     * never reported before completion, and a value approaching 100 (e.g. 99) does
     * NOT mean done — only an exact 100 does. Health is derived live on every read,
     * so 100 is an idempotent terminal state (reported on every subsequent read),
     * not a one-shot event delivered exactly once.
     */
    progressPct: number;
    done: number;
    total: number;
    exists: boolean;
    linkType: LinkType;
    /**
     * The work item this ticket belongs to, when the server resolved one. Present for
     * the task-tier kinds (task/epic/gap) that hang off a parent; absent for a
     * top-level item, an orphan whose parent is gone, and for every other tier.
     *
     * Without it a chat that spawned an epic, three child epics and their tasks
     * rendered them as one indistinguishable run of "EPIC · BACKLOG · SPAWNED HERE"
     * chips — the hierarchy the conversation had just created was invisible.
     */
    parent?: TicketParentVM;
}
/** A chat that references a ticket (a lineage row). */
interface LineageVM {
    chatId: number;
    title: string;
    linkType: LinkType;
    isArchived: boolean;
}
/** An agent invited into the chat. */
/** A live sub-agent working in the chat — a run one of its agents spawned. */
interface ChatSubagentVM {
    /** Stable while it runs (the host's run key). */
    key: string;
    /** How it is addressed, e.g. `a3`. */
    handle: string;
    name: string;
    /** Its slice of the work. */
    label: string;
    /** Who spawned it. */
    owner: string;
}
interface ChatAgentVM {
    id: string;
    agentRef: string;
    role: string;
    /**
     * The name a human knows this agent by, resolved server-side.
     *
     * Optional only for the wire: a client can be talking to an API that predates it, and
     * `undefined` there must degrade to the old pool lookup rather than render blank.
     * Every surface that prints an agent reads this first — before it existed, the
     * diagnostics report and the Work directive both printed raw uuids because neither
     * had the browser-side agent pool the picker was cross-referencing.
     */
    name?: string;
    /** `ide_agents.builtin_kind` — 'manager' | 'validator' | … ; null for a user agent. */
    builtinKind?: string | null;
}
/**
 * One execution started against a ticket this chat links.
 *
 * Mirrors the API's `ChatRunRecord`. The field that matters most is `submittedBy`: it
 * names WHICH pathway started the run (`user:<id>` = a human pressed Run,
 * `system:lane-auto` = board autonomy, `system:coordinator` = the manager's pass), and
 * a chat whose runs were all started by autonomy was never actually driven from the
 * conversation — a distinction no other field can make.
 */
interface ChatRunVM {
    executionId: number;
    taskId: number;
    taskTitle: string | null;
    agentRef: string | null;
    agentName: string | null;
    status: string;
    submittedBy: string;
    source: string;
    /**
     * WHERE it executed: 'container' (real shell + local clone) | 'durable' (shell-LESS,
     * git-API edits) | 'github_actions'. The two cloud executors differ in what the run was
     * CAPABLE of — only one can compile what it wrote — and nothing else in a transcript
     * distinguishes them.
     */
    executor: string | null;
    /** The on-prem machine this run was delivered to, when it was one. */
    hostId: number | null;
    hostName: string | null;
    produced: boolean | null;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
}
/** What has actually RUN for a chat, and how much there was to run. */
interface ChatRunHistoryVM {
    linkedRunnableTickets: number;
    runs: ChatRunVM[];
    dispatchers: string[];
    /** Distinct executors across those runs ('container' | 'durable' | 'on-prem' | …). */
    executors: string[];
    /**
     * Live cloud sub-agents of this chat (`parent_execution_id` set, not yet settled).
     * Absent on a failed fetch — that is not the same as "none running".
     */
    subagents?: ChatSubagentVM[];
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
    ticketCount?: number | null;
    ticketProgressPct?: number | null;
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
    /**
     * Every run started against a ticket this chat links — the half of "is anything
     * happening?" that the ticket list cannot answer. Read by the diagnostics capture, so
     * a report can state what EXECUTED rather than only what was filed and who was invited.
     */
    listRuns(chatId: number): Promise<ChatRunHistoryVM>;
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
    /**
     * Tag an agent to execute a runnable (task/epic) ticket. Returns whether a run
     * actually started + the agent's display name for the toast.
     *
     * `agentName` is null when the platform, not the caller, decided who runs — a
     * lifecycle-managed ticket dispatched on the operator's authority pins no agent,
     * because on such a board the assignee is the Coordinator and never an executor. The
     * toast already falls back to the requested agent's pool name, so a null is a display
     * decision, not a missing value; naming the requested agent as the RUNNER would be
     * the only wrong answer.
     *
     * `chatId` BINDS the run to the conversation that asked for it: the agent is
     * invited into the chat and the dispatch carries the chat, so the run narrates
     * there and is reachable from it. A dispatch without it runs invisibly — which
     * is precisely what the VS Code host's own copy of this adapter used to do.
     */
    runTicket(kind: TicketKind, ref: string, agentRef: string, chatId: number): Promise<{
        started: boolean;
        agentName: string | null;
    }>;
    /**
     * Whether this host currently permits DISPATCHING a run, and if not, why.
     *
     * Run dispatch is role-gated in the web app (`runtime.execute`) but this package
     * is surface-agnostic and also renders in the VS Code webview, where there is no
     * tenant-role context at all. So the capability is asked of the HOST rather than
     * computed here — it is the one thing the panel genuinely cannot know.
     *
     * OPTIONAL on purpose: a host that omits it (VS Code) is treated as permitted,
     * which preserves today's behaviour rather than silently disabling the button in
     * a surface that has no way to answer.
     *
     * `reason` is a host-LOCALIZED sentence rendered as the disabled control's
     * tooltip. Product rule: a gated control is disabled and explained, never hidden
     * — and never a button that looks live and throws on click.
     */
    canRunTicket?(): {
        allowed: boolean;
        reason?: string;
    };
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
    /** Beside a sub-agent's name; `{owner}` is the agent that spawned it. */
    subagentOf: string;
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
    /** Heading for the chat's ORIGINAL request — the user's first prompt, kept verbatim
     *  (migration 1245) so a linked ticket shows what the chat was actually asked for. */
    originalRequest: string;
    /** The request's accessible name / tooltip; `{text}` is the request itself. Parametric
     *  because it carries the user's own words, which must not be run through a word order
     *  the host's catalog cannot express. */
    originalRequestText: (text: string) => string;
    /** Accessible name of the ticket-grid sort control. */
    sortLabel: string;
    /** Incomplete (progress < 100%) first — the default. */
    sortOpen: string;
    /** Complete (100%) first. */
    sortDone: string;
    /** Alphabetical by title. */
    sortTitle: string;
    /** Original API / link order. */
    sortLinked: string;
    kind: Record<TicketKind, string>;
    ringAria: (label: string, pct: number) => string;
    /** The chip's parent line: which work item this ticket belongs to ("in Advisor
     *  Platform"). Parametric so a host localizes the preposition, not just the noun. */
    inParent: (parent: string) => string;
    /** N-linked-tickets count shown in the collapsible header. */
    ticketCount: (n: number) => string;
    /** Aria label for the collapsed header's overall-progress ring. */
    overallAria: (pct: number) => string;
    runStarted: (agent: string) => string;
    mergeAction: (n: number) => string;
    mergedN: (n: number) => string;
}
/** English defaults — the fallback for any key a host catalog lacks (see `chatTicketsLabelsFromBundle`). */
declare const DEFAULT_CHAT_TICKETS_LABELS: ChatTicketsLabels;
/**
 * A host-registered pill in the ChatTicketsPanel's action row (beside Link ticket ·
 * Agents · People · Merge), with the drawer it opens. This is how a host adds a
 * rail-level signal of its OWN — the VS Code webview's "Changes (N)" for uncommitted
 * edits, say — without the shared panel growing a branch per host. Registry DATA, not
 * a prop-drilled boolean: a host passes the extension only while it has something to
 * show (the panel renders whatever list it is handed), and the panel owns which one
 * drawer is open, exactly as for its built-in pills.
 */
interface ChatTicketsExtension {
    /** Stable key — the open-drawer identity. Must not collide with the built-in pills. */
    key: string;
    /** Leading icon — an inline SVG element (never an emoji), sized to the pill's text. */
    icon?: ReactNode;
    /** The pill's word. */
    label: string;
    /** Appended as ` (N)` when > 0, like Agents/People. */
    count?: number;
    /** Tooltip / accessible name; defaults to the label. */
    title?: string;
    /** The drawer body, rendered inside the rail's standard drawer chrome when open. */
    render: () => react.ReactNode;
}

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
    /** Host-registered pills + drawers appended to the action row (see
     *  {@link ChatTicketsExtension}). Pass only the ones that currently have
     *  something to show; an empty/absent list adds nothing. */
    extensions?: ChatTicketsExtension[];
    /** The chat's LIVE sub-agents — runs its agents spawned, listed beside the invited
     *  agents so the roster names everyone working in the chat. The host knows them (the
     *  editor's run registry); omit where there are none. */
    subagents?: readonly ChatSubagentVM[];
    /** What this conversation cost and what memory saved it — the `spend` the api attaches
     *  to every chat payload. Shown as a pill at the right end of the action row; absent/empty ⇒ no pill. */
    spend?: SpendSavingsSummary | null;
    spendLabels?: Partial<SpendLabels>;
    /** BCP-47 locale for the pill's money and token formatting. */
    locale?: string;
    /**
     * The chat's ORIGINAL request — the user's first prompt, kept verbatim on the chat
     * (migration 1245) so the linked ticket still shows what the chat was asked for once
     * the ~60-char auto-title has overwritten the obvious. Read-only: it is a historical
     * record, so the panel never offers an edit affordance. Omit (or pass null/'') to hide
     * the line entirely — a chat created before 1245, or one whose capture never landed,
     * simply has nothing to show.
     */
    originalRequest?: string | null;
}
declare function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility, onOpenTicket, extensions, subagents, spend, spendLabels, locale, originalRequest }: ChatTicketsPanelProps): react.JSX.Element;
/**
 * Memoized: this panel sits directly under the composer, so it would otherwise
 * reconcile its whole subtree (health-ring SVGs, selects, link/merge/agents forms)
 * on every keystroke and streaming token. Callers must pass referentially stable
 * props (memoize `chatList` and `onChanged`) for the memo to take effect.
 */
declare const ChatTicketsPanel: react.MemoExoticComponent<typeof ChatTicketsPanelInner>;

/**
 * Label for a conversation in a picker (VSIX `<select>`, Sessions tree).
 *
 * Live-run glyphs (`❓` awaiting confirm, `●` running) already tell the user
 * the chat is busy. Linked-ticket progress is the other come-back signal:
 * a chat at 67% still has open work, even when nothing is running right now.
 */
declare function chatSwitcherLabel(input: {
    title: string;
    id: number;
    ticketCount?: number | null;
    ticketProgressPct?: number | null;
    runGlyph?: string;
}): string;

/** An authenticated JSON call, relative to the gateway origin. */
type ChatTicketsRequest = <T>(path: string, init?: {
    method?: string;
    body?: BodyInit;
}) => Promise<T>;
interface ChatTicketsRestOptions {
    /** How this host makes an authenticated JSON call. */
    request: ChatTicketsRequest;
    /**
     * Whether this surface may dispatch a run, and if not, why.
     *
     * Asked of the host because it is the one thing neither this package nor the
     * gateway response can answer: the web app gates on the `runtime.execute`
     * tenant role, and the VS Code webview has no tenant-role context at all.
     * Omitted means permitted — which is the VSIX's existing behaviour, and the
     * server still refuses on its own authority.
     */
    canRun?: () => {
        allowed: boolean;
        reason?: string;
    };
}
declare function createChatTicketsRestAdapter(opts: ChatTicketsRestOptions): ChatTicketsAdapter;

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
 * A refresh signal that ticks whenever a new run-milestone / agent-dispatch activity line
 * lands in the transcript. Those lines are written by the server alongside a change to
 * the chat's ticket/agent state (the running agent is joined to the chat), which arrives
 * over the live message subscription — not through any ticket-rail action. Add it to a
 * `ChatTicketsPanel` / `useChatParticipants` refresh signal so the Agents list re-reads
 * the moment an agent starts narrating, on every host the same way.
 */
declare function useChatActivitySignal(messages: ReadonlyArray<{
    metadata?: string | null;
}>): number;

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
 * chip, so it need not linger in the body) and calls `onPick` — wire that to
 * `useRecipientChoice`'s `choose`, reusing the whole directed-message routing spine.
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
/** English defaults — the fallback for any field a host catalog lacks. */
declare const DEFAULT_MENTION_LABELS: Required<MentionLabels>;
interface UseMentionAutocompleteOptions {
    /** Ref to the composer's <textarea> — read for the live caret position. */
    textareaRef: react__default.RefObject<HTMLTextAreaElement | null>;
    /** Current composer text (controlled). */
    value: string;
    /** Setter for the composer text (same one the textarea's onChange calls). */
    setValue: (v: string) => void;
    /** The chat's invited participants (agents + humans) offered by the picker. */
    participants: DirectedRecipient[];
    /** Called with the participant the user picked — wire to `useRecipientChoice`'s `choose`. */
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
    onKeyDown: (e: react__default.KeyboardEvent<HTMLTextAreaElement>) => boolean;
    /** Attach to the textarea's onSelect so a caret move re-detects the token. */
    onSelect: () => void;
    /** The popup element; render it inside a `position: relative` container. */
    popup: react__default.ReactNode;
    /** True while the picker is open (its nav keys are being intercepted). */
    open: boolean;
}
declare function useMentionAutocomplete(opts: UseMentionAutocompleteOptions): MentionAutocomplete;

/**
 * #ticket autocomplete — the shared composer typeahead that lets a user tag
 * a ticket in the chat by typing "#". Similar to @mention but for tickets.
 *
 * Headless-ish: {@link useTicketAutocomplete} owns the token/selection state and
 * returns handlers you spread onto YOUR <textarea> plus a `popup` node you render
 * inside a `position: relative` composer container. Picking a ticket replaces the
 * "#query" fragment with the ticket reference (e.g., "#123") and calls `onPick`.
 */

interface TicketAutocompleteLabels {
    /** Heading above the list, e.g. "Tag ticket". */
    title?: string;
    /** Row sub-label for ticket status, e.g. "In Progress". */
    status?: string;
    /** Text when no tickets match. */
    noMatches?: string;
}
/** English defaults for a host catalog's missing fields. The popup itself falls back to
 *  the ticket's own status when no `status` label is given. */
declare const DEFAULT_TICKET_TAG_LABELS: Required<TicketAutocompleteLabels>;
interface UseTicketAutocompleteOptions {
    /** Ref to the composer's <textarea> — read for the live caret position. */
    textareaRef: react__default.RefObject<HTMLTextAreaElement | null>;
    /** Current composer text (controlled). */
    value: string;
    /** Setter for the composer text (same one the textarea's onChange calls). */
    setValue: (v: string) => void;
    /** The available tickets to choose from. */
    tickets: ChatTicket[];
    /** Called with the ticket the user picked. */
    onPick: (t: ChatTicket) => void;
    labels?: TicketAutocompleteLabels;
    /** Suppress the picker entirely (e.g. while a run is streaming). */
    disabled?: boolean;
}
interface TicketAutocomplete {
    /**
     * Attach to the textarea's onKeyDown BEFORE your own logic. Returns true when it
     * consumed the key (nav / select / escape) — when true you must NOT also submit
     * or insert a newline for that key.
     */
    onKeyDown: (e: react__default.KeyboardEvent<HTMLTextAreaElement>) => boolean;
    /** Attach to the textarea's onSelect so a caret move re-detects the token. */
    onSelect: () => void;
    /** The popup element; render it inside a `position: relative` container. */
    popup: react__default.ReactNode;
    /** True while the picker is open (its nav keys are being intercepted). */
    open: boolean;
}
declare function useTicketAutocomplete(opts: UseTicketAutocompleteOptions): TicketAutocomplete;

/**
 * The chat-tickets rail's labels from a host catalog — the ONE key table every host
 * reads it through. Canonical keys: `<field>` for every static field of
 * {@link ChatTicketsLabels}, `kind.<kind>` for the tier names, and these parametric
 * ones (their figures as `values`) — `ringAria` ({label}, {pct}), `inParent` ({parent}),
 * `ticketCountOne` / `ticketCountMany` ({n}), `overallAria` ({pct}), `runStarted`
 * ({agent}), `mergeAction` ({n}), `mergedN` ({n}). A key the catalog lacks keeps the
 * English default, so a host that ships part of the catalog still renders every control.
 */

declare function chatTicketsLabelsFrom(lookup: LabelLookup): ChatTicketsLabels;
/**
 * The same table over a host's FLAT bundle (`ct.*` keys → text, `{name}` placeholders) —
 * the shape the VS Code extension posts (and the Evermind console's
 * `evermindLabelsFromBundle` reads).
 */
declare function chatTicketsLabelsFromBundle(bundle: Readonly<Record<string, string>>, prefix?: string): ChatTicketsLabels;

/**
 * chatDiagnosticsReads — the chat-scoped half of a diagnostics capture, wired ONCE.
 *
 * `gatherChatDiagnostics` is already the one assembler: every surface hands it the same
 * named readers and it produces the same report. What was NOT shared is how each host
 * produced those readers. The VS Code webview satisfied them from the chat-tickets REST
 * adapter; the web Brain panel satisfied the same three endpoints from a SECOND client
 * (`builderforceApi.listChatAgents` / `listChatTickets`). One assembler, two hand-wired
 * source sets over identical routes.
 *
 * That is not a cosmetic duplication. It is why adding the execution-history read meant
 * editing two hosts, and it is the shape a field-by-field drift takes: the moment one
 * host's client returns a field the other's does not, two "identical" reports quietly
 * describe different things — which is exactly the failure `gatherChatDiagnostics` was
 * extracted to end, stopped one layer short.
 *
 * So the reads live here, over the adapter both surfaces already build. A host keeps
 * only what genuinely differs between surfaces — its name, its build stamps, its plan
 * and Evermind readers — and a FOURTH chat-scoped read is added in this file alone.
 *
 * `chatId === null` is a real state (a chat that has not been created yet), and every
 * reader answers it with the empty shape rather than a throw the capture would have to
 * catch: a report about no chat is still a report.
 */

/** The reads this module owns — exactly the chat-scoped ones. */
type ChatDiagnosticsChatReads = Pick<ChatDiagnosticsSources, 'readAgents' | 'readTickets' | 'readRuns'>;
/** Only the adapter methods these reads use, so a caller can pass a narrower object. */
type ChatDiagnosticsReadAdapter = Pick<ChatTicketsAdapter, 'listAgents' | 'listTickets' | 'listRuns'>;
/**
 * The chat-scoped readers for a diagnostics capture, over the adapter the host already
 * has. Spread into `gatherChatDiagnostics({ ...chatDiagnosticsReads(adapter, chatId) })`.
 */
declare function chatDiagnosticsReads(adapter: ChatDiagnosticsReadAdapter, chatId: number | null): ChatDiagnosticsChatReads;

/**
 * The transcript's NODES — what each durable message or trace step becomes on the
 * timeline, and the per-kind sort rank. Split from `timelineModel.ts` (which orders them):
 * this module derives ONE message's node, cached per message object, so a trace event in
 * a 5,000-row chat re-derives nothing it already derived — no JSON re-parse per persisted
 * step, and the SAME node objects come back, which keeps the memoized rows from
 * re-rendering on every step.
 *
 * Pure: no React, no DOM.
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
    kind: 'activity';
    ts: number;
    order: number;
    message: BrainMessage;
    activity: ChatActivity;
    fallbackText: string;
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
    kind: 'memoryAnswer';
    ts: number;
    order: number;
    source: 'qa-cache' | 'evermind' | 'symbol-index';
    version: number | null;
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
    kind: 'modelMove';
    ts: number;
    order: number;
    move: ModelMove;
} | {
    key: string;
    kind: 'compacted';
    ts: number;
    order: number;
    message: BrainMessage | null;
    count: number;
    note: string;
} | {
    key: string;
    kind: 'streaming';
    ts: number;
    order: number;
    text: string;
};
/** Pull the attachment list a message stored in its metadata JSON (best-effort). */
declare function attachmentsOf(message: BrainMessage): ChatInputAttachment[];

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

interface BuildTimelineInput {
    messages: BrainMessage[];
    trace: BrainTraceEvent[];
    streamingText: string;
    isRunning: boolean;
}
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
/**
 * The key of a reply STRANDED inside its own reasoning, or null when there isn't one.
 *
 * A reasoning-only assistant message is normally a single collapsed "Thought" line,
 * and rightly so: the model thought, then called a tool, and never addressed the user.
 * That reading breaks at exactly one place — the END of a settled conversation. A run
 * that stops on a reasoning-only message has said its last word inside the `<think>`
 * block, so collapsing it renders the whole turn as one muted line and shows the
 * reader NOTHING. Reported verbatim: an explicit instruction answered with a question
 * the transcript never displayed, its last row a "Thought" — "to the user, they think
 * the Agent just died".
 *
 * A model whose reply lands in the reasoning channel is not rare (an unclosed
 * `<think>` survives every strip on the way here, because every one of them needs the
 * closing tag), so the transcript has to be able to end on a readable turn regardless.
 * `promoteSwallowedAnswer` in `@builderforce/agent-loop` rescues the neighbouring case — a real
 * answer with only a fragment left outside the block — but deliberately leaves a turn
 * with NO answer segment alone, because mid-run that turn is either still streaming or
 * genuinely had nothing to say. This is the fact that tells the two apart, and it is
 * not in the content: it is the turn's POSITION and whether the run is still going.
 *
 * The scan walks back to the conversation's last MODEL reply — past tool steps, memory
 * rows and runtime narration, which are bookkeeping and can sort either side of it —
 * and stops at a user turn, because a user turn after the reply means the exchange
 * moved on and a pending turn (not a stranded one) is what is missing. Nothing is
 * stranded while `isRunning`: the surface is already showing a live indicator, and the
 * text is still arriving.
 */
declare function strandedReplyKey(nodes: readonly TimelineNode[], isRunning: boolean): string | null;
/** The trailing live-streaming assistant bubble, or null when nothing is streaming.
 *  Always sorts last (max timestamp), so callers append it after the settled nodes. */
declare function streamingNode(streamingText: string, isRunning: boolean): TimelineNode | null;
/** Compact human duration for a "Thought for …" label (e.g. 0s, 2s, 12s). */
declare function formatDuration(ms: number | undefined): string;

/**
 * Shared types for the <EvermindConsole> — the per-project Evermind inspect-and-train
 * surface rendered identically on the web app and inside the VS Code sidebar webview.
 * The console is presentational + self-managing; each host injects an
 * {@link EvermindConsoleAdapter} (its own REST calls) and an {@link EvermindConsoleLabels}
 * bundle (its own i18n). See [[evermind-learning-architecture]].
 */
type EvermindMode = 'connected' | 'offline-frozen';
/** Which surface renders the console — stamped into the diagnostics export, because each
 *  fails differently and "which one was this?" is the first question of a pasted report. */
type EvermindHost = 'web' | 'vscode' | 'synapse';
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
    /** True when this contribution's weights were fitted into the merge (it moved the
     *  neocortex). Absent on rows written before the flag existed — all of which were
     *  fitted — so read it as `fitted !== false`. */
    fitted?: boolean;
    /** The task prompt the run addressed (text-path only). */
    prompt?: string;
    /** The run/exemplar text that was learned (text-path only). Absent when a pinned
     *  teacher failed on a teach-a-task — see `skipReason`. */
    text?: string;
    /** True when a frontier teacher shaped what was learned (text-path only). */
    distilled?: boolean;
    /** The frontier model that distilled this entry (present when `distilled`). */
    teacherModel?: string;
    /** Why distillation did NOT happen — {@link EvermindTeacherSkipReason}. */
    skipReason?: string;
    /** Operator-facing detail behind `skipReason` (HTTP status, exception message). */
    skipDetail?: string;
    /** The pinned teacher model that failed (present on a distillation fault). */
    attemptedTeacherModel?: string;
}
/** What a teach POST can tell the caller: the id its contribution was queued under.
 *  Absent on a host (or server) that predates the pollable status channel. */
interface EvermindTeachResult {
    contributionId?: number;
}
/**
 * How one enqueued contribution ended up. `pending` is transient; every other state is
 * terminal, so a poller has a defined stopping condition.
 *
 * `merged` means it is IN THE WEIGHTS — including when a pinned teacher faulted, since
 * the contribution still learns un-distilled. `dropped` means a merge consumed it and it
 * never became a memory (stale base, no trainable window, non-LM head). `unknown` is the
 * server declining to answer (no coordinator binding, or an unreadable reply).
 */
type EvermindContributionState = 'pending' | 'merged' | 'dropped' | 'unknown';
/**
 * One contribution's status. The provenance fields are the RING'S, deliberately —
 * {@link EvermindContributionStatus} is graded by the same `evermindLearnedStatus` that
 * grades a Learnings row, so a teach's reported outcome and that memory's own row can
 * never tell the operator two different stories.
 */
interface EvermindContributionStatus {
    contributionId: number;
    state: EvermindContributionState;
    kind?: 'text' | 'delta';
    /** The version it merged INTO (present only when `merged`). */
    version?: number;
    distilled?: boolean;
    teacherModel?: string;
    /** {@link EvermindTeacherSkipReason} — why a teacher did not shape this. */
    skipReason?: string;
    skipDetail?: string;
    attemptedTeacherModel?: string;
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
/**
 * The Evermind CODING-QUALITY gate's verdict (mirrors api `EvermindCodingGate`).
 * Operator decision 2026-09-12: a head serves IDE coding turns only when a coding eval
 * recorded for THIS version scores ≥ `bar` (0.9) of the frontier baseline.
 */
interface EvermindCodingGateView {
    qualified: boolean;
    reason: 'qualified' | 'unseeded' | 'quarantined' | 'no_eval' | 'stale_eval' | 'below_bar';
    /** The bar the server applied (fraction, e.g. 0.9) — never restated client-side. */
    bar: number;
    /** Recorded score ÷ baseline score, or null when no usable eval is recorded. */
    ratio: number | null;
    headVersion: number;
    evaluatedVersion: number | null;
    baselineModel?: string | null;
    dataset?: string | null;
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
    /**
     * True when this Evermind belongs to the project's PARENT container, not to the
     * project the console is scoped to.
     *
     * Only `evermind`-modality builds get their own `project_evermind` row; every other
     * modality (video, voice, designer, finetune) inherits its container's — deliberately,
     * so a build opens with the container's trained model instead of an empty one, and so
     * learning stays pooled across the group rather than sharded per build.
     *
     * The console MUST render read-only when this is set. Reads inherit, but every write
     * endpoint keeps exact-id semantics (a contribution must never silently land on the
     * wrong project), so a seed/toggle/teach issued from an inheriting build targets a row
     * that does not exist — it updates zero rows and returns OK. Offering those controls
     * here would be an affordance that does nothing.
     */
    inherited?: boolean;
    /** The container project whose Evermind is being displayed (present when `inherited`). */
    inheritedFromProjectId?: number;
    /**
     * ISO timestamp this Evermind auto-quarantined after a streak of incoherent serves
     * (null/absent = healthy). While quarantined it serves nothing and cannot be
     * re-enabled until it passes the coherence probe again — the console renders a badge
     * + reason so "why did it turn itself off / why can't I turn it on" is never a mystery.
     */
    quarantinedAt?: string | null;
    /** The probe-failure reason behind {@link quarantinedAt} (present when quarantined). */
    quarantineReason?: string | null;
    /** Whether this head may serve IDE coding turns (the 90% coding-eval gate). Absent on
     *  an older server — the console then says nothing about it. */
    codingGate?: EvermindCodingGateView | null;
}
/**
 * One Evermind a project targets — its own head, or the head of an IDE build grouped
 * under it. Shape mirrors the api `targetsCore` endpoint. Ordered `[self, …builds]`,
 * so index 0 is the project itself. Learning fans out to every live target; inference
 * stays single-pick. Read-only in the console.
 */
interface EvermindTarget {
    projectId: number;
    /** The head's published artifact ref, or null while unseeded. */
    ref?: string | null;
    version: number;
    name: string;
    mode: EvermindMode;
    inferenceEnabled: boolean;
    seeded: boolean;
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
 * One graded generation from the TEST BENCH — what the model actually produced for a
 * prompt, plus the verdict the SERVE PATH would reach on it. This is the difference
 * between "which memories would be recalled" (Validate) and "what will a user see"
 * (this): only the latter can catch a head that emits gibberish, before a user does.
 */
interface EvermindProbeSample {
    prompt: string;
    /** The raw text the model generated. Shown verbatim — no cleanup, no truncation. */
    text: string;
    /** Whether this output would be served to a user, or refused as unusable. */
    coherent: boolean;
    /** Which signal rejected it (`repetition`, `non-words`, …); null when it passed. */
    failure: string | null;
    /** Plain-language explanation of {@link failure} (empty when coherent). */
    detail: string;
}
/** A test-bench run: one prompt, or the fixed readiness suite the enable-gate uses. */
interface EvermindProbeResult {
    version: number;
    /** The project the probe ran against. */
    projectId?: number;
    /** `readiness` = the fixed probe suite that gates enabling inference; `prompt` = the
     *  operator's own prompt. Both are graded identically. */
    mode: 'readiness' | 'prompt';
    /** Whether the run clears the bar (a readiness run needs a MAJORITY of samples). */
    ready: boolean;
    /** Fraction of samples that were servable (0..1). */
    passRate: number;
    samples: EvermindProbeSample[];
}
/** What a knowledge audit concluded about one learned memory. */
type EvermindKnowledgeVerdict = 'ok' | 'incoherent' | 'incorrect' | 'outdated' | 'unusable' | 'redundant';
/** One audited memory: what is wrong with it and (when repairable) the replacement. */
interface EvermindKnowledgeFinding {
    id: number;
    verdict: EvermindKnowledgeVerdict;
    /** One sentence naming the problem. */
    issue: string;
    /** The task this memory answered — the key its correction is re-taught under. */
    prompt?: string;
    /** Excerpt of the memory as it stands today. */
    excerpt: string;
    /** The corrected knowledge to learn instead. Absent when the memory is simply dropped. */
    correction?: string;
    /** Whether the local coherence screen or the frontier reviewer produced this verdict. */
    source: 'coherence-gate' | 'frontier';
}
/** The result of a read-only knowledge audit. */
interface EvermindKnowledgeAnalysis {
    version: number;
    /** How many learned memories were reviewed. */
    analyzed: number;
    /** The frontier model that graded, or null when only the local screen ran. */
    model: string | null;
    findings: EvermindKnowledgeFinding[];
    /** How many memories the model holds in total. Differs from `analyzed` once the
     *  project has learned more than one pass reviews. Absent from an older API. */
    total?: number;
    /** True when there is more history than this pass looked at — the summary says so
     *  rather than implying the whole model was audited. */
    truncated?: boolean;
    /** Present when the frontier review could not run — local findings still returned. */
    warning?: string;
}
/** What applying a set of findings actually changed. */
interface EvermindKnowledgeRepair {
    /** Memories re-taught with corrected knowledge. */
    corrected: number;
    /** Memories dropped from the recall index — they can no longer be retrieved or
     *  ground a reply. NOT "unlearned": the residual influence a memory already had on
     *  the weights is superseded the normal write-through way, by teaching the
     *  correction, and for an `unusable`/`redundant` finding there IS no correction to
     *  teach. The strings below say this rather than claiming more than happened. */
    forgotten: number;
    /** Contributions merged by the closing flush. */
    merged: number;
    version: number;
    skipped: Array<{
        id: number;
        reason: string;
    }>;
}
/** What a clean-up pass removed. */
interface EvermindCleanupResult {
    /** Queued-but-unmerged contributions dropped. */
    discarded: number;
    /** Cached question→answer pairs purged. */
    cachedAnswers: number;
}
/** What a recall reindex recomputed. */
interface EvermindReindexResult {
    reindexed: number;
    skipped: number;
    version: number;
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
    /**
     * Teach from raw text (a transcript / exemplar); `prompt` is the task it answered.
     *
     * Resolving is ACCEPTANCE, never success: the contribution is queued and the frontier
     * teacher only runs later, in the coordinator's debounced merge. A host that can
     * return the server's contribution id should — that is what lets the console poll
     * {@link EvermindConsoleAdapter.teachStatus} and replace its optimistic toast with
     * what actually happened. Returning `void` keeps the old optimistic behaviour.
     */
    teach(text: string, prompt?: string): Promise<EvermindTeachResult | void>;
    /**
     * OPTIONAL — poll one contribution's outcome by the id {@link teach} returned. When a
     * host implements BOTH, the console resolves "Queued for learning" into the real
     * result: taught-and-distilled, taught-without-a-teacher, or a named teacher fault.
     * A host that omits it keeps the optimistic toast.
     */
    teachStatus?(contributionId: number): Promise<EvermindContributionStatus>;
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
    /**
     * OPTIONAL — list every Evermind under this project (self + the IDE builds grouped
     * under it). When present, the console renders the read-only "Everminds under this
     * project" list; a host that omits it simply hides the section. Ordered `[self, …builds]`.
     */
    loadTargets?(): Promise<EvermindTarget[]>;
    /**
     * OPTIONAL — TEST BENCH: generate from the model and grade the output. Pass a prompt
     * to see what the model produces for it; omit it to run the fixed readiness suite that
     * gates enabling inference. When present the console renders the test bench.
     */
    probe?(prompt?: string): Promise<EvermindProbeResult>;
    /**
     * OPTIONAL — REPLACE the model's weights with a fresh base (a published model by
     * `slug`, or a clean starter base when omitted), as a new version. The repair path for
     * a model that has trained itself into gibberish. Inference is left OFF afterwards.
     */
    reseed?(slug?: string): Promise<{
        version: number;
    }>;
    /** OPTIONAL — recompute every learned memory's recall embedding against the current
     *  model, so retrieval stops drifting as the model learns. */
    reindex?(): Promise<EvermindReindexResult>;
    /** OPTIONAL — drop queued-but-unmerged contributions and purge cached answers.
     *  Never touches what the model has already learned. */
    cleanup?(): Promise<EvermindCleanupResult>;
    /** OPTIONAL — audit what the model has learned (read-only) and report what is wrong. */
    analyze?(): Promise<EvermindKnowledgeAnalysis>;
    /** OPTIONAL — apply an audit's findings: forget bad knowledge, re-teach corrections. */
    applyFindings?(findings: EvermindKnowledgeFinding[]): Promise<EvermindKnowledgeRepair>;
    /**
     * OPTIONAL — write to the HOST's clipboard, for the diagnostics export. Tried before
     * `navigator.clipboard`, which a VS Code webview may not be permitted to use; a host
     * that omits it falls back to the browser API and then to manual selection.
     */
    copyText?(text: string): Promise<void>;
}
/** Every visible string. Parametric ones are functions the host localizes. */
interface EvermindConsoleLabels {
    title: string;
    description: string;
    loading: string;
    managerOnlyHint: string;
    /** Shown instead of the training controls when this build INHERITS its container
     *  project's Evermind (see {@link EvermindConsoleData.inherited}) — it explains that
     *  the model is shared and that training happens on the parent project. */
    inheritedHint: string;
    statusSeeded: (version: number) => string;
    statusUnseeded: string;
    quarantinedBadge: string;
    quarantinedHint: (reason: string) => string;
    codingGateQualified: (pct: number, barPct: number) => string;
    codingGateBelowBar: (pct: number, barPct: number) => string;
    codingGateNoEval: (barPct: number) => string;
    codingGateStale: (evaluatedVersion: number, headVersion: number, barPct: number) => string;
    targetsTitle: string;
    targetsHint: string;
    targetsEmpty: string;
    targetSelfBadge: string;
    targetBuildBadge: string;
    targetSeeded: (version: number) => string;
    targetUnseeded: string;
    targetInferenceOn: string;
    targetConnected: string;
    targetFrozen: string;
    targetProjectId: (id: number) => string;
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
    /** INTERIM state: the contribution is queued. Resolved by the status poll below. */
    taught: string;
    /** Resolved: a frontier teacher answered and the model learned that answer. */
    taughtDistilled: (model: string, version: number) => string;
    /** Resolved: learned from the raw text with no teacher pinned — a legitimate mode. */
    taughtSelf: (version: number) => string;
    /** Resolved: it learned, but the PINNED teacher produced nothing. Actionable. */
    taughtTeacherFault: (model: string, reason: string) => string;
    /** Resolved: a merge consumed it and it never became a memory. */
    taughtDropped: string;
    /** The poll gave up while still queued — honest about not knowing yet, not a failure. */
    taughtStillPending: string;
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
    /** Badge on a row whose pinned teacher produced no exemplar. */
    notDistilled: string;
    /** Provenance note naming the frontier teacher that distilled the row. */
    distilledBy: (model: string) => string;
    /** The expanded explanation of a distillation fault (model may be empty). */
    teacherFault: (model: string, reason: string) => string;
    testTitle: string;
    testHint: string;
    testPlaceholder: string;
    testRunCta: string;
    testReadinessCta: string;
    testRunning: string;
    /** Header over the results of a readiness run vs a single prompt run. */
    testResultReadiness: (passed: number, total: number) => string;
    testResultPrompt: string;
    testServable: string;
    testRefused: string;
    /** The plain-language reason an output was refused. */
    testRefusedBecause: (detail: string) => string;
    testEmptyOutput: string;
    testVerdictReady: string;
    testVerdictNotReady: string;
    maintenanceTitle: string;
    maintenanceHint: string;
    reseedLabel: string;
    reseedHint: string;
    reseedCta: string;
    reseedConfirm: string;
    reseedStarterOption: string;
    reseedDone: (version: number) => string;
    reindexLabel: string;
    reindexHint: string;
    reindexCta: string;
    reindexDone: (reindexed: number) => string;
    cleanupLabel: string;
    cleanupHint: string;
    cleanupCta: string;
    cleanupConfirm: string;
    cleanupDone: (discarded: number, cached: number) => string;
    analyzeTitle: string;
    analyzeHint: string;
    analyzeCta: string;
    analyzing: string;
    analyzeClean: (analyzed: number) => string;
    analyzeSummary: (issues: number, analyzed: number, model: string) => string;
    analyzeSummaryLocal: (issues: number, analyzed: number) => string;
    analyzeVerdict: (verdict: EvermindKnowledgeVerdict) => string;
    analyzeCorrectionLabel: string;
    analyzeSelectAll: string;
    analyzeSelectNone: string;
    analyzeApplyCta: (count: number) => string;
    analyzeApplying: string;
    analyzeApplied: (corrected: number, forgotten: number, version: number) => string;
    /** Coverage line shown when the audit reviewed only part of the history. */
    analyzeCoverage: (analyzed: number, total: number) => string;
    /** Why some findings could not be applied. The REASONS come from the server (it is
     *  the only thing that knows whether learning is frozen or the coordinator refused),
     *  so only the frame around them is localized — a bare count told an operator nothing
     *  and hid a remedy that is one toggle away. */
    analyzeSkipped: (count: number, reasons: string) => string;
    tabsLabel: string;
    tabTeach: string;
    tabTest: string;
    tabCheck: string;
    tabMaintain: string;
    diagnosticsTitle: string;
    diagnosticsHint: string;
    diagnosticsCta: string;
    diagnosticsCopied: string;
    diagnosticsShow: string;
    diagnosticsHide: string;
    diagnosticsManualHint: string;
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
    /** Which surface is rendering — stamped into the diagnostics export, because the two
     *  hosts fail differently and "which one was this?" is the first question asked of a
     *  pasted report. Default 'web'. */
    host?: EvermindHost;
}
declare function EvermindConsole({ adapter, canManage, labels, refreshMs, projectName, showRecent, showHeaderRefresh, refreshSignal, onValidate, host }: EvermindConsoleProps): react__default.JSX.Element;

/**
 * The Evermind console's REST adapter — ONE implementation of the gateway calls behind
 * {@link EvermindConsoleAdapter}, for every host that talks to `/api/projects/:id/evermind/*`
 * with an authenticated `request` (the VS Code sidebar's bearer fetch, Synapse's signed-in
 * session). Before this, the VS Code webview held the only copy inline, and a second host
 * would have had to restate every path, method and response unwrap beside it.
 *
 * What genuinely differs per host is injected: how an authenticated call is made, and the
 * host-only powers — a clipboard the host owns, and reading/compacting a LOCAL memory
 * source for "Import from builderforce-memory" (only hosts with a filesystem have one).
 *
 * Also here: which of the tenant's IDE builds ARE Everminds, and which one a host opens on
 * — the build picker's rules, so the two desktop surfaces pick the same model.
 */

/**
 * An authenticated JSON call, relative to the gateway origin. Throws on a non-2xx.
 * `expectedErrors` names the statuses the console reports itself (a refused probe, a
 * paid-only analysis): a host with a global error surface keeps those off it; a host
 * without one ignores the field.
 */
type EvermindRequest = <T>(path: string, init?: {
    method?: string;
    body?: string;
    expectedErrors?: number[];
}) => Promise<T>;
/**
 * What a host read from its local memory source for an import: the learnable entries,
 * each tagged with the source it came from. A JSON snapshot yields one shared `path`; a
 * Claude Code memory FOLDER yields one path per fact; a store with no files of its own
 * (Synapse's memory server) leaves `path` off every entry and the import falls back to
 * the picked `path`. `null` = the person cancelled.
 */
interface PickedMemory {
    path: string;
    fileName: string;
    entries: Array<{
        key: string;
        text: string;
        prompt?: string;
        path?: string;
    }>;
}
/** The absorbed keys to compact, grouped by the source each came from. */
interface MemoryCompactRequest {
    files: Array<{
        path: string;
        absorbedKeys: string[];
    }>;
    version: number;
}
/** Host powers the gateway cannot supply. Every one is optional; the console hides what is absent. */
interface EvermindHostPowers {
    /** Write to the host's clipboard (the diagnostics export). */
    copyText?(text: string): Promise<void>;
    /** Import step 1 — pick and read a local memory source. */
    pickMemory?(): Promise<PickedMemory | null>;
    /** Import step 3 — rewrite the absorbed entries to stubs where they live. */
    compactMemory?(req: MemoryCompactRequest): Promise<{
        compacted: number;
        bytesSaved: number;
    }>;
}
interface EvermindRestOptions extends EvermindHostPowers {
    /** How this host makes an authenticated JSON call. */
    request: EvermindRequest;
    /** The Evermind's BACKING storage project — the id `/api/projects/:id/evermind` operates on. */
    projectId: number;
}
/** A tenant model row as `GET /api/llm/models` lists it. */
interface TenantModelRow {
    slug?: string;
    name?: string;
    baseModel?: string | null;
}
/** The tenant's PUBLISHED Evermind models — rows pinned to `evermind/<ref>`. */
declare function publishedEvermindModels(rows: readonly TenantModelRow[] | undefined): EvermindSeedModel[];
/** The `GET /llm/v1/models` fields the teacher rule reads. */
interface TeacherModelsPayload {
    /** The server's unified frontier-access rule (superadmin || override || connected BYO || paid). */
    canUseFrontierModels?: boolean;
    /** Teacher-eligible frontier models: the tenant's own connected models plus funded coders. */
    teacherModels?: string[];
    /** Older payloads: the plan's coding pool. */
    codingModels?: string[];
}
/**
 * Who may pin a frontier teacher, and which models they may pick — ONE rule for every
 * console host. Unlocked by the server's frontier-access verdict (so a BYO or superadmin
 * tenant is never shown a false paid-only wall), or by a paid plan snapshot, which fails
 * closed when the models payload does not carry the verdict.
 */
declare function resolveTeacherOptions(models: TeacherModelsPayload | null | undefined, plan: PlanTier | null | undefined): EvermindTeacherOptions;
/** The plan snapshot fields the paid-plan rule reads (`GET /api/consumption`). */
interface PlanTier {
    plan?: {
        effective?: string;
    } | null;
}
/**
 * Is this workspace on a PAID tier? The one rule, read off the `/api/consumption` plan
 * snapshot — never off `GET /llm/v1/models`, whose `premium` is the superadmin override
 * flag and whose `effectivePlan` degrades to `'free'` when auth blips. Fails CLOSED: an
 * unreadable plan is not a paid one.
 */
declare function planIsPaid(snapshot: PlanTier | null | undefined): boolean;
declare function createEvermindRestAdapter(opts: EvermindRestOptions): EvermindConsoleAdapter;
/** The gateway answers with absorbed KEYS; hosts compact per SOURCE — regroup by path. */
declare function groupAbsorbed(picked: PickedMemory, absorbed: readonly string[]): MemoryCompactRequest['files'];
/** One IDE build (`GET /api/ide-projects`). An Evermind build's model lives on its backing
 *  `storageProjectId`; `containerProjectId` is the Project it is grouped under. */
interface EvermindBuild {
    id: number;
    name: string;
    modality: string;
    storageProjectId: number;
    containerProjectId: number | null;
    containerName: string | null;
}
/** The tenant's Evermind builds: the `evermind` modality, plus legacy `llm` (the retired
 *  combined modality, whose builds are Evermind projects). */
declare function loadEvermindBuilds(request: EvermindRequest): Promise<EvermindBuild[]>;
/**
 * Which build to open on, as its storage project id: a still-valid current choice first;
 * then the Evermind the server resolves for the active Project (its head names the build
 * it reads from); then any build grouped under that Project; then the first.
 */
declare function preferredEvermindBuild(builds: readonly EvermindBuild[], pick?: {
    current?: number | null;
    resolvedProjectId?: number | null;
    activeProjectId?: number | null;
}): number | null;

declare function evermindLabelsFromBundle(bundle: Readonly<Record<string, string>>, prefix?: string): Partial<EvermindConsoleLabels>;

/**
 * Derive what a learned-memory row should SAY about its own provenance — the single
 * source of truth shared by the web console's recent list and the frontend's
 * <EvermindLearnings> detail panel, so the two can never disagree about whether a
 * teach-a-task actually learned anything.
 *
 * The distinction that matters: a "Taught" row is only meaningful when a frontier
 * TEACHER answered the task and the SSM learned that answer. When a pinned teacher
 * produces nothing, the coordinator falls back to adapting on the raw input — which,
 * for a teach-a-task, IS the question. Presenting that as "Learned" makes the model
 * look like it echoed the question back as its own answer. This helper is what turns
 * that silent fallback into a visible, named fault.
 */
/** Why distillation didn't happen. Mirrors the API's `RecordedSkipReason`: every reason
 *  a live merge can emit, plus the two buckets its legacy-provenance backfill writes —
 *  `legacy` (no teacher evidence either way) and `unknown` (provably a fault, cause not
 *  nameable). Keep in lockstep with `api/src/application/llm/evermindTeacher.ts`. */
type EvermindTeacherSkipReason = 'not_pinned' | 'budget_exhausted' | 'cooling' | 'unroutable' | 'input_too_short' | 'gateway_error' | 'empty_output' | 'exception' | 'legacy' | 'unknown';
/** The provenance verdict for one learned memory. */
type EvermindLearnedStatus = 
/** A pre-diffed weight delta — no text provenance to report. */
{
    state: 'delta';
}
/** A frontier teacher answered and the model learned that answer. The good path. */
 | {
    state: 'distilled';
    teacherModel?: string;
}
/** No teacher pinned: the model self-learned from real run output. Normal, not a fault. */
 | {
    state: 'self';
}
/** A teacher WAS pinned but produced nothing — actionable, surfaced as a warning. */
 | {
    state: 'fault';
    reason: EvermindTeacherSkipReason;
    teacherModel?: string;
    detail?: string;
};
/** The subset of a recent entry this verdict reads (structural, so both hosts' entry
 *  types satisfy it without importing each other). */
interface LearnedStatusInput {
    kind: 'text' | 'delta';
    prompt?: string;
    text?: string;
    distilled?: boolean;
    teacherModel?: string;
    skipReason?: string;
    skipDetail?: string;
    attemptedTeacherModel?: string;
}
declare function evermindLearnedStatus(entry: LearnedStatusInput): EvermindLearnedStatus;

type EvermindActionId = 'seed' | 'test' | 'enable' | 'teacher' | 'check' | 'learn' | 'merge' | 'none';
interface EvermindActionGuideInput {
    seeded: boolean;
    inferenceEnabled: boolean;
    mode: 'connected' | 'offline-frozen';
    pending?: number;
    teacherModel?: string | null;
    quarantinedAt?: string | null;
    recent?: LearnedStatusInput[];
    eval?: {
        delta: number;
    } | null;
    probe?: {
        ready: boolean;
    } | null;
}
interface EvermindNextAction {
    id: EvermindActionId;
    tone: 'good' | 'attention' | 'danger' | 'neutral';
    title: string;
    detail: string;
    destination: string;
    cta: string;
}
/** One state-to-action decision shared by every Evermind surface. */
declare function evermindNextAction(input: EvermindActionGuideInput): EvermindNextAction;

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
declare function Project360View({ data, loading, error, labels, onAction, onRefresh }: Project360ViewProps): react.JSX.Element;

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
declare function Sunburst({ pillars, dimensions, overall, selected, onSelect, ariaLabel }: SunburstProps): react.JSX.Element;

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
declare function ProjectListView({ title, subtitle, data, loading, error, labels, onAction, onRefresh }: ProjectListViewProps): react.JSX.Element;

/**
 * The workspace's plan + month-to-date meters + 30-day spend & savings
 * (`GET /api/consumption`), read through ONE shared cache per page.
 *
 * React-free on purpose: the editor's headless diagnostics probe reads the same
 * snapshot as the Status tab, and it must come from this cache rather than a second
 * fetch that could report something different. Every mounted reader (the Status tab,
 * a plan chip, a diagnostics copy) shares one request: the server caches the snapshot
 * for 60s, so this mirrors that TTL and coalesces concurrent callers.
 */

/** The host's authenticated JSON GET, as a port (web `apiRequest`, webview `authedFetch`, Rovr `api.request`). */
type JsonRequest = <T>(path: string) => Promise<T>;
type ConsumptionSnapshot = ChatDiagnosticsPlanSnapshot;
declare function fetchConsumptionSnapshot(request: JsonRequest, forceRefresh?: boolean): Promise<ConsumptionSnapshot | null>;
/** Drop the cached snapshot — after an upgrade click, the person may return on another tier. */
declare function invalidateConsumptionSnapshot(): void;
/** The warm snapshot, if any — what a subscriber renders before its first fetch resolves. */
declare function cachedConsumptionSnapshot(): ConsumptionSnapshot | null;
/** Hear every fresh snapshot (so two readers never show two different plans). */
declare function subscribeConsumptionSnapshot(listener: (s: ConsumptionSnapshot | null) => void): () => void;

/**
 * The copy of the `/` menu's Status tab — account, usage meters, Evermind. Hosts pass a
 * localized bundle; English defaults keep it readable unmapped. Placeholders:
 * `{version}`, `{used}`, `{limit}`, `{unit}`.
 *
 * Meter names are keyed by the server's meter key, so a new meter shows its own name
 * the moment a host maps it — and an unmapped key still reads as words, never as a
 * raw `snake_case` id.
 */

interface WorkStatusLabels {
    loading: string;
    account: string;
    plan: string;
    resets: string;
    /** Beside the plan when every limit is lifted for a superadmin operator. */
    limitsLifted: string;
    limitsLiftedHint: string;
    usage: string;
    usageEmpty: string;
    unlimited: string;
    /** "{used} / {limit} {unit}". */
    meterOf: string;
    upgrade: string;
    managePlan: string;
    /** Billing states other than active, by key. */
    billing: Record<string, string>;
    /** Plan tiers, by key. */
    plans: Record<string, string>;
    meters: Record<string, string>;
    units: Record<string, string>;
    evermind: string;
    /** "v{version}". */
    evermindVersion: string;
    evermindLearning: string;
    evermindFrozen: string;
    evermindAnswersOn: string;
    evermindAnswersOff: string;
    evermindHint: string;
}
declare const DEFAULT_WORK_STATUS_LABELS: WorkStatusLabels;
declare function workStatusLabels(overrides?: Partial<WorkStatusLabels>): WorkStatusLabels;
/**
 * THE Status tab copy from a host catalog — the ONE key table every host reads it
 * through: each field by name, and the keyed records as `billing.<state>`,
 * `plans.<tier>`, `meters.<meterKey>` and `units.<unit>` (the server's own keys). A key
 * the catalog lacks keeps the English default; `{used}`/`{limit}`/`{unit}`/`{version}`
 * must come back literal — the panel fills them.
 */
declare function workStatusLabelsFrom(lookup: LabelLookup): WorkStatusLabels;

type UpgradeTarget = 'pricing' | 'billing';

/**
 * The port the composer's "Connected accounts" section reads and acts through, and its copy.
 *
 * The port is STRUCTURAL: `@builderforce/provider-connect`'s `createProviderConnectionsClient`
 * satisfies it, and each host builds one over its own authenticated gateway call. This
 * package is published and cannot depend on that private one, so the shapes are restated
 * here — only the fields the section reads.
 */

type ConnectionHealth = 'ok' | 'capacity' | 'not_entitled' | 'rejected' | 'unresolved';
interface ProviderConnection {
    provider: string;
    label: string;
    authType: 'oauth' | 'api_key';
    health: ConnectionHealth;
    reconnectable: boolean;
}
interface ProviderConnectStart {
    grant: 'device' | 'paste';
    authorizeUrl: string;
    state: string;
    userCode: string | null;
    intervalMs: number;
}
/**
 * Error contract: a rejected `start`, `completePaste` or `awaitDevice` carries
 * `{ reason: 'unavailable' | 'denied' | 'expired' | 'cancelled' | 'failed', detail?: string }`
 * (provider-connect's `ProviderConnectError`); anything else reads as `failed`.
 */
interface ProviderConnectionsPort {
    /** `null` ⇒ the gateway refused this caller the list (403) — the section says so. */
    list(): Promise<ProviderConnection[] | null>;
    /** `health` is null when the probe could not say (no verdict persisted) — the row keeps its own. */
    test(provider: string): Promise<{
        ok: boolean;
        health: ConnectionHealth | null;
        message: string | null;
    }>;
    start(provider: string): Promise<ProviderConnectStart>;
    completePaste(provider: string, code: string, state: string): Promise<void>;
    awaitDevice(provider: string, start: ProviderConnectStart, signal: AbortSignal): Promise<void>;
}
/** What the section needs from its host: the port, and where an authorize page opens. */
interface ComposerConnections {
    client: ProviderConnectionsPort;
    /** Open the provider's sign-in page outside the panel (a browser tab). */
    openUrl: (url: string) => void;
}
interface ConnectionsLabels {
    heading: string;
    empty: string;
    loadFailed: string;
    /** The gateway refused this caller the list. */
    unavailable: string;
    authOauth: string;
    authApiKey: string;
    healthOk: string;
    healthCapacity: string;
    healthNotEntitled: string;
    healthRejected: string;
    healthUnresolved: string;
    test: string;
    testing: string;
    testOk: string;
    reconnect: string;
    pasteHint: string;
    pastePlaceholder: string;
    finish: string;
    finishing: string;
    cancel: string;
    /** "{code}" — the device code the provider's page shows. */
    deviceHint: string;
    reconnected: string;
    errDenied: string;
    errExpired: string;
    errStart: string;
    errFailed: string;
}
declare const DEFAULT_CONNECTIONS_LABELS: ConnectionsLabels;
/** THE section's copy from a host catalog — canonical keys are the field names; `{code}` must come back literal. */
declare function connectionsLabelsFrom(lookup: LabelLookup): ConnectionsLabels;

/**
 * The copy of the shared composer — the prompt box, its `+` menu, its trailing button,
 * and the descriptions the `/` menu's rows state their REAL effect with. Hosts pass a
 * localized bundle (next-intl on the web, `vscode.l10n` in the editor, `chrome.i18n` in
 * Rovr); English defaults keep it usable unmapped.
 *
 * Parameterised copy is a FUNCTION, not a template: each host's i18n formats numbers
 * its own way (ICU plurals on the web, `{0}` in the editor), so the host renders the
 * sentence and the composer supplies the figure.
 */

interface ComposerLabels {
    placeholder: string;
    add: string;
    upload: string;
    uploading: string;
    addContext: string;
    browseWeb: string;
    on: string;
    off: string;
    remove: string;
    send: string;
    /** Send while a run streams queues the message behind it — its name says so. (A host
     *  whose Send STEERS the run words it so; its queue is then {@link queueAfter}.) */
    queueSend: string;
    /** The "Queue for after" button beside Send mid-run — `keys` is the platform's
     *  shortcut (`Alt+Enter`, `⌥+Enter` on macOS). */
    queueAfter: (keys: string) => string;
    /** Its short visible text (hidden at narrow widths, where the icon stands alone). */
    queueAfterShort: string;
    stop: string;
    dictate: string;
    stopDictation: string;
    /** Chat | Work, and what each one does. */
    modeLabel: (mode: ChatMode) => string;
    modeHint: (mode: ChatMode) => string;
    memoryOnHint: string;
    memoryOffHint: string;
    /** Why the Memory switch gates nothing (no project behind the chat). */
    memoryUnavailable: string;
    autoModeHint: string;
    /** What an Effort level really costs — its answer budget. */
    effortDesc: (level: Effort, answerTokens: number) => string;
    /** Appended to an Effort description while Thinking is on. */
    effortThinkingSuffix: (thinkingTokens: number) => string;
    thinkingOnDesc: (budgetTokens: number) => string;
    thinkingOffDesc: string;
    /** The context meter's tooltip when the model's window is known — `{used}`, `{limit}`
     *  (tokens) and `{percent}` (with its sign), all formatted by the meter. */
    contextMeterHint: string;
    /** …and when it is not — `{used}` only. */
    contextMeterHintTokens: string;
}
declare const DEFAULT_COMPOSER_LABELS: ComposerLabels;
declare function composerLabels(overrides?: Partial<ComposerLabels>): ComposerLabels;
/**
 * THE composer copy from a host catalog — the ONE key table every host reads it
 * through. Canonical keys are the field names; the per-choice ones are
 * `modeLabel.<mode>`, `modeHint.<mode>` and `effortDesc.<level>` (figure `answer`),
 * plus `effortThinkingSuffix` (`thinking`) and `thinkingOnDesc` (`budget`). A key the
 * catalog lacks keeps the English default. `overrides` is for copy a host words from
 * another source on purpose (the web's chat-mode vocabulary).
 */
declare function composerLabelsFrom(lookup: LabelLookup, overrides?: Partial<ComposerLabels>): ComposerLabels;

interface ComposerAddMenuItem {
    id: string;
    icon: ReactNode;
    label: string;
    onSelect: () => void;
}

interface ComposerAttachment {
    key: string;
    name: string;
    /** A thumbnail for an image. */
    imageUrl?: string;
}

/**
 * The composer's run-shaping state, as ONE contract every host fills — and the ONE
 * builder that turns it into the `/` menu's grouped sections.
 *
 * Before this each host built the mode choices, the Memory row's wording and the
 * Effort/Thinking descriptions itself (the web in `ComposerOptionsMenu`, the editor
 * inline in its chat surface), so the same row said different things on each surface.
 * Hosts now hand over plain state and their copy; this builds the rest.
 */

interface ComposerOptions {
    /** Chat | Work for this conversation. */
    mode?: {
        value: ChatMode;
        onChange: (mode: ChatMode) => void;
    };
    /** The per-chat Memory switch (`brain_chats.memory_enabled`). `available: false` when
     *  no project memory stands behind the chat — the row shows, inert, and says why. */
    memory?: {
        enabled: boolean;
        onChange: (on: boolean) => void;
        available: boolean;
    };
    /** `minAnswerTokens`: the host's own answer ceiling when it never sends less than that
     *  (the canvas's 3,200), so a level's copy states the budget the request really carries. */
    effort?: {
        value: Effort;
        onChange: (effort: Effort) => void;
        minAnswerTokens?: number;
    };
    thinking?: {
        value: boolean;
        onChange: (on: boolean) => void;
    };
    model?: PromptOptionsModel;
    /** Where models run (Hybrid · Local only · Specific). `needsChoice` holds the next turn
     *  behind the first-run question. */
    inferenceMode?: PromptOptionsInferenceMode;
    /** Open the `/` menu on a tab (a remedy sending the person to the Model tab). */
    openMenu?: PromptOptionsOpenRequest;
    autoMode?: {
        enabled: boolean;
        onChange: (on: boolean) => void;
    };
    session?: PromptOptionsSession;
}

interface BrainComposerLabels {
    composer?: Partial<ComposerLabels>;
    options?: Partial<PromptOptionsLabels>;
    status?: Partial<WorkStatusLabels>;
    spend?: Partial<SpendLabels>;
    connections?: Partial<ConnectionsLabels>;
    mention?: UseMentionAutocompleteOptions['labels'];
    ticket?: UseTicketAutocompleteOptions['labels'];
}
interface BrainComposerProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** A run is streaming: Send queues behind it, an empty box offers Stop. */
    running?: boolean;
    onStop?: () => void;
    /**
     * The explicit "Queue for after" while a run is going (Alt+Enter), for a host whose
     * Send STEERS the running turn instead of queueing behind it. Omitted ⇒ Alt+Enter sends.
     */
    onQueue?: () => void;
    disabled?: boolean;
    /** Why the box is closed to input (an exam in progress, …) — shown above it. */
    blockedNotice?: ReactNode;
    placeholder?: string;
    ariaLabel?: string;
    rows?: number;
    submitOnEnter?: boolean;
    /** Bump to focus the box and put the caret at the end (a seeded prompt). */
    focusToken?: number;
    /** Run shaping for the `/` Work panel. */
    options: ComposerOptions;
    /** The Status tab's data port; omit on a surface with no account behind it (a guest). */
    account?: {
        request: JsonRequest;
        projectId: number | null;
        locale?: string;
        onUpgrade?: (target: UpgradeTarget) => void;
        /** The workspace's connected provider accounts — shown under the Status tab with Test
         *  and Reconnect. Omit on a surface that cannot open a sign-in page. */
        connections?: ComposerConnections;
    };
    onAccountSettings?: () => void;
    attachments?: {
        items: readonly ComposerAttachment[];
        onAdd: (files: File[]) => void;
        onRemove: (key: string) => void;
        uploading?: boolean;
        accept?: string;
    };
    onAddContext?: () => void;
    webBrowsing?: {
        on: boolean;
        onChange: (on: boolean) => void;
    };
    addMenuItems?: readonly ComposerAddMenuItem[];
    mentions?: Pick<UseMentionAutocompleteOptions, 'participants' | 'onPick'>;
    tickets?: Pick<UseTicketAutocompleteOptions, 'tickets' | 'onPick'>;
    /** Close the @-mention and #-ticket pickers while the box stays open (e.g. mid-run
     *  with nobody else to address). Always closed while `disabled`. */
    pickersDisabled?: boolean;
    /** Offer dictation in the trailing slot when the runtime can listen. */
    voice?: boolean;
    /** Who answers / who is addressed — rides the tool row after `+` and `/`. */
    context?: ReactNode;
    /** How full the model's context was on the last turn (`contextUsageOf`) — the meter
     *  after `context`. Omitted or null ⇒ no meter. */
    contextUsage?: ContextUsage | null;
    /** Shown above the text (queued turns, starters). */
    above?: ReactNode;
    /**
     * Fixed next steps as chips (never a model call). The composer decides WHEN: only over
     * an empty box with no turn running — so every host shows them the same way.
     */
    suggestions?: {
        items: readonly ComposerSuggestion[];
        label: string;
    };
    /** Shown under the box (a queued-turns receipt, a secondary link). */
    below?: ReactNode;
    /**
     * The first-run gate, when the HOST owns it (`useInferenceModeGate`) because it also
     * starts turns itself — the guest panel's landing prompt. The question then shows here
     * for either kind of send. Omit and the composer keeps its own.
     */
    modeGate?: InferenceModeGate;
    labels?: BrainComposerLabels;
    className?: string;
}
declare function BrainComposer(props: BrainComposerProps): react.JSX.Element;

/**
 * The per-chat Memory switch, as a property of the CONVERSATION (`brain_chats.
 * memory_enabled`) rather than of a browser. It lived in localStorage under a different
 * key on each surface, so the same chat was "on" in the editor and "off" on the web, and
 * the server — and the editor's own memory tools — never knew.
 *
 * Optimistic: the switch moves on the click; a failed save puts it back.
 *
 * `serverValue` is what the host's chat record says (absent ⇒ on, the column default);
 * `persist` writes it the host's way (a PATCH on the web and in the editor, the device
 * record in Rovr). A chat that does not exist yet keeps the choice locally and the host
 * seeds the chat it creates with it.
 */
declare function useChatMemorySwitch(opts: {
    chatId: number | null;
    serverValue: boolean | null | undefined;
    persist: (chatId: number, on: boolean) => Promise<unknown>;
}): {
    enabled: boolean;
    setEnabled: (on: boolean) => void;
};

interface WorkStatusPanelProps {
    request: JsonRequest;
    projectId: number | null;
    labels?: Partial<WorkStatusLabels>;
    locale?: string;
    onUpgrade?: (target: UpgradeTarget) => void;
}
declare function WorkStatusPanel({ request, projectId, labels: overrides, locale, onUpgrade }: WorkStatusPanelProps): react.JSX.Element;

interface ConnectionsPanelProps {
    connections: ComposerConnections;
    labels?: Partial<ConnectionsLabels>;
}
declare function ConnectionsPanel({ connections, labels: overrides }: ConnectionsPanelProps): react.JSX.Element;

/**
 * THE subscription reconnect, as a state machine every surface drives the same way: start
 * the gateway's connect, open the provider's page, then either take the pasted code
 * (`paste` grant) or wait for the approval (`device` grant).
 *
 * It lives OUTSIDE React, one flow per (client, provider), because the surfaces that show
 * it come and go mid-connect: the composer's `/` menu closes on any click outside it, and
 * a device approval happens in another tab. A flow owned by the row would be aborted the
 * moment the person clicked back into the chat — an approved Kimi grant would then never
 * be redeemed (the server stores it only when a poll sees the approval). Here the wait
 * runs to its end, and a reopened menu shows the flow where it is.
 *
 * Every await is fenced by a generation number, so a cancelled or superseded flow's late
 * answer can never land on the flow that replaced it.
 */

type ReconnectPhase = 'idle' | 'starting' | 'paste' | 'device' | 'finishing';
type ReconnectFailureReason = 'unavailable' | 'denied' | 'expired' | 'failed';
interface ReconnectFailure {
    reason: ReconnectFailureReason;
    /** The gateway's own sentence, when it gave one. */
    detail: string | null;
}

interface ProviderReconnect {
    phase: ReconnectPhase;
    userCode: string | null;
    code: string;
    setCode: (code: string) => void;
    failure: ReconnectFailure | null;
    /** Resolves true once the connection is stored. */
    start: () => Promise<boolean>;
    finish: () => Promise<void>;
    cancel: () => void;
}
declare function useProviderReconnect(client: Pick<ProviderConnectionsPort, 'start' | 'completePaste' | 'awaitDevice'>, provider: string, { openUrl, onConnected }: {
    openUrl: (url: string) => void;
    onConnected?: () => void;
}): ProviderReconnect;

interface WorkSpendPanelProps {
    request: JsonRequest;
    labels?: Partial<SpendLabels>;
    /** Shown while the snapshot loads. */
    loadingLabel: string;
    locale?: string;
}
declare function WorkSpendPanel({ request, labels: overrides, loadingLabel, locale }: WorkSpendPanelProps): react.JSX.Element;

/** Subscribe a component to the shared consumption snapshot (one fetch per page). */
declare function useConsumptionSnapshot(request: JsonRequest | null): ConsumptionSnapshot | null;

interface SpendPillProps {
    summary: SpendSavingsSummary | null | undefined;
    labels?: Partial<SpendLabels>;
    locale?: string;
}
declare function SpendPill({ summary, labels: overrides, locale }: SpendPillProps): react.JSX.Element | null;

interface SpendBreakdownProps {
    summary: SpendSavingsSummary;
    labels: SpendLabels;
    locale?: string;
}
declare function SpendBreakdown({ summary, labels, locale }: SpendBreakdownProps): react.JSX.Element;

/**
 * Number formatting for the spend readouts — locale-aware (`Intl`), and honest at the
 * small end: a conversation that cost a fifth of a cent reads "<$0.01", never "$0.00",
 * which would claim it was free.
 */
declare function formatUsd(usd: number, locale?: string): string;
declare function formatTokens(tokens: number, locale?: string): string;

/**
 * Everything `BrainComposer` renders — the box, the `/` menu, its Status tab, the spend
 * readouts and the @/# pickers — from ONE host lookup, through each part's own key
 * table. Canonical keys are scoped by part: `composer.<key>`, `options.<key>`,
 * `status.<key>`, `spend.<key>`, `connections.<key>`, `mention.<key>` and `ticket.<key>`, each `<key>` being
 * that part's own canonical key (see `composerLabelsFrom`, `promptOptionsLabelsFrom`,
 * `workStatusLabelsFrom`, `spendLabelsFrom`). Every host — the web (next-intl), the
 * editor webview (`vscode.l10n` bundle) and Rovr (`chrome.i18n`) — builds its composer
 * copy here and only maps those keys onto its own catalog.
 */

interface FullBrainComposerLabels {
    composer: ComposerLabels;
    options: PromptOptionsLabels;
    status: WorkStatusLabels;
    spend: SpendLabels;
    connections: ConnectionsLabels;
    mention: Required<MentionLabels>;
    ticket: Required<TicketAutocompleteLabels>;
}
/** `overrides`: copy a host words from another source on purpose (e.g. the web's
 *  chat-mode vocabulary for `composer.modeLabel`). */
declare function brainComposerLabelsFrom(lookup: LabelLookup, overrides?: {
    composer?: Partial<ComposerLabels>;
    options?: Partial<PromptOptionsLabels>;
}): FullBrainComposerLabels;

/**
 * The `/` menu's Model section from a host's catalogue — the ONE place every host turns
 * "the models I could read, the user's choice, and where on-device models live" into
 * `ComposerOptions.model`.
 *
 * Fetching stays the host's own (the web's `useChatModelOptions`, brain-embedded's
 * `loadGatewayModelOptions` for the editor webview and Rovr); what each did again on top —
 * falling back to the ONE empty catalogue, merging this machine's models in, deciding
 * whether entitlement is still unknown, and reconstructing the choice from a pin — is
 * here, once.
 */

/** What a host read: the menu's grouped models and who is reading. `surface` etc. ride along. */
interface ComposerModelCatalog {
    options: ChatModelOptions;
    identity?: ModelIdentityContext;
}
/**
 * True once a REAL catalogue is in hand. Not yet read, or a failed read (which resolves
 * to brain-embedded's `EMPTY_GATEWAY_MODEL_OPTIONS`), both leave entitlement UNKNOWN —
 * the menu must not claim the plan forbids choosing.
 */
declare function composerCatalogLoaded(catalog: ComposerModelCatalog | null | undefined): boolean;
/**
 * The catalogue the menu lists: what the host read (or the ONE empty shape while there
 * is none) plus models a runtime on this machine serves. A merge, not another fetch —
 * the gateway cannot know them, and they matter most exactly when it is unreadable.
 */
declare function withLocalModels<C extends ComposerModelCatalog>(catalog: C | null | undefined, local: ChatModelOptions['local'] | null | undefined): C;
/** The user's choice from what the host holds: a strict pin, the BYO pool, else auto. */
declare function modelSelectionFrom(pin: {
    model?: string | null;
    strict?: boolean;
    routingMode?: string | null;
}): ChatModelSelection;
interface ComposerModelInput {
    catalog: ComposerModelCatalog | null | undefined;
    selection: ChatModelSelection;
    onChange: (selection: ChatModelSelection) => void;
    /** This machine's runtime-served models, merged into the catalogue. */
    local?: ChatModelOptions['local'] | null;
    /** What auto will actually send. */
    effective?: string;
    /** Who is reading while no catalogue is in hand (e.g. the plan from the consumption snapshot). */
    fallbackIdentity?: ModelIdentityContext;
    localStore?: PromptOptionsModel['localStore'];
    /** Whether entitlement is still unknown; defaults to "no real catalogue yet". */
    identityPending?: boolean;
    /** `false` on a host that cannot carry the BYO pool route (`ChatModelOptions.byoPool`). */
    byoPool?: boolean;
}
/** `ComposerOptions.model` for one host. Pure — memoize on its inputs. */
declare function composerModel(input: ComposerModelInput): PromptOptionsModel;

export { type AgentOptionVM, AiSurface, type AiSurfaceProps, type AskUserLabels, Avatar, type AvatarProps, BrainComposer, type BrainComposerLabels, type BrainComposerProps, BrainMark, type BrainMarkProps, BrainTimeline, type BrainTimelineLabels, type BrainTimelineProps, type BuildTimelineInput, type ChatAgentVM, type ChatDiagnosticsChatReads, type ChatDiagnosticsReadAdapter, ChatErrorBanner, type ChatErrorBannerLabels, type ChatErrorBannerProps, type ChatHistoryChat, type ChatHistoryLabels, ChatHistoryList, type ChatHistoryListProps, ChatHistoryRow, type ChatHistoryRowProps, type ChatOptionVM, type ChatRowActionProps, type ChatRowActions, type ChatRowRef, type ChatRunHistoryVM, type ChatRunVM, type ChatSubagentVM, type ChatTicketsAdapter, type ChatTicketsExtension, type ChatTicketsLabels, ChatTicketsPanel, type ChatTicketsPanelProps, type ChatTicketsRequest, type ChatTicketsRestOptions, type CommandRun, type ComposerAddMenuItem, type ComposerAttachment, type ComposerConnections, type ComposerLabels, type ComposerModelCatalog, type ComposerModelInput, type ComposerOptions, type ComposerSuggestion, type ConnectionHealth, type ConnectionsLabels, ConnectionsPanel, type ConnectionsPanelProps, type ConsumptionSnapshot, ContextChip, type ContextChipOption, type ContextChipProps, CopyButton, type CopyLabels, DEFAULT_ASK_USER_LABELS, DEFAULT_CHAT_ERROR_LABELS, DEFAULT_CHAT_HISTORY_LABELS, DEFAULT_CHAT_TICKETS_LABELS, DEFAULT_COMPOSER_LABELS, DEFAULT_CONNECTIONS_LABELS, DEFAULT_EVERMIND_LABELS, DEFAULT_INFERENCE_MODE_LABELS, DEFAULT_INLINE_CHAT_TITLE_LABELS, DEFAULT_LIVE_ACTIVITY_LABELS, DEFAULT_LOCAL_MODEL_LABELS, DEFAULT_MENTION_LABELS, DEFAULT_MODEL_FALLBACK_LABELS, DEFAULT_MODEL_MOVE_LABELS, DEFAULT_PENDING_CHANGES_LABELS, DEFAULT_PERSONA_PICKER_LABELS, DEFAULT_PROJECT360_LABELS, DEFAULT_PROJECT_LIST_LABELS, DEFAULT_PROMPT_OPTIONS_LABELS, DEFAULT_QUEUED_TURN_LABELS, DEFAULT_RECIPIENT_PICKER_LABELS, DEFAULT_SPEND_LABELS, DEFAULT_SURFACE_HEADER_LABELS, DEFAULT_TICKET_TAG_LABELS, DEFAULT_TIMELINE_LABELS, DEFAULT_TOOL_CONFIRM_LABELS, DEFAULT_WORK_STATUS_LABELS, EXPAND_ICON_PATH, type EvermindActionGuideInput, type EvermindActionId, type EvermindBuild, type EvermindCleanupResult, type EvermindCodingGateView, EvermindConsole, type EvermindConsoleAdapter, type EvermindConsoleData, type EvermindConsoleLabels, type EvermindConsoleProps, type EvermindContributionState, type EvermindContributionStatus, type EvermindEvalPoint, type EvermindHost, type EvermindHostPowers, type EvermindKnowledgeAnalysis, type EvermindKnowledgeFinding, type EvermindKnowledgeRepair, type EvermindKnowledgeVerdict, type EvermindLearnedStatus, type EvermindMode, type EvermindNextAction, type EvermindProbeResult, type EvermindProbeSample, type EvermindRecentEntry, type EvermindReindexResult, type EvermindRequest, type EvermindRestOptions, type EvermindSeedModel, type EvermindTarget, type EvermindTeachResult, type EvermindTeacherOptions, type EvermindTeacherSkipReason, type EvermindValidateMatch, type EvermindValidateResult, type FullBrainComposerLabels, HeaderIcon, HealthRing, type HealthRingProps, type HealthTier, INFERENCE_MODE_LABEL_FIELDS, InferenceModeControl, type InferenceModeControlProps, InferenceModeFirstRun, type InferenceModeFirstRunProps, type InferenceModeGate, type InferenceModeLabels, InlineChatTitle, type InlineChatTitleLabels, type InlineChatTitleProps, type JsonRequest, LOCAL_BACKEND_LABEL, LOCAL_MODEL_LABEL_FIELDS, LOCAL_UNSUPPORTED_LABEL, type LabelLookup, type LabelValues, type LearnedStatusInput, type LineageVM, type LinkType, LiveActivity, type LiveActivityLabels, type LiveActivityProps, type LocalModelLabelLookup, type LocalModelLabels, LocalModelList, type LocalModelListProps, LocalModelRow, type LocalModelRowProps, type LocalModelsState, Markdown, type MarkdownLabels, type MarkdownProps, type MemoryCompactRequest, type MentionAutocomplete, type MentionLabels, type MessageRating, ModelFallbackNotice, type ModelFallbackNoticeLabels, type ModelFallbackNoticeProps, type ModelMove, type ModelMoveLabels, type ModelRemedies, type ModelRemedyPorts, type PendingChangeKind, type PendingChangeVM, type PendingChangesLabels, PendingChangesList, type PendingChangesListProps, PendingQuestionBanner, type PersonaModalityOption, PersonaPicker, type PersonaPickerLabels, type PersonaPickerProps, type PickedMemory, type PlanTier, type Project360, type Project360Action, type Project360Dimension, type Project360Gap, type Project360Labels, type Project360Member, type Project360Pillar, Project360View, type Project360ViewProps, type ProjectListAction, type ProjectListBadge, type ProjectListGroup, type ProjectListItem, type ProjectListLabels, type ProjectListModel, type ProjectListTicketRef, type ProjectListTone, ProjectListView, type ProjectListViewProps, type PromptOptionsAutoMode, type PromptOptionsInferenceMode, type PromptOptionsLabels, type PromptOptionsMemory, PromptOptionsMenu, type PromptOptionsMenuProps, type PromptOptionsMode, type PromptOptionsModeChoice, type PromptOptionsModel, type PromptOptionsOpenRequest, type PromptOptionsSession, type PromptOptionsTab, PromptPanel, type PromptPanelProps, type PromptTrailingAction, type PromptTrailingState, type ProviderConnectStart, type ProviderConnection, type ProviderConnectionsPort, type ProviderReconnect, QuestionCard, QueuedTurnChips, type QueuedTurnChipsLabels, type QueuedTurnChipsProps, RUNNABLE_KINDS, RecipientPicker, type RecipientPickerLabels, type RecipientPickerProps, RecipientsBadge, type ReconnectFailure, type ReconnectFailureReason, type ReconnectPhase, type RovingRadioItemProps, SLOW_AFTER_MS, SpendBreakdown, type SpendLabels, SpendPill, StarterGroup, StarterTile, type StarterTileProps, SuggestionRow, Sunburst, type SunburstProps, SurfaceEmptyState, type SurfaceEmptyStateProps, SurfaceFooter, type SurfaceFooterProps, SurfaceHeader, type SurfaceHeaderHistory, type SurfaceHeaderLabels, type SurfaceHeaderProps, SurfaceLauncher, type SurfaceLauncherBadge, type SurfaceLauncherProps, type SurfaceTab, SurfaceTabs, type SurfaceTabsProps, TICKET_KINDS, type TeacherModelsPayload, type TenantModelRow, type TicketAutocomplete, type TicketAutocompleteLabels, type TicketKind, type TicketLinkVM, type TicketOptionVM, type TicketParentVM, type TimelineCatalogLookup, type TimelineImage, type TimelineNode, ToolConfirmBar, type ToolConfirmBarLabels, type ToolConfirmBarProps, type ToolPreview, ToolStep, type ToolStepLabels, type ToolStepNode, type ToolStepView, type UpgradeTarget, type UseChatRowActionsOptions, type UseMentionAutocompleteOptions, type UseTicketAutocompleteOptions, WorkSpendPanel, type WorkSpendPanelProps, type WorkStatusLabels, WorkStatusPanel, type WorkStatusPanelProps, attachmentsOf, avatarColor, brainComposerLabelsFrom, buildSettledTimeline, buildTimeline, bundleLookup, cachedConsumptionSnapshot, chatActivityLabelsFrom, chatDiagnosticsReads, chatErrorMessage, chatHistoryLabelsFrom, chatSwitcherLabel, chatTicketsLabelsFrom, chatTicketsLabelsFromBundle, commandOf, composerCatalogLoaded, composerLabels, composerLabelsFrom, composerModel, connectionsLabelsFrom, createChatTicketsRestAdapter, createEvermindRestAdapter, evermindLabelsFromBundle, evermindLearnedStatus, evermindNextAction, fetchConsumptionSnapshot, formatContextTokens, formatDownloadSize, formatDuration, formatElapsed, formatParams, formatTokens, formatUsd, groupAbsorbed, healthRingColor, inferenceModeCopy, inferenceModeOption, initialsOf, invalidateConsumptionSnapshot, liveActivityLabelsFrom, loadEvermindBuilds, localModelLabelsFrom, modelMoveLine, modelMoveOf, modelRemedies, modelSelectionFrom, pendingChangesSummary, planIsPaid, preferredEvermindBuild, promptOptionsLabels, promptOptionsLabelsFrom, promptTrailingAction, publishedEvermindModels, requestComposerMenu, resolvePendingChangesLabels, resolveTeacherOptions, rovingRadioNextIndex, shellOutcomeOf, spendLabels, spendLabelsFrom, strandedReplyKey, streamingNode, stringsFrom, subscribeConsumptionSnapshot, timelineCatalogLookup, timelineLabelsFrom, toolConfirmLabelsFrom, toolConfirmPreview, toolPreview, toolStepView, useChatActivitySignal, useChatMemorySwitch, useChatParticipants, useChatRowActions, useComposerMenuRequest, useConsumptionSnapshot, useDismissibleNotice, useInferenceModeGate, useLocalModels, useMentionAutocomplete, useModelFallback, usePopover, useProviderReconnect, useRecipientChoice, useRovingRadioGroup, useTicketAutocomplete, useVoiceDictation, withLocalModels, workStatusLabels, workStatusLabelsFrom };
