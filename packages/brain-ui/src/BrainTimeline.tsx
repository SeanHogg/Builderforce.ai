import React, { useCallback, useMemo } from 'react';
import {
  DEFAULT_MODEL_IDENTITY,
  parseSubagentOrigin,
  type BrainMessage,
  type BrainTraceEvent,
  type ModelIdentityContext,
  type BrainRunActivity,
} from '@seanhogg/builderforce-brain-embedded';
import { Markdown } from './Markdown';
import { buildSettledTimeline, strandedReplyKey, streamingNode } from './timelineModel';
import { LiveActivity } from './LiveActivity';
import { ModelMoveStep } from './ModelMoveStep';
import { DEFAULT_TIMELINE_LABELS, type BrainTimelineLabels } from './timeline/labels';
import type { MessageRating } from './timeline/MessageActions';
import { useTranscriptScroll } from './timeline/useTranscriptScroll';
import { TIMELINE_PAGE_SIZE, useRenderWindow } from './timeline/useRenderWindow';
import { AssistantRow, UserRow } from './timeline/MessageRows';
import { CompactedRow, LearnRow, MemoryAnswerRow, RecallRow, ReconcileRow, type TimelinePrefetch } from './timeline/MemoryRows';
import { ActivityRow, ErrorRow, StreamingRow, ThinkingRow, ToolRow } from './timeline/StepRows';

// The public surface stays HERE: the labels and the rating type live beside the row
// components that use them (`./timeline/*`), and are re-exported unchanged.
export { DEFAULT_TIMELINE_LABELS };
export type { BrainTimelineLabels, MessageRating, TimelinePrefetch };

export { TIMELINE_PAGE_SIZE };

export interface BrainTimelineProps {
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
  emptyState?: React.ReactNode;
  /** Render a message's text. Defaults to the shared <Markdown>. The web app
   *  passes its richer ChatMessageBubble here so no feature is lost. */
  renderMessage?: (msg: BrainMessage, ctx: { role: 'user' | 'assistant'; text: string }) => React.ReactNode;
  /** Render the live streaming assistant bubble. Defaults to <Markdown>. */
  renderStreaming?: (text: string) => React.ReactNode;
  /** Host-specific EXTRAS on an assistant message (feedback, export, suggestions).
   *  Copy and "send again" are built in — see {@link MessageActions} — so a host never
   *  re-implements them. */
  renderAssistantActions?: (msg: BrainMessage) => React.ReactNode;
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
   * A PreFetch answer's copy and chips (brain-ui `PrefetchAnswerChips`): the host's label
   * lookup for action names, and the handler that runs a chip's command. Omitted ⇒ the
   * answer row still names its action in English and offers no chips. Pass a stable object.
   */
  prefetch?: TimelinePrefetch;
  /**
   * Scroll this transcript message into view and highlight it. The nonce lets a host
   * ask again for the same id (clicking the same speech bubble twice) without the
   * jump no-op'ing. Absent or null ⇒ no jump, no highlight.
   */
  revealMessage?: { id: number; nonce: number } | null;
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
function BrainTimelineInner({
  messages,
  trace,
  streamingText,
  isRunning,
  activity,
  loading,
  labels: labelOverrides,
  modelIdentity = DEFAULT_MODEL_IDENTITY,
  assistantName,
  emptyState,
  renderMessage,
  renderStreaming,
  renderAssistantActions,
  onReplayMessage,
  onRateMessage,
  ratings,
  onInternalLink,
  onApplyCode,
  onCreateFile,
  onAnswerQuestion,
  autoScroll = true,
  revealMessage = null,
  conversationKey,
  prefetch,
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
  // The one reply (if any) whose text is stranded inside its own `<think>` block
  // because the run ENDED there. Derived over the whole node list — it is a fact about
  // the turn's position, not its content — so the assistant branch below can render
  // that turn as a readable reply instead of a muted line the reader cannot see.
  const stranded = useMemo(() => strandedReplyKey(nodes, isRunning), [nodes, isRunning]);

  const { scrollRef, contentRef, onScroll } = useTranscriptScroll(autoScroll, revealMessage);

  // Stable, so the memoized rows below are not re-rendered on every streamed token.
  const renderMsg = useCallback((msg: BrainMessage, role: 'user' | 'assistant', text: string) =>
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
    ), [renderMessage, onInternalLink, onApplyCode, onCreateFile, labels]);

  // The render window (`useRenderWindow`): the newest page, older and newer pages on
  // request, a page around a revealed message — never the whole chat at once.
  const revealIndex = useMemo(
    () => (revealMessage ? nodes.findIndex((n) => (n.kind === 'user' || n.kind === 'assistant') && n.message.id === revealMessage.id) : -1),
    [nodes, revealMessage],
  );
  const { visible, earlier, newer } = useRenderWindow(
    nodes,
    conversationKey ?? nodes[0]?.key ?? null,
    revealMessage && revealIndex >= 0 ? { index: revealIndex, nonce: revealMessage.nonce } : null,
    scrollRef,
  );

  const isEmpty = nodes.length === 0 && !loading;
  // Once a sub-agent has spoken, the chat's own agent is named as their OWNER, so the
  // transcript reads as Owner and Agent (name), never as one voice. Over the MESSAGES:
  // a trace event or a streamed token cannot change it.
  const hasSubagents = useMemo(
    () => messages.some((m) => m.role === 'assistant' && parseSubagentOrigin(m) !== null),
    [messages],
  );
  const focusedId = revealMessage?.id ?? null;
  const focusClass = (messageId: number) => (focusedId === messageId ? ' bf-tl__item--focus' : '');

  return (
    <div className="bf-tl-scroll" ref={scrollRef} onScroll={onScroll}>
      {loading && <div className="bf-tl-status">{labels.loading}</div>}
      {isEmpty &&
        (emptyState ?? <div className="bf-tl-empty">{labels.empty}</div>)}
      {earlier && (
        <button type="button" className="bf-tl-earlier" onClick={earlier.show}>
          {labels.showEarlier.replace('{count}', String(earlier.count))}
        </button>
      )}
      <ol className="bf-tl" ref={contentRef}>
        {visible.map((node) => {
          switch (node.kind) {
            case 'user':
              return (
                <UserRow
                  key={node.key}
                  node={node}
                  labels={labels}
                  focusClass={focusClass(node.message.id)}
                  renderMsg={renderMsg}
                  onReplay={onReplayMessage}
                />
              );
            case 'assistant':
              return (
                <AssistantRow
                  key={node.key}
                  node={node}
                  labels={labels}
                  focusClass={focusClass(node.message.id)}
                  renderMsg={renderMsg}
                  assistant={assistant}
                  stranded={stranded}
                  hasSubagents={hasSubagents}
                  modelIdentity={modelIdentity}
                  onAnswerQuestion={onAnswerQuestion}
                  onReplay={onReplayMessage}
                  onRate={onRateMessage}
                  rating={ratings?.[node.message.id]}
                  renderAssistantActions={renderAssistantActions}
                />
              );
            case 'thinking':
              return <ThinkingRow key={node.key} node={node} labels={labels} />;
            case 'tool':
              return <ToolRow key={node.key} node={node} labels={labels} />;
            case 'error':
              return <ErrorRow key={node.key} node={node} labels={labels} />;
            case 'recall':
              return <RecallRow key={node.key} node={node} labels={labels} />;
            case 'memoryAnswer':
              return <MemoryAnswerRow key={node.key} node={node} labels={labels} {...(prefetch ? { prefetch } : {})} />;
            case 'learn':
              return <LearnRow key={node.key} node={node} labels={labels} />;
            case 'activity':
              return <ActivityRow key={node.key} node={node} labels={labels} />;
            case 'modelMove':
              return <ModelMoveStep key={node.key} move={node.move} labels={labels} />;
            case 'reconcile':
              return <ReconcileRow key={node.key} node={node} labels={labels} />;
            case 'compacted':
              return <CompactedRow key={node.key} node={node} labels={labels} />;
            default:
              return (
                <StreamingRow
                  key={node.key}
                  node={node}
                  labels={labels}
                  assistant={assistant}
                  renderStreaming={renderStreaming}
                  onInternalLink={onInternalLink}
                />
              );
          }
        })}
        {/* The in-flight step. Shown whenever the run is live — INCLUDING while text
            is streaming, because a streaming turn still has a phase (and the next
            tool call after it is exactly the stretch that used to look like a hang).
            Suppressed only for `writing`, where the arriving text is itself the
            indicator and a second one would just compete with it. */}
        {isRunning && !(streamingText.trim() && activity?.phase === 'writing') && (
          <LiveActivity activity={activity} isRunning={isRunning} labels={labels.live} />
        )}
      </ol>
      {newer && (
        <div className="bf-tl-newer">
          <button type="button" className="bf-tl-earlier" onClick={newer.show}>
            {labels.showNewer.replace('{count}', String(newer.count))}
          </button>
          <button type="button" className="bf-tl-earlier" onClick={newer.latest}>
            {labels.jumpToLatest}
          </button>
        </div>
      )}
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
