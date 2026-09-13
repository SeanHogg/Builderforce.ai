import { memo, useState, type CSSProperties } from 'react'
import { useT } from '../../../i18n'
import { Avatar } from '../../ui/Avatar'
import { Icon } from '../../ui/Icon'
import surfaceStyles from '../CanvasRoomSurface.module.css'
import type { RoomSeat } from '../types'

type RoomRosterProps = {
  seats: RoomSeat[]
  style?: CSSProperties
}

/** Side panel listing everyone present in the room, plus the session's stations. Collapsible via the header chevron. */
export const RoomRoster = memo(function RoomRoster({ seats, style }: RoomRosterProps) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const stations = seats.flatMap((seat) => seat.stations)
  const toggleLabel = t(collapsed ? 'expandRoster' : 'collapseRoster')
  return (
    <aside className={surfaceStyles.roster} style={style}>
      <div className={surfaceStyles.rosterHeadRow}>
        <p className={surfaceStyles.rosterHead}>{t('rosterHead', { count: seats.length })}</p>
        <button
          type="button"
          className={`${surfaceStyles.rosterToggle} ${collapsed ? surfaceStyles.rosterToggleCollapsed : ''}`}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
      {collapsed ? null : (
        <>
          <ul className={surfaceStyles.rosterList}>
            {seats.map((seat) => (
              <li key={seat.id} className={surfaceStyles.rosterRow}>
                <span className={surfaceStyles.rosterWho}>
                  <Avatar name={seat.label} tone={seat.tone} size={18} presence={seat.presence} />
                  <span className={surfaceStyles.rosterName}>{seat.label}</span>
                </span>
                <span className={surfaceStyles.rosterMeta}>
                  {seat.you ? t('you') : seat.kind === 'agent' ? t('agent') : t('inRoom')}
                </span>
              </li>
            ))}
          </ul>
          {stations.length > 0 ? (
            <>
              <p className={surfaceStyles.rosterHead}>{t('stationsInRoom')}</p>
              <ul className={surfaceStyles.stationList}>
                {stations.map((station) => (
                  <li key={station.id} className={surfaceStyles.stationRow}>
                    <span className={surfaceStyles.stationInfo}>
                      <strong>{station.title}</strong>
                      <small>{station.detail}</small>
                    </span>
                    {station.action ? (
                      <button type="button" className={surfaceStyles.stationAction}>
                        {station.action}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </aside>
  )
})
