import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RoomPalette, RoomSeat } from '@/lib/canvas/roomSeating';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { RoomStationList } from '../room-stations/RoomStations';
import { RoomSeatMark } from './RoomSeatMark';
import { readRoomRosterCollapsed, writeRoomRosterCollapsed } from './roomRosterPreferences';
import surfaceStyles from '../CanvasRoomSurface.module.css';

/**
 * WHO IS IN THE ROOM, and what stands in it — the rail beside the stage.
 *
 * The keyboard and screen-reader path to the room's people and stations, and on a
 * phone the strip under the stage. Every row reads the seat the room placed, so the
 * list and the bodies can never disagree about who is here.
 *
 * Collapsible from the chevron in its header: collapsed, the rail narrows to the
 * chevron alone (`.rosterCollapsed`) so the stage gets the width back.
 */
export function RoomRoster({ seats, palette, stations, onOpenStation }: {
  seats: readonly RoomSeat[];
  palette: RoomPalette;
  stations: readonly RoomStationInstance[];
  onOpenStation: (key: string) => void;
}) {
  const t = useTranslations('creationCanvas.surface.room');
  const [collapsed, setCollapsed] = useState(readRoomRosterCollapsed);
  const toggleLabel = t(collapsed ? 'expandRoster' : 'collapseRoster');
  return (
    <div
      className={`${surfaceStyles.roster} ${collapsed ? surfaceStyles.rosterCollapsed : ''}`}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className={surfaceStyles.rosterHeadRow}>
        <p className={surfaceStyles.rosterHead}>{t('rosterHead', { count: seats.length })}</p>
        <button
          type="button"
          className={`${surfaceStyles.rosterToggle} ${collapsed ? surfaceStyles.rosterToggleCollapsed : ''}`}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeRoomRosterCollapsed(next);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
      </div>
      {seats.map((seat) => (
        <div key={seat.userId} className={surfaceStyles.seat} data-live={seat.present ? 'true' : 'false'} data-kind={seat.kind}>
          <RoomSeatMark seat={seat} palette={palette} />
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
