import { PendingQuestionBanner, type AskUserMessageLike, type BrainTimelineLabels } from '@seanhogg/builderforce-brain-ui';
import { usePendingQuestion } from '@/lib/brain/useTranscriptReplies';

/**
 * The question a conversation is BLOCKED on, pinned at the composer — THE web binding of
 * the shared `PendingQuestionBanner` (the predicate and copy are `usePendingQuestion`).
 * Renders nothing while nothing is waiting, or when this viewer cannot answer.
 */
export function PendingQuestionBar({ messages, onAnswer, timelineLabels }: {
  messages: readonly AskUserMessageLike[];
  /** Omitted on a conversation this viewer cannot drive. */
  onAnswer?: (answer: string) => void;
  timelineLabels: Pick<BrainTimelineLabels, 'askSubmit' | 'askAnswered'>;
}) {
  const { pendingQuestion, askLabels, revealPendingQuestion } = usePendingQuestion(messages, timelineLabels);
  if (!pendingQuestion || !onAnswer) return null;
  return (
    <PendingQuestionBanner
      key={pendingQuestion.messageId}
      payload={pendingQuestion.payload}
      labels={askLabels}
      onAnswer={onAnswer}
      onReveal={revealPendingQuestion}
    />
  );
}
