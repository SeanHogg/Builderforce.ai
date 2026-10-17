import type { QueuedItem } from './useQueuedTurns';

/**
 * Turns the person composed while a run was in flight — each waits for the run to
 * finish, or (where the host can) is STEERED into it now. Extracted from the VS Code
 * chat's QueuedMessages; it replaces the web's count-only receipt and Rovr's line, so
 * every surface lists the same held turns the same way. Renders nothing when empty.
 */
export interface QueuedTurnChipsLabels {
  list: string;
  hint: string;
  steer: string;
  steerHint: string;
  remove: string;
}

export const DEFAULT_QUEUED_TURN_LABELS: QueuedTurnChipsLabels = {
  list: 'Queued messages',
  hint: 'Queued — sends when the run finishes',
  steer: 'Steer now',
  steerHint: 'Send it into the running turn now instead of after it',
  remove: 'Remove',
};

export interface QueuedTurnChipsProps<T> {
  items: readonly QueuedItem<T>[];
  /** The text a held turn carries (identity for string queues). */
  textOf: (value: T) => string;
  onRemove: (id: number) => void;
  /** Put a held turn into the running turn now. Omitted ⇒ turns can only wait. */
  onSteer?: (item: QueuedItem<T>) => void;
  /** Whether THIS turn can be steered (e.g. one addressed to a person cannot). */
  canSteer?: (item: QueuedItem<T>) => boolean;
  labels?: Partial<QueuedTurnChipsLabels>;
}

export function QueuedTurnChips<T>({ items, textOf, onRemove, onSteer, canSteer, labels: overrides }: QueuedTurnChipsProps<T>) {
  if (items.length === 0) return null;
  const labels = { ...DEFAULT_QUEUED_TURN_LABELS, ...overrides };
  return (
    <div className="bf-queued" role="list" aria-label={labels.list}>
      <span className="bf-queued__hint">{labels.hint}</span>
      {items.map((item) => {
        const text = textOf(item.value);
        return (
          <span key={item.id} className="bf-queued__chip" role="listitem" title={text}>
            <span className="bf-queued__text">{text}</span>
            {onSteer && (canSteer?.(item) ?? true) && (
              <button type="button" className="bf-queued__steer" onClick={() => onSteer(item)} title={labels.steerHint}>
                {labels.steer}
              </button>
            )}
            <button type="button" className="bf-queued__x" onClick={() => onRemove(item.id)} aria-label={labels.remove}>×</button>
          </span>
        );
      })}
    </div>
  );
}
