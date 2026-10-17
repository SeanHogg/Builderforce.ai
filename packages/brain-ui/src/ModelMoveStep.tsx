import { modelMoveLine, type ModelMove, type ModelMoveLabels } from './timelineModelMoves';

/**
 * One MODEL MOVE in the transcript — the conversation fitted to the next model's window,
 * or a local-first turn that fell over — as a muted step line in the reader's language
 * (`timelineModelMoves.ts`). The same row shape as the memory steps.
 */
export function ModelMoveStep({ move, labels }: { move: ModelMove; labels: ModelMoveLabels }) {
  return (
    <li className="bf-tl__item bf-tl__item--memory">
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot bf-tl__dot--muted">⇄</span>
      </span>
      <div className="bf-tl__body">
        <span className="bf-tl__memory-line" title={labels.modelMoveHint}>{modelMoveLine(move, labels)}</span>
      </div>
    </li>
  );
}
