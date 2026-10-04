import { useTranslations } from 'next-intl';
import { PendingQuestionBanner } from '@seanhogg/builderforce-brain-ui';
import { AiDisclosure } from '../AiDisclosure';
import { useBrainPanel } from './BrainPanelContext';
import { BrainToolConfirmBar } from './BrainToolConfirmBar';
import { BrainComposer } from './BrainComposer';

/**
 * The composer's footer, pinned at the bottom in BOTH states of the docked panel so
 * the input does not jump when the first message turns the empty state into a thread.
 * Composer chrome uses the shared --chat-ctl-* metrics (globals.css) so the toolbar,
 * the input box and the docked panel breathe the same amount in a ~310px column.
 */
export function BrainComposerArea() {
  const { isPage, conv, approveAll, timeline } = useBrainPanel();
  const tBrain = useTranslations('brain');
  const { pendingConfirm, resolveConfirm } = conv;
  const { pendingQuestion } = timeline;
  return (
    <div className="bs-input-area" style={{ flexShrink: 0, padding: isPage ? undefined : 'var(--chat-ctl-pad-y, 6px) var(--chat-ctl-pad-x, 8px)', borderTop: isPage ? undefined : '1px solid var(--border-subtle)' }}>
      {pendingConfirm && <BrainToolConfirmBar req={pendingConfirm} onDecide={resolveConfirm} onApproveAll={approveAll} />}
      {pendingQuestion && (
        <PendingQuestionBanner
          payload={pendingQuestion.payload}
          labels={timeline.askLabels}
          onAnswer={timeline.onAnswerTimelineQuestion}
          onReveal={timeline.revealPendingQuestion}
        />
      )}
      <BrainComposer />
      {conv.uploading && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4 }}>{tBrain('uploading')}</div>}
      {/* Docked: the AI notice is a footnote under the input, not a banner over the thread. */}
      {!isPage && <AiDisclosure variant="footnote" />}
    </div>
  );
}
