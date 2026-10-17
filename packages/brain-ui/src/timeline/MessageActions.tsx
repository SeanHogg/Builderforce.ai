import type React from 'react';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { CopyButton } from '../CopyButton';
import type { BrainTimelineLabels } from './labels';

/** +1 up, -1 down, 0 = cleared. Mirrors the `llm_action_ratings.rating` domain. */
export type MessageRating = 1 | -1 | 0;

/**
 * The action row every message carries: copy it, send it again, and — on an
 * assistant reply — say whether it was any good.
 *
 * It lives HERE rather than in each host's own action bar because all three surfaces
 * (the web Brain panel, the Canvas dock, the VS Code webview) mount this same
 * timeline — a host-side implementation would have had to be written three times and
 * would have reached only whichever surface remembered to render it. Hosts still add
 * their OWN extras through `renderAssistantActions`; those compose after these.
 *
 * "Send again" is deliberately offered on BOTH roles: replaying a user turn re-asks
 * the question, and replaying an assistant turn feeds its answer back as the next
 * prompt — which is how you ask the model to build on what it just said.
 *
 * The THUMBS moved here for the same reason, and because of what they are now for:
 * every press is filed against the model that served the turn and the MCP tool it
 * ran, so it teaches the learned router which model is good at which kind of work
 * (`llm_action_ratings`, migration 0468). While they lived in the web app's own
 * action bar, the Canvas and the editor — a large share of all model calls — could
 * not contribute a single rating.
 */
export function MessageActions({
  message,
  role,
  text,
  labels,
  onReplay,
  onRate,
  rating,
}: {
  message: BrainMessage;
  role: 'user' | 'assistant';
  text: string;
  labels: BrainTimelineLabels;
  onReplay?: (msg: BrainMessage, role: 'user' | 'assistant') => void;
  onRate?: (msg: BrainMessage, rating: MessageRating) => void;
  rating?: MessageRating;
}) {
  if (!text.trim()) return null;
  // Pressing the thumb you already gave clears it — "no opinion" is the absence of
  // a rating, so it deletes the row rather than storing a third state.
  const rate = (next: 1 | -1) => (event: React.MouseEvent) => {
    event.stopPropagation();
    onRate?.(message, rating === next ? 0 : next);
  };
  return (
    <>
      <CopyButton text={text} labels={labels} icon />
      {onReplay && (
        <button
          type="button"
          className="bf-tl__act"
          title={labels.replay}
          aria-label={labels.replay}
          onClick={(e) => { e.stopPropagation(); onReplay(message, role); }}
        >
          <span aria-hidden>↻</span>
        </button>
      )}
      {onRate && role === 'assistant' && (
        <>
          <button
            type="button"
            className="bf-tl__act"
            title={labels.rateUp}
            aria-label={labels.rateUp}
            aria-pressed={rating === 1}
            data-state={rating === 1 ? 'done' : undefined}
            onClick={rate(1)}
          >
            <span aria-hidden>👍</span>
          </button>
          <button
            type="button"
            className="bf-tl__act"
            title={labels.rateDown}
            aria-label={labels.rateDown}
            aria-pressed={rating === -1}
            data-state={rating === -1 ? 'done' : undefined}
            onClick={rate(-1)}
          >
            <span aria-hidden>👎</span>
          </button>
        </>
      )}
    </>
  );
}
