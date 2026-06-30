import React from 'react';
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
    emptyState?: React.ReactNode;
    /** Render a message's text. Defaults to the shared <Markdown>. The web app
     *  passes its richer ChatMessageBubble here so no feature is lost. */
    renderMessage?: (msg: BrainMessage, ctx: {
        role: 'user' | 'assistant';
        text: string;
    }) => React.ReactNode;
    /** Render the live streaming assistant bubble. Defaults to <Markdown>. */
    renderStreaming?: (text: string) => React.ReactNode;
    /** Per-assistant-message action row (copy / feedback / suggestions). */
    renderAssistantActions?: (msg: BrainMessage) => React.ReactNode;
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
declare function BrainTimeline({ messages, trace, streamingText, isRunning, loading, labels: labelOverrides, assistantName, emptyState, renderMessage, renderStreaming, renderAssistantActions, onInternalLink, onApplyCode, onCreateFile, autoScroll, }: BrainTimelineProps): React.JSX.Element;

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
declare function Markdown({ content, onInternalLink, onApplyCode, onCreateFile, labels }: MarkdownProps): React.JSX.Element;

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

export { BrainTimeline, type BrainTimelineLabels, type BrainTimelineProps, type BuildTimelineInput, DEFAULT_TIMELINE_LABELS, Markdown, type MarkdownLabels, type MarkdownProps, type TimelineImage, type TimelineNode, attachmentsOf, buildTimeline, formatDuration, formatPayload };
