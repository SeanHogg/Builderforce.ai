/**
 * The "ask the user a question" UI — the clickable card and the pinned banner that
 * render an agent's `ask_user` question, shared by the web app and the VS Code webview
 * so a clarifying question looks and behaves identically on both.
 *
 * The PROTOCOL itself is not here. The fenced ```ask-user block, its payload coercion
 * and the "is the chat blocked on an answer" predicate live in
 * `@builderforce/agent-loop` (re-exported through brain-embedded), beside the loops
 * that PRODUCE a question — the api's addressed-agent reply and the Brain run store.
 * They were defined twice, once at each end of the same wire format, and two
 * definitions of one format drift silently: a producer that accepts a payload the
 * renderer then declines leaves the question swallowed. One definition, both ends.
 *
 * <BrainTimeline> lifts the payload out of an assistant message with `parseAskUser`
 * and renders it with <QuestionCard>, using `stripAskUser` so the surrounding prose
 * still reads cleanly. If the block is absent or malformed both degrade gracefully
 * (no card; the fenced block just shows as normal code), so a question is never lost.
 */

import { useMemo, useState } from 'react';
import {
  parseAskUser,
  selectPendingAskUser,
  serializeAskUser,
  stripAskUser,
  askUserAnchorId,
  type AskUserOption,
  type AskUserPayload,
  type AskUserMessageLike,
  type PendingAskUser,
} from '@seanhogg/builderforce-brain-embedded';

// Re-exported so a host reaches the ONE protocol through the transcript package it
// already imports, rather than having to know which package underneath owns it.
export {
  parseAskUser,
  selectPendingAskUser,
  serializeAskUser,
  stripAskUser,
  askUserAnchorId,
};
export type { AskUserOption, AskUserPayload, AskUserMessageLike, PendingAskUser };

/** Copy for <QuestionCard> — defaulted in English, overridable per host for i18n. */
export interface AskUserLabels {
  /** Submit button for a multi-select card. */
  askSubmit: string;
  /** Shown on the card once the user has answered (buttons disabled). */
  askAnswered: string;
  /** <PendingQuestionBanner> heading — the chat is blocked on this answer. */
  askPending: string;
  /** <PendingQuestionBanner> link to scroll the question's card into view. */
  askJumpTo: string;
}

export const DEFAULT_ASK_USER_LABELS: AskUserLabels = {
  askSubmit: 'Send',
  askAnswered: 'Answered',
  askPending: 'Answer needed',
  askJumpTo: 'Show in conversation',
};

/**
 * A clarifying question rendered as clickable options. Single-select sends the
 * chosen label on click; multi-select collects checkboxes behind a submit button.
 * The chosen label(s) are handed to `onAnswer`, which the host posts as the user's
 * next turn — so the model's question and the user's answer stay in the transcript.
 */
export function QuestionCard({
  payload,
  labels,
  onAnswer,
  anchorId,
}: {
  payload: AskUserPayload;
  labels?: Partial<AskUserLabels>;
  onAnswer: (answer: string) => void;
  /** DOM id for scroll-to (see {@link askUserAnchorId}); omit when not targetable. */
  anchorId?: string;
}) {
  const lab = useMemo(() => ({ ...DEFAULT_ASK_USER_LABELS, ...labels }), [labels]);
  const [answered, setAnswered] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const multi = payload.multiSelect === true;

  const commit = (answer: string) => {
    if (answered || !answer.trim()) return;
    setAnswered(answer);
    onAnswer(answer);
  };
  const toggle = (i: number) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const submitMulti = () => {
    const picks = payload.options.filter((_, i) => checked.has(i)).map((o) => o.label);
    if (picks.length) commit(picks.join(', '));
  };

  return (
    <div id={anchorId} className={`bf-qcard${answered ? ' bf-qcard--done' : ''}`} role="group" aria-label={payload.question}>
      <div className="bf-qcard__q">{payload.question}</div>
      <div className="bf-qcard__opts">
        {payload.options.map((opt, i) =>
          multi ? (
            <label key={i} className={`bf-qcard__opt bf-qcard__opt--check${checked.has(i) ? ' is-checked' : ''}`}>
              <input
                type="checkbox"
                className="bf-qcard__cb"
                checked={checked.has(i)}
                disabled={!!answered}
                onChange={() => toggle(i)}
              />
              <span className="bf-qcard__opt-body">
                <span className="bf-qcard__opt-label">{opt.label}</span>
                {opt.description && <span className="bf-qcard__opt-desc">{opt.description}</span>}
              </span>
            </label>
          ) : (
            <button
              key={i}
              type="button"
              className="bf-qcard__opt bf-qcard__opt--btn"
              disabled={!!answered}
              onClick={() => commit(opt.label)}
            >
              <span className="bf-qcard__opt-label">{opt.label}</span>
              {opt.description && <span className="bf-qcard__opt-desc">{opt.description}</span>}
            </button>
          ),
        )}
      </div>
      {multi && !answered && (
        <button type="button" className="bf-qcard__submit" disabled={checked.size === 0} onClick={submitMulti}>
          {lab.askSubmit}
        </button>
      )}
      {answered && <div className="bf-qcard__answered">{`${lab.askAnswered}: ${answered}`}</div>}
    </div>
  );
}

/**
 * The open question, pinned at the composer. A long transcript buries the agent's
 * `ask_user` card, so a chat that is BLOCKED on an answer looks merely idle — this
 * restates the live question where the user is already typing, and answers it through
 * the very same <QuestionCard> (no second options UI to drift), so one click unblocks
 * the run. `onReveal` scrolls the original card into view for the surrounding context.
 *
 * Pair with {@link selectPendingAskUser}; render nothing when it returns null.
 */
export function PendingQuestionBanner({
  payload,
  labels,
  onAnswer,
  onReveal,
}: {
  payload: AskUserPayload;
  labels?: Partial<AskUserLabels>;
  onAnswer: (answer: string) => void;
  onReveal?: () => void;
}) {
  const lab = useMemo(() => ({ ...DEFAULT_ASK_USER_LABELS, ...labels }), [labels]);
  return (
    <div className="bf-qpend" role="region" aria-label={lab.askPending}>
      <div className="bf-qpend__bar">
        <span className="bf-qpend__badge">{lab.askPending}</span>
        {onReveal && (
          <button type="button" className="bf-qpend__jump" onClick={onReveal}>
            {lab.askJumpTo}
          </button>
        )}
      </div>
      <QuestionCard payload={payload} labels={lab} onAnswer={onAnswer} />
    </div>
  );
}
