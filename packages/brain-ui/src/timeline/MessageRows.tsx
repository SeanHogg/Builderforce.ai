import { memo } from 'react';
import type React from 'react';
import {
  isStoppedTurn,
  parseDirectedRecipients,
  parseMessageAuthor,
  parseMessageProvenance,
  parseSubagentOrigin,
  type BrainMessage,
  type ModelIdentityContext,
} from '@seanhogg/builderforce-brain-embedded';
import { answerTextOf, brainMessageAnchorId, thoughtTextOf } from '@builderforce/agent-loop';
import { Avatar, RecipientsBadge } from '../ParticipantBadge';
import { parseAskUser, stripAskUser, QuestionCard, askUserAnchorId } from '../askUser';
import type { TimelineNode } from '../timelineModel';
import { dotIcon } from './dotIcon';
import type { BrainTimelineLabels } from './labels';
import { MessageActions, type MessageRating } from './MessageActions';
import { ProvenanceChip } from './ProvenanceChip';

/** Renders one message's text — the host's renderer or the shared <Markdown>. */
export type RenderMessageText = (msg: BrainMessage, role: 'user' | 'assistant', text: string) => React.ReactNode;

/** A user turn: author (or "You"), who it was addressed to, images, then the text. */
function UserRowInner({
  node,
  labels,
  focusClass,
  renderMsg,
  onReplay,
}: {
  node: Extract<TimelineNode, { kind: 'user' }>;
  labels: BrainTimelineLabels;
  focusClass: string;
  renderMsg: RenderMessageText;
  onReplay?: (msg: BrainMessage, role: 'user' | 'assistant') => void;
}) {
  // A message addressed to participants (not the BRAIN) shows a "→ Name"
  // badge — several for a group turn — so the transcript makes clear who it
  // was spoken to.
  const to = parseDirectedRecipients(node.message);
  const author = parseMessageAuthor(node.message);
  return (
    <li id={brainMessageAnchorId(node.message.id)} className={`bf-tl__item bf-tl__item--user${focusClass}`}>
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot">{author ? <Avatar name={author.name} kind={author.kind} size={16} /> : dotIcon('user')}</span>
      </span>
      <div className="bf-tl__body">
        <div className="bf-tl__role" style={to.length > 0 ? { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } : undefined}>
          <span>{author ? author.name : labels.you}</span>
          <RecipientsBadge recipients={to} />
        </div>
        {node.images.length > 0 && (
          <div className="bf-tl__images">
            {node.images.map((im, i) => (
              <img key={i} src={im.url} alt={im.name ?? ''} className="bf-tl__image" />
            ))}
          </div>
        )}
        {node.text && <div className="bf-tl__bubble bf-tl__bubble--user">{renderMsg(node.message, 'user', node.text)}</div>}
        <div className="bf-tl__actions bf-tl__actions--hover">
          <MessageActions message={node.message} role="user" text={node.text} labels={labels} onReplay={onReplay} />
        </div>
      </div>
    </li>
  );
}

/**
 * An assistant turn. A reasoning-only turn collapses to one "Thought" line; anything
 * else renders as a full reply with its ask-user card, provenance chip and actions.
 */
function AssistantRowInner({
  node,
  labels,
  focusClass,
  renderMsg,
  assistant,
  stranded,
  hasSubagents,
  modelIdentity,
  onAnswerQuestion,
  onReplay,
  onRate,
  rating,
  renderAssistantActions,
}: {
  node: Extract<TimelineNode, { kind: 'assistant' }>;
  labels: BrainTimelineLabels;
  focusClass: string;
  renderMsg: RenderMessageText;
  /** The assistant display name. */
  assistant: string;
  /** Key of the one reply stranded inside its own `<think>` block (see `strandedReplyKey`). */
  stranded: string | null;
  hasSubagents: boolean;
  modelIdentity: ModelIdentityContext;
  onAnswerQuestion?: (answer: string) => void;
  onReplay?: (msg: BrainMessage, role: 'user' | 'assistant') => void;
  onRate?: (msg: BrainMessage, rating: MessageRating) => void;
  rating?: MessageRating;
  renderAssistantActions?: (msg: BrainMessage) => React.ReactNode;
}) {
  // An assistant turn produced by an invited agent (not the BRAIN) is
  // attributed to it — show the agent's avatar + name in place of the
  // default assistant label so multi-party replies read clearly.
  const author = parseMessageAuthor(node.message);
  // An `ask_user` question rides in the assistant text as a fenced ask-user
  // block. Lift it out to a clickable <QuestionCard> (whichever body renderer
  // the host uses) and render only the surrounding prose through renderMsg, so
  // the model's options are answerable in one click instead of by free-typing.
  const card = onAnswerQuestion ? parseAskUser(node.text) : null;
  const bodyText = card ? stripAskUser(node.text) : node.text;
  // Which model + account produced this turn (persisted on the message by
  // both the streaming Brain path and an agent's addressed reply). Shown as
  // a small chip so the user can always see whether their own connected
  // account ran it — not only when a turn comes back empty.
  const prov = parseMessageProvenance(node.message);
  // The reply minus its `<think>` reasoning. A turn that only reasoned (the
  // model thought, then called a tool without addressing the user) is not a
  // response: it collapses to ONE line — the "Thought" disclosure with the
  // attribution chip beside it — with no author header and no copy /
  // send-again / rating row, because there is nothing to copy, replay or
  // grade. Six such turns in a row used to cost the editor ~30 rows.
  const answer = answerTextOf(bodyText);
  // This turn ended the run from inside its reasoning: show the reasoning AS
  // the reply, with a muted note explaining the first-person voice. Every
  // other reasoning-only turn still collapses — see `strandedReplyKey`.
  const rescued = node.key === stranded ? thoughtTextOf(bodyText) : '';
  // A reply the user STOPPED is never folded into a "Thought" line: what the model
  // was writing when Stop was pressed is exactly what the reader stopped it for.
  const stopped = isStoppedTurn(node.message);
  if (!answer && bodyText && !card && !rescued && !stopped) {
    return (
      <li id={brainMessageAnchorId(node.message.id)} className={`bf-tl__item bf-tl__item--thought${focusClass}`}>
        <span className="bf-tl__gutter">
          <span className="bf-tl__dot bf-tl__dot--muted">{dotIcon('thinking')}</span>
        </span>
        <div className="bf-tl__body bf-tl__thought-line">
          {renderMsg(node.message, 'assistant', bodyText)}
          {prov && <ProvenanceChip prov={prov} labels={labels} identity={modelIdentity} />}
        </div>
      </li>
    );
  }
  return (
    <li id={brainMessageAnchorId(node.message.id)} className={`bf-tl__item bf-tl__item--assistant${focusClass}`}>
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot">{author ? <Avatar name={author.name} kind={author.kind} size={16} /> : dotIcon('assistant')}</span>
      </span>
      <div className="bf-tl__body">
        <div className="bf-tl__role">
          {author ? author.name : assistant}
          <OriginTag message={node.message} owner={!author && hasSubagents} labels={labels} />
        </div>
        {rescued && <div className="bf-tl__rescued">{labels.replyFromThought}</div>}
        {stopped && <div className="bf-tl__rescued">{labels.stoppedReply}</div>}
        {bodyText && <div className="bf-tl__bubble">{renderMsg(node.message, 'assistant', rescued || bodyText)}</div>}
        {card && onAnswerQuestion && (
          <QuestionCard
            payload={card}
            labels={{ askSubmit: labels.askSubmit, askAnswered: labels.askAnswered }}
            onAnswer={onAnswerQuestion}
            anchorId={askUserAnchorId(node.message.id)}
          />
        )}
        {/* ONE footer line: attribution on the left, the actions on the right.
            They used to stack as two blocks under every reply; the actions now
            reveal on hover / focus (always shown on touch) like a user turn's,
            so a settled reply reads as header + text + one quiet line. */}
        <div className="bf-tl__foot">
          {prov && <ProvenanceChip prov={prov} labels={labels} identity={modelIdentity} />}
          <div className="bf-tl__actions bf-tl__actions--hover">
            <MessageActions
              message={node.message}
              role="assistant"
              text={answer || rescued}
              labels={labels}
              onReplay={onReplay}
              onRate={onRate}
              rating={rating}
            />
            {renderAssistantActions?.(node.message)}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Whose sub-agent wrote a reply (`sub-agent of BuilderForce · a1`), or that the chat's own
 *  agent is the OWNER of the sub-agents in it. Nothing for an ordinary reply. */
function OriginTag({ message, owner, labels }: { message: BrainMessage; owner: boolean; labels: BrainTimelineLabels }) {
  const origin = parseSubagentOrigin(message);
  if (origin) {
    return <span className="bf-tl__origin">{`${labels.subagentOf.replace('{owner}', origin.owner)} · ${origin.handle}`}</span>;
  }
  return owner ? <span className="bf-tl__origin">{labels.ownerTag}</span> : null;
}

// Memoized: a streamed token re-renders the transcript, never the rows it did not touch.
export const UserRow = memo(UserRowInner);
export const AssistantRow = memo(AssistantRowInner);
