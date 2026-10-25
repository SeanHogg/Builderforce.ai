import { memo } from 'react';
import type React from 'react';
import { activityIcon, activityTone, chatActivityText, chatErrorAction } from '@seanhogg/builderforce-brain-embedded';
import { DEFAULT_CHAT_ERROR_LABELS } from '../ChatErrorBanner';
import { chatErrorMessage } from '../chatErrorMessage';
import { Markdown } from '../Markdown';
import { formatDuration, type TimelineNode } from '../timelineModel';
import { ToolStep } from '../ToolStep';
import { dotIcon } from './dotIcon';
import type { BrainTimelineLabels } from './labels';

/**
 * The non-message steps of a turn: the "thought for" marker, a tool call, an error,
 * a runtime activity line, and the live streaming reply.
 */

function ThinkingRowInner({ node, labels }: { node: Extract<TimelineNode, { kind: 'thinking' }>; labels: BrainTimelineLabels }) {
  const label = labels.thoughtFor.replace('{duration}', formatDuration(node.durationMs));
  return (
    <li className="bf-tl__item bf-tl__item--thinking">
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot bf-tl__dot--muted">{dotIcon('thinking')}</span>
      </span>
      <div className="bf-tl__body">
        <span className="bf-tl__thinking">{label}</span>
      </div>
    </li>
  );
}

function ToolRowInner({ node, labels }: { node: Extract<TimelineNode, { kind: 'tool' }>; labels: BrainTimelineLabels }) {
  return (
    <li className="bf-tl__item bf-tl__item--tool">
      <span className="bf-tl__gutter">
        <span className={`bf-tl__dot${node.isError ? ' bf-tl__dot--error' : ''}`}>{dotIcon('tool', node.isError)}</span>
      </span>
      <div className="bf-tl__body">
        <ToolStep node={node} labels={labels} />
      </div>
    </li>
  );
}

function ErrorRowInner({ node, labels }: { node: Extract<TimelineNode, { kind: 'error' }>; labels: BrainTimelineLabels }) {
  return (
    <li className="bf-tl__item bf-tl__item--error">
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot bf-tl__dot--error">{dotIcon('error')}</span>
      </span>
      <div className="bf-tl__body">
        <div className="bf-tl__role bf-tl__role--error">{labels.error}</div>
        {/* The banner's verdict + sentence — never the raw code (`platform_send_disabled`). */}
        <div className="bf-tl__bubble bf-tl__bubble--error">
          {chatErrorMessage(node.message, chatErrorAction(node.message), { ...DEFAULT_CHAT_ERROR_LABELS, ...labels.chatError })}
        </div>
      </div>
    </li>
  );
}

function ActivityRowInner({ node, labels }: { node: Extract<TimelineNode, { kind: 'activity' }>; labels: BrainTimelineLabels }) {
  // The RUNTIME narrating itself — deliberately NOT an assistant bubble. Composed
  // here from the structured metadata so it reads in the viewer's language; a
  // pre-structured row falls back to the sentence the server stored.
  const text = chatActivityText(node.activity, labels.activity) || node.fallbackText;
  const tone = activityTone(node.activity);
  return (
    <li className={`bf-tl__item bf-tl__item--activity bf-tl__item--activity-${tone}`}>
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot bf-tl__dot--activity" aria-hidden>{activityIcon(node.activity)}</span>
      </span>
      <div className="bf-tl__body">
        <span className="bf-tl__activity-line">{text}</span>
        {node.activity.kind === 'milestone' && node.activity.note && (
          <span className="bf-tl__activity-note">{node.activity.note}</span>
        )}
      </div>
    </li>
  );
}

export function StreamingRow({
  node,
  labels,
  assistant,
  renderStreaming,
  onInternalLink,
}: {
  node: Extract<TimelineNode, { kind: 'streaming' }>;
  labels: BrainTimelineLabels;
  /** The assistant display name. */
  assistant: string;
  renderStreaming?: (text: string) => React.ReactNode;
  onInternalLink?: (href: string) => void;
}) {
  return (
    <li className="bf-tl__item bf-tl__item--assistant bf-tl__item--streaming">
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
}

// Memoized: a streamed token re-renders the transcript, never the rows it did not touch.
export const ThinkingRow = memo(ThinkingRowInner);
export const ToolRow = memo(ToolRowInner);
export const ErrorRow = memo(ErrorRowInner);
export const ActivityRow = memo(ActivityRowInner);
