import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ROOM_FURNITURE_SPECS, type RoomFurniture } from '@builderforce/creation-canvas-contract';
import { uploadCanvasFile } from '@/lib/canvasMediaStore';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { ROTATE_STEP, type FurnitureDesigner } from './useFurnitureDesigner';
import styles from './room.module.css';

/** The axes a piece can be stretched along, by what kind of piece it is. */
function stretchAxes(item: RoomFurniture): ReadonlyArray<{ axis: 0 | 1 | 2; labelKey: 'pieceWidth' | 'pieceHeight' | 'pieceDepth' }> {
  const spec = ROOM_FURNITURE_SPECS[item.kind];
  // A board on a wall is as wide and as tall as you like; its depth is its frame.
  if (spec.wallMounted) return [{ axis: 0, labelKey: 'pieceWidth' }, { axis: 1, labelKey: 'pieceHeight' }];
  // Everything on the floor keeps its height — a taller table is not a table.
  return [{ axis: 0, labelKey: 'pieceWidth' }, { axis: 2, labelKey: 'pieceDepth' }];
}

const SCALE_MIN = 0.3;
const SCALE_MAX = 4;

/**
 * THE SELECTED PIECE — turn it, stretch it, colour it, put a picture on it, remove it.
 *
 * Every control writes through the designer (`useFurnitureDesigner`), which writes
 * through the contract's own mutations, so a colour cleared here is the same document
 * a colour never set was. A picture is uploaded to the workspace's own storage and
 * referenced by URL — never inlined into the design, which every collaborator re-reads.
 */
export function RoomPieceInspector({ designer, palette }: { designer: FurnitureDesigner; palette: RoomPalette }) {
  const t = useTranslations('creationCanvas.surface.room.design');
  const imageInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = designer.selected;

  if (!item) return <p className={styles.hint}>{t('noSelection')}</p>;
  const spec = ROOM_FURNITURE_SPECS[item.kind];
  const colour = item.color ?? spec.color ?? palette.table;

  const uploadImage = async (file: File) => {
    setBusy(true);
    setError(null);
    const uploaded = await uploadCanvasFile(file);
    setBusy(false);
    if (uploaded) designer.patchSelected({ imageUrl: uploaded.url });
    else setError(t('uploadFailed'));
  };

  return (
    <>
      <strong>{t(`kind.${item.kind}`)}</strong>
      {!spec.wallMounted && (
        <div className={styles.row}>
          <button type="button" className={styles.action} onClick={() => designer.rotateSelected(-ROTATE_STEP)}>{t('rotateLeft')}</button>
          <button type="button" className={styles.action} onClick={() => designer.rotateSelected(ROTATE_STEP)}>{t('rotateRight')}</button>
        </div>
      )}
      {stretchAxes(item).map(({ axis, labelKey }) => (
        <label key={axis} className={styles.field}>
          <span>{t(labelKey)}</span>
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.05}
            value={item.scale[axis]}
            onChange={(event) => {
              const next: [number, number, number] = [...item.scale];
              next[axis] = Number(event.target.value);
              designer.patchSelected({ scale: next });
            }}
          />
        </label>
      ))}
      <label className={styles.field}>
        <span>{t('color')}</span>
        <span className={styles.row}>
          <input type="color" value={colour} onChange={(event) => designer.patchSelected({ color: event.target.value })} />
          {item.color && <button type="button" className={styles.action} onClick={() => designer.patchSelected({ color: undefined })}>{t('resetColor')}</button>}
        </span>
      </label>
      {spec.takesImage && (
        <>
          <label className={styles.field}>
            <span>{t('image')}</span>
            <input
              type="url"
              inputMode="url"
              value={item.imageUrl ?? ''}
              placeholder={t('imagePlaceholder')}
              onChange={(event) => designer.patchSelected({ imageUrl: event.target.value.trim() || undefined })}
            />
          </label>
          <div className={styles.row}>
            <button type="button" className={styles.action} disabled={busy} onClick={() => imageInput.current?.click()}>
              {busy ? t('uploading') : t('uploadImage')}
            </button>
            {item.imageUrl && <button type="button" className={styles.action} onClick={() => designer.patchSelected({ imageUrl: undefined })}>{t('clearImage')}</button>}
          </div>
          <input
            ref={imageInput}
            className={styles.fileInput}
            type="file"
            accept="image/*"
            aria-label={t('uploadImage')}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadImage(file); }}
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
        </>
      )}
      <button type="button" className={styles.danger} onClick={designer.removeSelected}>{t('remove')}</button>
    </>
  );
}
