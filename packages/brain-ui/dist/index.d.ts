import * as React from 'react';
import React__default from 'react';
import { BrainMessage, BrainTraceEvent, ChatInputAttachment } from '@seanhogg/builderforce-brain-embedded';

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
declare function BrainTimeline({ messages, trace, streamingText, isRunning, loading, labels: labelOverrides, assistantName, emptyState, renderMessage, renderStreaming, renderAssistantActions, onInternalLink, onApplyCode, onCreateFile, autoScroll, }: BrainTimelineProps): React__default.JSX.Element;

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
declare function Markdown({ content, onInternalLink, onApplyCode, onCreateFile, labels }: MarkdownProps): React__default.JSX.Element;

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

export { BrainTimeline, type BrainTimelineLabels, type BrainTimelineProps, type BuildTimelineInput, DEFAULT_PROJECT360_LABELS, DEFAULT_TIMELINE_LABELS, type HealthTier, Markdown, type MarkdownLabels, type MarkdownProps, type Project360, type Project360Action, type Project360Dimension, type Project360Gap, type Project360Labels, type Project360Member, type Project360Pillar, Project360View, type Project360ViewProps, Sunburst, type SunburstProps, type TimelineImage, type TimelineNode, attachmentsOf, buildTimeline, formatDuration, formatPayload };
