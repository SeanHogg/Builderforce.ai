import type { ReactNode } from 'react';
import { AiSurface, SurfaceFooter, type AiSurfaceProps, type AskUserMessageLike, type BrainTimelineLabels } from '@seanhogg/builderforce-brain-ui';
import type { RunKey } from '@seanhogg/builderforce-brain-embedded';
import { REPLAY_MASK } from '@/lib/replaySensitive';
import { PendingQuestionBar } from './PendingQuestionBar';
import { RunConfirmBar } from './RunConfirmBar';

/**
 * THE web AI surface — the one container the web host mounts for every conversation:
 * the Brain panel and Studio column, the guest drawer, and the canvas (Chat lens, board
 * dock, Brain Object). It is the shared `AiSurface` with the web's footer already bound:
 * the run's tool approval (from the run store, by `runKey`), the open question, then the
 * host's composer. A host passes only what is its own — header, rail, thread or empty
 * state, notices, composer — so the web placements cannot drift into different chats.
 *
 * VS Code and Rovr mount `AiSurface` with their own bindings; this is the web's.
 */
export interface WebSurfaceFooterProps {
  /** The run this conversation's turns live in: a chat id, or `canvasRunKey(session)`. */
  runKey: RunKey | null;
  /** "Approve the rest of this run" — omitted ⇒ no Approve-all. */
  onApproveAll?: () => void;
  /** The transcript the open question is read from. */
  messages: readonly AskUserMessageLike[];
  /** Answer the open question; omitted where this viewer cannot drive the conversation. */
  onAnswerQuestion?: (answer: string) => void;
  timelineLabels: Pick<BrainTimelineLabels, 'askSubmit' | 'askAnswered'>;
  composer?: ReactNode;
  status?: ReactNode;
  footnote?: ReactNode;
  className?: string;
}

/**
 * The pinned footer. What a person types to the Brain is masked from session replay
 * (`REPLAY_MASK`) — here, once, for every web surface.
 */
export function WebSurfaceFooter({ runKey, onApproveAll, messages, onAnswerQuestion, timelineLabels, composer, status, footnote, className }: WebSurfaceFooterProps) {
  return (
    <SurfaceFooter dataAttrs={REPLAY_MASK}
      {...(className ? { className } : {})}
      confirm={<RunConfirmBar runKey={runKey} {...(onApproveAll ? { onApproveAll } : {})} />}
      question={<PendingQuestionBar messages={messages} timelineLabels={timelineLabels} {...(onAnswerQuestion ? { onAnswer: onAnswerQuestion } : {})} />}
      composer={<>{composer}</>}
      status={status == null ? undefined : <>{status}</>}
      footnote={<>{footnote}</>}
    />
  );
}

export interface WebAiSurfaceProps extends Omit<AiSurfaceProps, 'footer'>, Omit<WebSurfaceFooterProps, 'className'> {
  footerClassName?: string;
  /** False where the footer lives elsewhere (the full page's empty state holds the composer). */
  footer?: boolean;
}

export function WebAiSurface({
  runKey, onApproveAll, messages, onAnswerQuestion, timelineLabels, composer, status, footnote, footerClassName,
  footer = true, ...surface
}: WebAiSurfaceProps) {
  return (
    <AiSurface
      {...surface}
      footer={footer ? (
        <WebSurfaceFooter
          runKey={runKey}
          messages={messages}
          timelineLabels={timelineLabels}
          composer={composer}
          status={status}
          footnote={footnote}
          {...(onApproveAll ? { onApproveAll } : {})}
          {...(onAnswerQuestion ? { onAnswerQuestion } : {})}
          {...(footerClassName ? { className: footerClassName } : {})}
        />
      ) : undefined}
    />
  );
}
