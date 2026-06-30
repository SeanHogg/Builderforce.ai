import React, { useEffect, useMemo, useRef } from 'react';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { Markdown } from './Markdown';
import { buildTimeline, formatDuration, formatPayload, type TimelineNode } from './timelineModel';

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

function ToolStep({
  node,
  labels,
}: {
  node: Extract<TimelineNode, { kind: 'tool' }>;
  labels: BrainTimelineLabels;
}) {
  const argsText = formatPayload(node.args);
  const resultText = formatPayload(node.result);
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
        {argsText && (
          <div className="bf-tl__io">
            <div className="bf-tl__io-label">{labels.input}</div>
            <pre className="bf-tl__io-pre">
              <code>{argsText}</code>
            </pre>
          </div>
        )}
        {resultText && (
          <div className="bf-tl__io">
            <div className="bf-tl__io-label">{labels.output}</div>
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
export function BrainTimeline({
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
  const labels = { ...DEFAULT_TIMELINE_LABELS, ...labelOverrides };
  const assistant = assistantName ?? labels.assistant;
  const nodes = useMemo(
    () => buildTimeline({ messages, trace, streamingText, isRunning }),
    [messages, trace, streamingText, isRunning],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  // Track whether the user is pinned to the bottom so streaming doesn't yank them.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (!autoScroll || !pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodes, autoScroll]);

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
      <ol className="bf-tl">
        {nodes.map((node) => {
          if (node.kind === 'user') {
            return (
              <li key={node.key} className="bf-tl__item bf-tl__item--user">
                <span className="bf-tl__gutter">
                  <span className="bf-tl__dot">{dotIcon('user')}</span>
                </span>
                <div className="bf-tl__body">
                  <div className="bf-tl__role">{labels.you}</div>
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
