/**
 * Messages the person composed while a run was in flight — each waits for the run to
 * finish, or is STEERED into it now: put in front of the run's next turn instead of after
 * it (`run.steer`). A message addressed to a participant is not the run's to hear, so it
 * can only wait. Renders nothing when the queue is empty.
 */

import type { DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import type { QueuedItem } from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';
import { makeT } from './chatLabels';
import { steerRun } from './chatChildren';

/** What a held VS Code turn carries — its text and who it is addressed to. */
export interface QueuedTurn {
  text: string;
  recipient: DirectedRecipient | null;
}

/** One held turn, as the shared `useQueuedTurns` queue lists it. */
export type QueuedMessage = QueuedItem<QueuedTurn>;

interface Props {
  queue: readonly QueuedMessage[];
  /** The run the messages are waiting on; null when nothing is running to steer. */
  runningChatId: number | null;
  labels: LabelBundle;
  onRemove(id: number): void;
}

export function QueuedMessages({ queue, runningChatId, labels, onRemove }: Props) {
  if (queue.length === 0) return null;
  const t = makeT(labels);
  return (
    <div className="bf-queued" role="list" aria-label={t('app.queuedLabel', 'Queued messages')}>
      <span className="bf-queued__hint">{t('app.queuedHint', 'Queued — sends when the run finishes')}</span>
      {queue.map((m) => (
        <span key={m.id} className="bf-chip bf-chip--queued" role="listitem" title={m.value.text}>
          <span className="bf-chip__name">{m.value.text}</span>
          {runningChatId != null && !m.value.recipient && (
            <button
              className="bf-chip__steer"
              onClick={() => {
                steerRun(runningChatId, m.value.text);
                onRemove(m.id);
              }}
              title={t('app.steerNowHint', 'Send it into the running turn now instead of after it')}
            >
              {t('app.steerNow', 'Steer now')}
            </button>
          )}
          <button className="bf-chip__x" onClick={() => onRemove(m.id)} aria-label={t('app.remove', 'Remove')}>×</button>
        </span>
      ))}
    </div>
  );
}
