/*
 * No `'use client'` — imported only by `CanvasRoomSurface.tsx`, inside the
 * `CreationCanvas` client boundary.
 */
import { useTranslations } from 'next-intl';
import type { RoomSessionAnchor } from '@/lib/canvas/roomSession';
import { CanvasBarGroup } from './CanvasBarGroup';
import styles from './CanvasRoomSurface.module.css';

/**
 * The session's own controls on the ONE session bar: open it or put it back, and
 * where in the room it sits.
 *
 * The room draws the same decisions as gestures — press the diorama to open it,
 * drag it to move it — and these are the worded, keyboard-reachable form of the
 * same two choices. They are here rather than in the surface's own tree because
 * `canvasSurfaceActions` says pressable things go in `controls`: one bar, every
 * surface, no second toolbar floating over the stage.
 */

const ANCHORS: readonly RoomSessionAnchor[] = ['table', 'floor', 'wall'];

export interface RoomSessionControlsProps {
  /** Whether the full-size session is up (true) or the diorama is in the room (false). */
  open: boolean;
  anchor: RoomSessionAnchor;
  onToggleOpen: () => void;
  onAnchor: (anchor: RoomSessionAnchor) => void;
}

export function RoomSessionControls({ open, anchor, onToggleOpen, onAnchor }: RoomSessionControlsProps) {
  const t = useTranslations('creationCanvas.surface.room.session');

  return (
    <CanvasBarGroup caption={t('caption')} label={t('groupLabel')}>
      <div className={styles.sessionControls}>
        <button type="button" className={styles.barAction} onClick={onToggleOpen} aria-pressed={open}>
          {open ? t('minimize') : t('open')}
        </button>
        <label className={styles.barPicker}>
          <span className={styles.srOnly}>{t('placeLabel')}</span>
          <select
            className={styles.barSelect}
            value={anchor}
            onChange={(event) => onAnchor(event.target.value as RoomSessionAnchor)}
            // Where it sits is a fact about the ROOM; while the session is open at full
            // size there is no room on screen to place it in.
            disabled={open}
          >
            {ANCHORS.map((option) => (
              <option key={option} value={option}>{t(`place.${option}` as 'place.table')}</option>
            ))}
          </select>
        </label>
      </div>
    </CanvasBarGroup>
  );
}
