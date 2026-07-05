import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseDirectedRecipient, type BrainMessage, type BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { Markdown } from './Markdown';
import { Avatar } from './ParticipantBadge';
import { buildSettledTimeline, formatDuration, formatPayload, streamingNode, type TimelineNode } from './timelineModel';

export interface BrainTimelineLabels {
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

export const DEFAULT_TIMELINE_LABELS: BrainTimelineLabels = {
  thinking: 'Thinking…',
  thoughtFor: 'Thought for {duration}',
  you: 'You',
  assistant: 'BuilderForce',
  input: 'Input',
  output: 'Output',
  error: 'Error',
  loading: 'Loading…',
  empty: 'Ask BuilderForce to build or change something.',
  copy: 'Copy',
  copied: 'Copied',
  apply: 'Apply',
  createFile: 'Create file',
  preview: 'Preview',
};

export interface BrainTimelineProps {
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
  renderMessage?: (msg: BrainMessage, ctx: { role: 'user' | 'assistant'; text: string }) => React.ReactNode;
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

function dotIcon(kind: TimelineNode['kind'], isError?: boolean): string {
  if (isError) return '✗';
  switch (kind) {
    case 'user':
      return '›';
    case 'assistant':
      return '✦';
    case 'thinking':
      return '∴';
    case 'tool':
      return '⚙';
    case 'error':
      return '✗';
    default:
      return '•';
  }
}

/** Copy `text` to the clipboard, flashing a "Copied" confirmation. Shared by every
 *  copyable panel on a tool step (Input / Output / preview). */
function CopyButton({ text, labels }: { text: string; labels: BrainTimelineLabels }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="bf-tl__copy"
      title={labels.copy}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
    >
      {copied ? labels.copied : labels.copy}
    </button>
  );
}

type ToolPreview =
  | { kind: 'edit'; path: string; oldText: string; newText: string }
  | { kind: 'write'; path: string; content: string };

/** An edit_file / write_file tool call carries the change itself in its args, so we
 *  can render a readable preview (a before/after diff for edits, the new content for
 *  writes) instead of only the raw JSON — detected structurally so it works regardless
 *  of the tool's display label. */
function toolPreview(args: unknown): ToolPreview | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const path = typeof a.path === 'string' ? a.path : '';
  if (typeof a.old_string === 'string' && typeof a.new_string === 'string') {
    return { kind: 'edit', path, oldText: a.old_string, newText: a.new_string };
  }
  if (path && typeof a.content === 'string') {
    return { kind: 'write', path, content: a.content };
  }
  return null;
}

function DiffLines({ text, sign }: { text: string; sign: '+' | '-' }) {
  const cls = sign === '+' ? 'bf-tl__diff-add' : 'bf-tl__diff-del';
  return (
    <>
      {text.split('\n').map((line, i) => (
        <div key={i} className={`bf-tl__diff-line ${cls}`}>
          <span className="bf-tl__diff-sign" aria-hidden>{sign}</span>
          <span className="bf-tl__diff-text">{line || ' '}</span>
        </div>
      ))}
    </>
  );
}

function ToolStep({
  node,
  labels,
}: {
  node: Extract<TimelineNode, { kind: 'tool' }>;
  labels: BrainTimelineLabels;
}) {
  const argsText = formatPayload(node.args);
  const resultText = formatPayload(node.result);
  const preview = toolPreview(node.args);
  return (
    <details className={`bf-tl__tool${node.isError ? ' bf-tl__tool--error' : ''}`}>
      <summary className="bf-tl__tool-head">
        <span className="bf-tl__tool-status" aria-hidden>
          {node.isError ? '✗' : '✓'}
        </span>
        <span className="bf-tl__tool-name">{node.label}</span>
        {node.durationMs != null && <span className="bf-tl__tool-dur">{formatDuration(node.durationMs)}</span>}
        <span className="bf-tl__tool-caret" aria-hidden>
          ▸
        </span>
      </summary>
      <div className="bf-tl__tool-body">
        {preview && (
          <div className="bf-tl__io">
            <div className="bf-tl__io-label">
              <span>{labels.preview}{preview.path ? ` · ${preview.path}` : ''}</span>
              <CopyButton
                text={preview.kind === 'edit' ? preview.newText : preview.content}
                labels={labels}
              />
            </div>
            {preview.kind === 'edit' ? (
              <div className="bf-tl__diff">
                <DiffLines text={preview.oldText} sign="-" />
                <DiffLines text={preview.newText} sign="+" />
              </div>
            ) : (
              <pre className="bf-tl__io-pre">
                <code>{preview.content}</code>
              </pre>
            )}
          </div>
        )}
        {argsText && (
          <div className="bf-tl__io">
            <div className="bf-tl__io-label">
              <span>{labels.input}</span>
              <CopyButton text={argsText} labels={labels} />
            </div>
            <pre className="bf-tl__io-pre">
              <code>{argsText}</code>
            </pre>
          </div>
        )}
        {resultText && (
          <div className="bf-tl__io">
            <div className="bf-tl__io-label">
              <span>{labels.output}</span>
              <CopyButton text={resultText} labels={labels} />
            </div>
            <pre className="bf-tl__io-pre">
              <code>{resultText}</code>
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * The unified Brain chat transcript: a vertical lineage of gutter dots (joined by
 * a connecting line) where each step is one node — a user turn (with image
 * bubbles), a "thinking" marker, an assistant reply, a collapsible tool call with
 * Input/Output, or an error. Presentational and theme-driven (CSS variables), so
 * it renders identically in the web app and a VS Code webview.
 */
function BrainTimelineInner({
  messages,
  trace,
  streamingText,
  isRunning,
  loading,
  labels: labelOverrides,
  assistantName,
  emptyState,
  renderMessage,
  renderStreaming,
  renderAssistantActions,
  onInternalLink,
  onApplyCode,
  onCreateFile,
  autoScroll = true,
}: BrainTimelineProps) {
  // Stable across renders so the memoized <Markdown> children below keep their
  // identity and don't re-parse when only streaming text ticks over.
  const labels = useMemo(() => ({ ...DEFAULT_TIMELINE_LABELS, ...labelOverrides }), [labelOverrides]);
  const assistant = assistantName ?? labels.assistant;
  // The settled nodes (the expensive map + sort) depend only on the durable messages
  // and trace, so they're memoized apart from the streaming text — which ticks on every
  // token and would otherwise re-map + re-sort the whole conversation each time.
  const settled = useMemo(() => buildSettledTimeline(messages, trace), [messages, trace]);
  const nodes = useMemo(() => {
    const streaming = streamingNode(streamingText, isRunning);
    return streaming ? [...settled, streaming] : settled;
  }, [settled, streamingText, isRunning]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);
  const pinnedRef = useRef(true);
  // Track whether the user is pinned to the bottom so streaming doesn't yank them.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  // Stay pinned to the newest node through EVERY height change — not just when the
  // node list changes, but as late-loading images, code blocks, and streaming markdown
  // reflow after render (the reason a plain `nodes`-keyed effect lands short of bottom).
  useEffect(() => {
    if (!autoScroll) return;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const stick = () => {
      if (pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(content);
    return () => ro.disconnect();
  }, [autoScroll]);

  const renderMsg = (msg: BrainMessage, role: 'user' | 'assistant', text: string) =>
    renderMessage ? (
      renderMessage(msg, { role, text })
    ) : (
      <Markdown
        content={text}
        onInternalLink={onInternalLink}
        onApplyCode={role === 'assistant' ? onApplyCode : undefined}
        onCreateFile={role === 'assistant' ? onCreateFile : undefined}
        labels={labels}
      />
    );

  const isEmpty = nodes.length === 0 && !loading;

  return (
    <div className="bf-tl-scroll" ref={scrollRef} onScroll={onScroll}>
      {loading && <div className="bf-tl-status">{labels.loading}</div>}
      {isEmpty &&
        (emptyState ?? <div className="bf-tl-empty">{labels.empty}</div>)}
      <ol className="bf-tl" ref={contentRef}>
        {nodes.map((node) => {
          if (node.kind === 'user') {
            // A message addressed to a participant (not the BRAIN) shows a "→ Name"
            // badge so the transcript makes clear who it was spoken to.
            const to = parseDirectedRecipient(node.message);
            return (
              <li key={node.key} className="bf-tl__item bf-tl__item--user">
                <span className="bf-tl__gutter">
                  <span className="bf-tl__dot">{dotIcon('user')}</span>
                </span>
                <div className="bf-tl__body">
                  <div className="bf-tl__role" style={to ? { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } : undefined}>
                    <span>{labels.you}</span>
                    {to && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.9 }}>
                        <span aria-hidden style={{ opacity: 0.6 }}>→</span>
                        <Avatar name={to.name} kind={to.kind} size={15} />
                        <span>{to.name}</span>
                      </span>
                    )}
                  </div>
                  {node.images.length > 0 && (
                    <div className="bf-tl__images">
                      {node.images.map((im, i) => (
                        <img key={i} src={im.url} alt={im.name ?? ''} className="bf-tl__image" />
                      ))}
                    </div>
                  )}
                  {node.text && <div className="bf-tl__bubble bf-tl__bubble--user">{renderMsg(node.message, 'user', node.text)}</div>}
                </div>
              </li>
            );
          }
          if (node.kind === 'assistant') {
            return (
              <li key={node.key} className="bf-tl__item bf-tl__item--assistant">
                <span className="bf-tl__gutter">
                  <span className="bf-tl__dot">{dotIcon('assistant')}</span>
                </span>
                <div className="bf-tl__body">
                  <div className="bf-tl__role">{assistant}</div>
                  <div className="bf-tl__bubble">{renderMsg(node.message, 'assistant', node.text)}</div>
                  {renderAssistantActions && <div className="bf-tl__actions">{renderAssistantActions(node.message)}</div>}
                </div>
              </li>
            );
          }
          if (node.kind === 'thinking') {
            const label = labels.thoughtFor.replace('{duration}', formatDuration(node.durationMs));
            return (
              <li key={node.key} className="bf-tl__item bf-tl__item--thinking">
                <span className="bf-tl__gutter">
                  <span className="bf-tl__dot bf-tl__dot--muted">{dotIcon('thinking')}</span>
                </span>
                <div className="bf-tl__body">
                  <span className="bf-tl__thinking">{label}</span>
                </div>
              </li>
            );
          }
          if (node.kind === 'tool') {
            return (
              <li key={node.key} className="bf-tl__item bf-tl__item--tool">
                <span className="bf-tl__gutter">
                  <span className={`bf-tl__dot${node.isError ? ' bf-tl__dot--error' : ''}`}>{dotIcon('tool', node.isError)}</span>
                </span>
                <div className="bf-tl__body">
                  <ToolStep node={node} labels={labels} />
                </div>
              </li>
            );
          }
          if (node.kind === 'error') {
            return (
              <li key={node.key} className="bf-tl__item bf-tl__item--error">
                <span className="bf-tl__gutter">
                  <span className="bf-tl__dot bf-tl__dot--error">{dotIcon('error')}</span>
                </span>
                <div className="bf-tl__body">
                  <div className="bf-tl__role bf-tl__role--error">{labels.error}</div>
                  <div className="bf-tl__bubble bf-tl__bubble--error">{node.message}</div>
                </div>
              </li>
            );
          }
          // streaming
          return (
            <li key={node.key} className="bf-tl__item bf-tl__item--assistant bf-tl__item--streaming">
              <span className="bf-tl__gutter">
                <span className="bf-tl__dot bf-tl__dot--pulse">{dotIcon('assistant')}</span>
              </span>
              <div className="bf-tl__body">
                <div className="bf-tl__role">{assistant}</div>
                <div className="bf-tl__bubble">
                  {renderStreaming ? renderStreaming(node.text) : <Markdown content={node.text} onInternalLink={onInternalLink} labels={labels} />}
                </div>
              </div>
            </li>
          );
        })}
        {isRunning && !streamingText.trim() && (
          <li className="bf-tl__item bf-tl__item--thinking" aria-live="polite">
            <span className="bf-tl__gutter">
              <span className="bf-tl__dot bf-tl__dot--pulse">{dotIcon('thinking')}</span>
            </span>
            <div className="bf-tl__body">
              <span className="bf-tl__thinking bf-tl__thinking--live">{labels.thinking}</span>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}

/**
 * Memoized so an unrelated re-render of the host (e.g. every keystroke in the
 * composer, which lives in the same component tree) does not re-render the whole
 * transcript and re-parse every message's markdown. Callers must pass referentially
 * stable props (memoize `labels` and any `on*` callbacks) for this to take effect.
 */
export const BrainTimeline = React.memo(BrainTimelineInner);
