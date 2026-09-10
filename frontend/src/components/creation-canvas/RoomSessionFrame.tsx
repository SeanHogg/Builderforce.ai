/*
 * No `'use client'` — imported only by `CanvasRoomSurface.tsx`, inside the
 * `CreationCanvas` client boundary.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CanvasRoomSurface.module.css';

/**
 * The session at full size, with its way back.
 *
 * ── WHY A FRAME AND NOT A CHANGE TO THE 3D VIEW ──────────────────────────────
 * `Canvas3DView` is shared by four canvases and deliberately carries no chrome of
 * its own: its commands ride the ONE session bar and its way out used to be the
 * rail's own surface switcher. Inside the room there is no rail entry to press —
 * the session is a thing IN the room, not a surface beside it — so the two ways
 * out are drawn here, around whatever the host puts inside: MINIMISE puts the
 * session back where it was left in the room; CLOSE hands the board back.
 */
export interface RoomSessionFrameProps {
  title: string;
  objectCount: number;
  onMinimize: () => void;
  onClose: () => void;
  children: ReactNode;
}

export function RoomSessionFrame({ title, objectCount, onMinimize, onClose, children }: RoomSessionFrameProps) {
  const t = useTranslations('creationCanvas.surface.room.session');

  return (
    <div className={styles.sessionFrame} data-testid="room-session-frame">
      <div className={styles.sessionFrameBar}>
        <span className={styles.sessionFrameTitle}>
          <strong>{title}</strong>
          <small>{t('objects', { count: objectCount })}</small>
        </span>
        <span className={styles.sessionFrameActions}>
          <button type="button" className={styles.barAction} onClick={onMinimize} title={t('minimizeHint')}>{t('minimize')}</button>
          <button type="button" className={styles.barAction} onClick={onClose} title={t('closeHint')}>{t('close')}</button>
        </span>
      </div>
      <div className={styles.sessionFrameBody}>{children}</div>
    </div>
  );
}
