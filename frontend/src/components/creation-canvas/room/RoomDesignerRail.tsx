import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ROOM_FURNITURE_KINDS, ROOM_LAYOUT_PRESETS, canvasRoomDesignFrom, roomDesignSummary,
  updateRoomFloor, updateRoomWall, type RoomFurnitureKind, type RoomModelFormat,
} from '@builderforce/creation-canvas-contract';
import { uploadCanvasFile } from '@/lib/canvasMediaStore';
import { meshFormatFromHint } from '@/lib/creativeGeometry';
import { downloadJson } from '@/lib/download';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { RoomPieceInspector } from './RoomPieceInspector';
import type { FurnitureDesigner } from './useFurnitureDesigner';
import type { RoomDesignState } from './useRoomDesign';
import styles from './room.module.css';

/** Everything a person can place by pressing a tile. An uploaded model has its own button. */
const FURNITURE_TILES: readonly RoomFurnitureKind[] = ROOM_FURNITURE_KINDS.filter((kind) => kind !== 'model');
const MODEL_ACCEPT = '.stl,.obj,.gltf,.glb,.step,.stp';

function numberIn(value: string, min: number, max: number): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

/**
 * THE ROOM DESIGNER — the rail that replaces the roster while the reader designs.
 *
 * Five things above a pinned Share footer, in the order a person designing a room
 * reaches for them: which room this session meets in, a layout to start from,
 * furniture to add (or a model of their own to upload), the piece in hand, and the
 * room's own walls and floor. Download / Upload / Sell stay fixed at the bottom of
 * the rail (outside the scrolling middle) so they never scroll off a typical
 * viewport. It says what the room holds before anything else (seats, pieces, floor
 * area), because "will we all fit" is the first question about any room.
 *
 * Mounted only for a viewer who can edit the board (the surface asks the design hook);
 * every write goes through the board, so undo and collaborators see it as any edit.
 */
export function RoomDesignerRail({ room, designer, palette, onPublishRoom }: {
  room: RoomDesignState;
  designer: FurnitureDesigner;
  palette: RoomPalette;
  onPublishRoom?: ((roomObjectId: string) => void) | undefined;
}) {
  const t = useTranslations('creationCanvas.surface.room.design');
  const modelInput = useRef<HTMLInputElement>(null);
  const designInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const design = designer.shown;
  const summary = roomDesignSummary(design);
  const layoutName = (layout: string) => t(`layout.${ROOM_LAYOUT_PRESETS.some((preset) => preset.id === layout) ? layout : 'custom'}`);

  const uploadModel = async (file: File) => {
    setError(null);
    const format = meshFormatFromHint(file.name) as RoomModelFormat | null;
    if (!format) { setError(t('modelFormat')); return; }
    setBusy(true);
    const uploaded = await uploadCanvasFile(file);
    setBusy(false);
    if (uploaded) designer.add('model', { model: { url: uploaded.url, format } });
    else setError(t('uploadFailed'));
  };

  const uploadDesign = async (file: File) => {
    setError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !('furniture' in parsed)) throw new Error('not a room');
      room.change(canvasRoomDesignFrom(parsed));
    } catch {
      setError(t('uploadDesignFailed'));
    }
  };

  const title = room.active?.title || layoutName(design.layout);

  return (
    <aside className={styles.designer} aria-label={t('rail')} data-testid="room-designer">
      <div className={styles.designerScroll}>
      <section className={styles.section}>
        <h4 className={styles.sectionHead}>{t('rooms')}</h4>
        <p className={styles.status} role="status">{t('summary', { seats: summary.seats, pieces: summary.pieces, area: Math.round(summary.area) })}</p>
        {room.rooms.length === 0 && <p className={styles.hint}>{t('standupNote')}</p>}
        {room.rooms.length > 1 && room.rooms.map((candidate) => (
          <div key={candidate.id} className={styles.roomRow}>
            <span className={styles.roomName}>
              <strong>{candidate.title || layoutName(candidate.layout)}</strong>
              <small>{t('summary', { seats: candidate.seats, pieces: candidate.pieces, area: Math.round(candidate.design.floor.width * candidate.design.floor.depth) })}</small>
            </span>
            <button
              type="button"
              className={styles.action}
              aria-pressed={room.active?.id === candidate.id}
              disabled={room.active?.id === candidate.id}
              onClick={() => room.choose(candidate.id)}
            >
              {room.active?.id === candidate.id ? t('meetingHere') : t('meetHere')}
            </button>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionHead}>{t('presets')}</h4>
        <div className={styles.tiles}>
          {ROOM_LAYOUT_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className={styles.tile} aria-pressed={design.layout === preset.id} onClick={() => room.applyPreset(preset.id)}>
              {t(`layout.${preset.id}`)}
            </button>
          ))}
        </div>
        <p className={styles.hint}>{t('presetHint')}</p>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionHead}>{t('furniture')}</h4>
        <div className={styles.tiles}>
          {FURNITURE_TILES.map((kind) => (
            <button key={kind} type="button" className={styles.tile} data-testid={`room-add-${kind}`} onClick={() => designer.add(kind)}>
              {t(`kind.${kind}`)}
            </button>
          ))}
        </div>
        <button type="button" className={styles.action} disabled={busy} onClick={() => modelInput.current?.click()}>
          {busy ? t('uploading') : t('uploadModel')}
        </button>
        <p className={styles.hint}>{t('uploadModelHint')}</p>
        <input
          ref={modelInput}
          className={styles.fileInput}
          type="file"
          accept={MODEL_ACCEPT}
          aria-label={t('uploadModel')}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadModel(file); }}
        />
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionHead}>{t('selected')}</h4>
        <RoomPieceInspector designer={designer} palette={palette} />
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionHead}>{t('room')}</h4>
        <label className={styles.field}>
          <span>{t('floorWidth')}</span>
          <input type="number" min={6} max={60} step={0.5} value={design.floor.width} onChange={(event) => { const n = numberIn(event.target.value, 6, 60); if (n !== null) room.change(updateRoomFloor(design, { width: n })); }} />
        </label>
        <label className={styles.field}>
          <span>{t('floorDepth')}</span>
          <input type="number" min={6} max={60} step={0.5} value={design.floor.depth} onChange={(event) => { const n = numberIn(event.target.value, 6, 60); if (n !== null) room.change(updateRoomFloor(design, { depth: n })); }} />
        </label>
        <label className={styles.field}>
          <span>{t('wallHeight')}</span>
          <input type="number" min={2.4} max={10} step={0.1} value={design.wall.height} onChange={(event) => { const n = numberIn(event.target.value, 2.4, 10); if (n !== null) room.change(updateRoomWall(design, { height: n })); }} />
        </label>
        <label className={styles.field}>
          <span>{t('floorColor')}</span>
          <input type="color" value={design.floor.color ?? palette.floor} onChange={(event) => room.change(updateRoomFloor(design, { color: event.target.value }))} />
        </label>
        <label className={styles.field}>
          <span>{t('wallColor')}</span>
          <input type="color" value={design.wall.color ?? palette.wall} onChange={(event) => room.change(updateRoomWall(design, { color: event.target.value }))} />
        </label>
        {(design.floor.color || design.wall.color) && (
          <button type="button" className={styles.action} onClick={() => room.change(updateRoomWall(updateRoomFloor(design, { color: undefined }), { color: undefined }))}>
            {t('resetColors')}
          </button>
        )}
      </section>

      </div>

      <section className={`${styles.section} ${styles.designerShare}`} data-testid="room-designer-share">
        <h4 className={styles.sectionHead}>{t('share')}</h4>
        {room.active && onPublishRoom
          ? <>
            <button type="button" className={styles.action} onClick={() => onPublishRoom(room.active!.id)}>{t('sell')}</button>
            <p className={styles.hint}>{t('sellHint')}</p>
          </>
          : <p className={styles.hint}>{t('saveFirst')}</p>}
        <div className={styles.row}>
          <button type="button" className={styles.action} onClick={() => downloadJson(design, `${title.replace(/[^\w-]+/g, '-').toLowerCase() || 'room'}.room.json`)}>{t('download')}</button>
          <button type="button" className={styles.action} onClick={() => designInput.current?.click()}>{t('uploadDesign')}</button>
        </div>
        <input
          ref={designInput}
          className={styles.fileInput}
          type="file"
          accept="application/json,.json"
          aria-label={t('uploadDesign')}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadDesign(file); }}
        />
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    </aside>
  );
}
