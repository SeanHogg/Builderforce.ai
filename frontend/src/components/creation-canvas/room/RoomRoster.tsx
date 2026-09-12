import { useTranslations } from 'next-intl';
import { bodyColor, type RoomPalette, type RoomSeat } from '@/lib/canvas/roomSeating';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { RoomStationList } from '../room-stations/RoomStations';
import surfaceStyles from '../CanvasRoomSurface.module.css';

/**
 * WHO IS IN THE ROOM, and what stands in it — the rail beside the stage.
 *
 * The keyboard and screen-reader path to the room's people and stations, and on a
 * phone the strip under the stage. Every row reads the seat the room placed, so the
 * list and the bodies can never disagree about who is here.
 */
export function RoomRoster({ seats, palette, stations, onOpenStation }: {
  seats: readonly RoomSeat[];
  palette: RoomPalette;
  stations: readonly RoomStationInstance[];
  onOpenStation: (key: string) => void;
}) {
  const t = useTranslations('creationCanvas.surface.room');
  return (
    <div className={surfaceStyles.roster}>
      <p className={surfaceStyles.rosterHead}>{t('rosterHead', { count: seats.length })}</p>
      {seats.map((seat) => (
        <div key={seat.userId} className={surfaceStyles.seat} data-live={seat.present ? 'true' : 'false'} data-kind={seat.kind}>
          <span className={surfaceStyles.seatDot} style={{ background: bodyColor(seat.userId, palette, seat.isSelf) }} />
          <span className={surfaceStyles.seatName}>{seat.displayName || t('unknown')}</span>
          <span className={surfaceStyles.seatState}>
            {seat.isSelf ? t('you') : seat.kind === 'agent' ? t('agent') : seat.live ? t('inRoom') : t('onBoard')}
          </span>
        </div>
      ))}
      <RoomStationList instances={stations} onOpen={onOpenStation} />
    </div>
  );
}
