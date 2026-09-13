import { useTranslations } from 'next-intl';
import type { RoomPalette, RoomSeat } from '@/lib/canvas/roomSeating';
import type { RoomCreation } from '@/lib/canvas/roomCreations';
import { RoomSeatMark } from './RoomSeatMark';
import { useCreationLabels } from './useCreationLabels';
import surfaceStyles from '../CanvasRoomSurface.module.css';

/**
 * THE ROOM ON A DEVICE WITHOUT WEBGL.
 *
 * Not a degraded copy of the room — a legible list of who is in it, in the order the
 * room places them, with the session and every creation still one press away: the
 * projection is DOM rather than WebGL, and each creation's surface has its own
 * no-WebGL reading. A Roblox place cannot be walked here, so it opens the play
 * surface, which says what it can and cannot show on this device.
 */
export function RoomFallback({ seats, palette, creations, onOpenSession, onOpenCreation }: {
  seats: readonly RoomSeat[];
  palette: RoomPalette;
  creations: readonly RoomCreation[];
  onOpenSession: () => void;
  onOpenCreation: (creation: RoomCreation) => void;
}) {
  const t = useTranslations('creationCanvas.surface.room');
  const labelsOf = useCreationLabels();
  return (
    <>
      <h3>{t('noWebglTitle')}</h3>
      <p>{t('noWebglBody')}</p>
      <div className={surfaceStyles.ring}>
        {seats.map((seat) => (
          <span key={seat.userId} className={surfaceStyles.ringSeat} data-live={seat.present ? 'true' : 'false'}>
            <RoomSeatMark seat={seat} palette={palette} />
            {seat.displayName || t('unknown')}
          </span>
        ))}
      </div>
      <button type="button" className={surfaceStyles.fallbackOpen} onClick={onOpenSession}>
        {t('session.open')}
      </button>
      {creations.length > 0 && (
        <ul className={surfaceStyles.creations} aria-label={t('creation.head', { count: creations.length })}>
          {creations.map((creation) => {
            const labels = labelsOf(creation);
            return (
              <li key={creation.id} className={surfaceStyles.creation} data-testid="room-creation">
                <span className={surfaceStyles.creationName}>
                  <strong>{labels.title}</strong>
                  <small>{labels.kind}</small>
                </span>
                {creation.surface && (
                  <button type="button" className={surfaceStyles.creationOpen} onClick={() => onOpenCreation(creation)} aria-label={t('creation.openNamed', { title: labels.title })}>
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
