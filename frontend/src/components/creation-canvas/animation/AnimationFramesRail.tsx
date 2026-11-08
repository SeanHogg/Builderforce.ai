import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import { AuthedImg } from '../creative/AuthedMedia';
import { MAX_FRAMES, MAX_FRAME_HOLD, type AnimationState, type FrameLimit } from '@/lib/creation/animation/animationState';

interface AnimationFramesRailProps {
  state: AnimationState;
  activeId: string;
  editable: boolean;
  /** Why no frame can be added or duplicated right now; null when one can. */
  limit: FrameLimit | null;
  onSelect: (frameId: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onHold: (hold: number) => void;
}

/** The frame strip: a thumbnail per frame, and — on an editable board — the structural
 *  edits (add, duplicate, delete, reorder) and the selected frame's hold. */
export function AnimationFramesRail({ state, activeId, editable, limit, onSelect, onAdd, onDuplicate, onRemove, onMove, onHold }: AnimationFramesRailProps) {
  const t = useTranslations('canvas.kinds.animation');
  const index = state.frames.findIndex((frame) => frame.id === activeId);
  const active = state.frames[index];
  const limitText = limit === 'maxFrames' ? t('maxFramesReached', { max: MAX_FRAMES }) : limit === 'budget' ? t('sizeBudgetReached') : '';
  return <div className={styles.rail}>
    <div className={styles.railHead}>
      <b>{t('frames')}</b>
      {editable && <div className={styles.railActions}>
        <button type="button" className={styles.iconButton} onClick={() => onMove(-1)} disabled={index <= 0} aria-label={t('moveEarlier')} title={t('moveEarlier')}>‹</button>
        <button type="button" className={styles.iconButton} onClick={() => onMove(1)} disabled={index >= state.frames.length - 1} aria-label={t('moveLater')} title={t('moveLater')}>›</button>
        <button type="button" className={styles.iconButton} onClick={onAdd} disabled={!!limit} aria-label={t('addFrame')} title={limit ? limitText : t('addFrame')}>+</button>
        <button type="button" className={styles.iconButton} onClick={onDuplicate} disabled={!!limit} aria-label={t('duplicateFrame')} title={limit ? limitText : t('duplicateFrame')}>⧉</button>
        <button type="button" className={styles.iconButton} onClick={onRemove} disabled={state.frames.length <= 1} aria-label={t('deleteFrame')} title={t('deleteFrame')}>×</button>
      </div>}
    </div>
    {editable && limit && <span className={styles.hint} role="status">{limitText}</span>}
    <ol className={`${styles.thumbs} nodrag nowheel`}>
      {state.frames.map((frame, at) => <li key={frame.id}>
        <button
          type="button"
          className={styles.thumb}
          data-active={frame.id === activeId || undefined}
          onClick={() => onSelect(frame.id)}
          aria-label={t('selectFrame', { index: at + 1 })}
          aria-pressed={frame.id === activeId}
          style={{ aspectRatio: `${state.width} / ${state.height}` }}
        >
          {frame.pixelsDataUrl ? <AuthedImg src={frame.pixelsDataUrl} /> : <span>{t('frameEmpty')}</span>}
          <i>{at + 1}</i>
          {frame.hold > 1 && <em>{t('holdBadge', { count: frame.hold })}</em>}
        </button>
      </li>)}
    </ol>
    {editable && active && <label className={styles.field}>
      <span>{t('hold')}</span>
      <input type="number" min={1} max={MAX_FRAME_HOLD} value={active.hold} onChange={(event) => onHold(Number(event.target.value))} />
    </label>}
  </div>;
}
