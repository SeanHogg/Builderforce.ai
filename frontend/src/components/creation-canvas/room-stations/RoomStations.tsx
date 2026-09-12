/*
 * No `'use client'` — imported only by `CanvasRoomSurface`, which is reached through a
 * `dynamic(..., { ssr: false })` import from the canvas that declares the boundary.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { roomStationInstances, type RoomStationInstance } from '@/lib/canvas/roomStations';
import { useCanvasBoardBridge } from '../canvasBoardBridge';
import { ROOM_STATION_VIEWS } from './registry';
import { RoomStationStand } from './RoomStationStand';
import styles from './roomStations.module.css';

/**
 * The room's STATIONS, in the three places the room shows them:
 *  • standing in the 3D scene ({@link RoomStationStands}) — walk up, read the face;
 *  • listed beside the roster ({@link RoomStationList}) — the keyboard and screen-reader
 *    path to every station, and the whole room on a device without WebGL;
 *  • open, in a slide-out panel ({@link RoomStationPanel}) — the full 2D reading.
 *
 * Every one of them asks the station's own hook for its model, so a station the viewer
 * is not entitled to is absent from all three at once rather than standing in the room
 * with a panel that refuses to open.
 */

/** Every station standing in the room for the board on stage. */
export function useRoomStationInstances(): RoomStationInstance[] {
  const board = useCanvasBoardBridge();
  const objects = board?.objects;
  return useMemo(
    () => (objects ? roomStationInstances(objects).filter((instance) => ROOM_STATION_VIEWS[instance.station]) : []),
    [objects],
  );
}

interface StandsProps {
  instances: readonly RoomStationInstance[];
  sessionId: string;
  palette: RoomPalette;
  openKey: string | null;
  onOpen: (key: string) => void;
  onDragChange: (dragging: boolean) => void;
}

function StationStand({ instance, index, sessionId, palette, openKey, onOpen, onDragChange }: Omit<StandsProps, 'instances'> & { instance: RoomStationInstance; index: number }) {
  const t = useTranslations('roomStations');
  const model = ROOM_STATION_VIEWS[instance.station]!.useModel(instance, openKey === instance.key);
  if (!model) return null;
  return (
    <RoomStationStand
      sessionId={sessionId}
      stationKey={instance.key}
      index={index}
      palette={palette}
      title={model.title}
      hint={t('dragHint', { summary: model.summary })}
      face={model.face}
      open={{
        label: t('open'),
        name: t('openNamed', { title: model.title }),
        testId: 'room-station-open',
        onOpen: () => onOpen(instance.key),
      }}
      onDragChange={onDragChange}
    />
  );
}

/** Inside the scene. Keyed by the instance, so each station's hook order is its own. */
export function RoomStationStands({ instances, ...rest }: StandsProps) {
  return <>{instances.map((instance, index) => <StationStand key={instance.key} instance={instance} index={index} {...rest} />)}</>;
}

function StationRow({ instance, onOpen }: { instance: RoomStationInstance; onOpen: (key: string) => void }) {
  const t = useTranslations('roomStations');
  const model = ROOM_STATION_VIEWS[instance.station]!.useModel(instance, false);
  if (!model) return null;
  return (
    <li className={styles.row} data-testid="room-station">
      <span className={styles.rowName}>
        <strong>{model.title}</strong>
        <small>{model.summary}</small>
      </span>
      <button
        type="button"
        className={styles.rowOpen}
        onClick={() => onOpen(instance.key)}
        aria-label={t('openNamed', { title: model.title })}
      >
        {t('open')}
      </button>
    </li>
  );
}

/** Beside the roster. The heading hides itself when no row rendered (see the stylesheet). */
export function RoomStationList({ instances, onOpen }: { instances: readonly RoomStationInstance[]; onOpen: (key: string) => void }) {
  const t = useTranslations('roomStations');
  if (!instances.length) return null;
  return (
    <section className={styles.list} aria-label={t('listHead')}>
      <p className={styles.listHead}>{t('listHead')}</p>
      <ul className={styles.rows}>
        {instances.map((instance) => <StationRow key={instance.key} instance={instance} onOpen={onOpen} />)}
      </ul>
    </section>
  );
}

function OpenStation({ instance, onClose }: { instance: RoomStationInstance; onClose: () => void }) {
  const view = ROOM_STATION_VIEWS[instance.station]!;
  const model = view.useModel(instance, true);
  if (!model) return null;
  const Panel = view.Panel;
  return (
    <SlideOutPanel open onClose={onClose} title={model.title} width="wide" widthStorageKey="room-station">
      <Panel instance={instance} />
    </SlideOutPanel>
  );
}

/** The open station's 2D reading. Keyed by the station so switching remounts cleanly. */
export function RoomStationPanel({ instance, onClose }: { instance: RoomStationInstance | null; onClose: () => void }) {
  if (!instance || !ROOM_STATION_VIEWS[instance.station]) return null;
  return <OpenStation key={instance.key} instance={instance} onClose={onClose} />;
}
