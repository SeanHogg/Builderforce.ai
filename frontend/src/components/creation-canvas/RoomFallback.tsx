/*
 * No `'use client'` — rendered only by `CanvasRoomSurface`, inside its client boundary.
 */
import { useTranslations } from 'next-intl';
import { bodyColor, type RoomPalette, type RoomSeat } from '@/lib/canvas/roomSeating';
import type { RoomCreation } from '@/lib/canvas/roomCreations';
import styles from './CanvasRoomSurface.module.css';

/** What one creation is called, what it is, and how its Open button is named. */
export interface RoomCreationLabels {
  title: string;
  kind: string;
  openName: string;
}

export interface RoomFallbackProps {
  seats: readonly RoomSeat[];
  palette: RoomPalette;
  creations: readonly RoomCreation[];
  labelsOf: (creation: RoomCreation) => RoomCreationLabels;
  onOpenSession: () => void;
  onOpenCreation: (creation: RoomCreation) => void;
}

/**
 * THE ROOM ON A DEVICE WITHOUT WEBGL.
 *
 * Not a degraded copy of the room — a legible list of who is in it, in the order the
 * ring seats them, with the same two ways in the 3D room offers: open the session, and
 * open any creation that stands there. Its own component so the surface stays about
 * the room; the surface still owns the frame this renders into, because the full-size
 * session mounts in that same frame on such a device.
 */
export function RoomFallback({ seats, palette, creations, labelsOf, onOpenSession, onOpenCreation }: RoomFallbackProps) {
  const t = useTranslations('creationCanvas.surface.room');
  return (
    <>
      <h3>{t('noWebglTitle')}</h3>
      <p>{t('noWebglBody')}</p>
      <div className={styles.ring}>
        {seats.map((seat) => (
          <span key={seat.userId} className={styles.ringSeat} data-live={seat.present ? 'true' : 'false'}>
            <span className={styles.seatDot} style={{ background: bodyColor(seat.userId, palette, seat.isSelf) }} />
            {seat.displayName || t('unknown')}
          </span>
        ))}
      </div>
      {/* The projection is DOM, not WebGL, so the session still opens here. */}
      <button type="button" className={styles.fallbackOpen} onClick={onOpenSession}>
        {t('session.open')}
      </button>
      {/* So do the creations: each surface they open into has its own reading for a
          device without WebGL, so the room still lists them with the same Open their
          3D stands carry. */}
      {creations.length > 0 && (
        <ul className={styles.creations} aria-label={t('creation.head', { count: creations.length })}>
          {creations.map((creation) => {
            const labels = labelsOf(creation);
            return (
              <li key={creation.id} className={styles.creation} data-testid="room-creation">
                <span className={styles.creationName}>
                  <strong>{labels.title}</strong>
                  <small>{labels.kind}</small>
                </span>
                {creation.surface && (
                  <button type="button" className={styles.creationOpen} onClick={() => onOpenCreation(creation)} aria-label={labels.openName}>
                    {t('session.openButton')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
