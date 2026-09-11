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
 * its own: its commands ride the ONE session bar. Inside the room there is no rail
 * entry to press — the session is a thing IN the room, not a surface beside it — so
 * the way out is drawn here, over whatever the host puts inside.
 *
 * ── WHY ONE (X) AND NOT A HEADER ─────────────────────────────────────────────
 * It used to be a header row with the title and two worded buttons (Minimize,
 * Close). The canvas's floating chrome covers the top band and a docked Brain covers
 * the right edge, so the title sat under the sync notice and both buttons sat under
 * the dock: the session opened and there was no visible way back. The title and
 * count are already on screen (the session pill, the projection's own layer
 * header), and "back to the board" is one press on the surface switcher — so what
 * the frame owes is exactly one thing: an (X) in the corner that puts the session
 * back in the room.
 */
export interface RoomSessionFrameProps {
  onMinimize: () => void;
  children: ReactNode;
}

export function RoomSessionFrame({ onMinimize, children }: RoomSessionFrameProps) {
  const t = useTranslations('creationCanvas.surface.room.session');

  return (
    <div className={styles.sessionFrame} data-testid="room-session-frame">
      {children}
      <button
        type="button"
        className={styles.sessionClose}
        onClick={onMinimize}
        aria-label={t('back')}
        title={t('back')}
        data-testid="room-session-close"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
