import { useTranslations } from 'next-intl';
import type { CanvasWorldPropKind } from '@builderforce/creation-canvas-contract';
import styles from '../CreationCanvas.module.css';

/**
 * PropPalette — left-rail drag source for `world` surfaces. Dropping a tile
 * onto the 3D viewport places that kind at the cursor's world-space hit
 * point (the drop receiver lives in `CanvasWorldView.tsx`, the only place
 * that knows the R3F camera + ground plane geometry needed to raycast it).
 *
 * Adapted from hired.video's `world-3d/EntityPaletteLeft.tsx`: same
 * drag-and-drop interaction and kind catalog, restyled onto this canvas's
 * CSS-module chrome and localized instead of hardcoded English labels. The
 * `weapon` kind and its glyph-icon tiles were dropped with the shoot
 * mechanic (out of scope — see `world.ts`'s header).
 */

interface PaletteGroup {
  id: 'building' | 'zones' | 'props' | 'fx';
  kinds: readonly CanvasWorldPropKind[];
}

const GROUPS: readonly PaletteGroup[] = [
  { id: 'building', kinds: ['block', 'ramp', 'platform'] },
  { id: 'zones', kinds: ['collectible', 'goal', 'hazard'] },
  { id: 'props', kinds: ['sphere'] },
  { id: 'fx', kinds: ['light'] },
];

/** Monochrome glyph per kind — matches the object registry's own convention
 *  of plain Unicode marks rather than color emoji. */
const KIND_GLYPH: Record<CanvasWorldPropKind, string> = {
  block: '■', ramp: '◢', sphere: '●', platform: '▬', collectible: '◆', goal: '⚑', hazard: '▲', light: '☼',
};

/** DataTransfer MIME for the drag payload. Custom type (not a standard MIME)
 *  so a stray drop from outside the app never accidentally places a prop. */
export const PROP_DRAG_MIME = 'application/x-canvas-world-kind';

export default function PropPalette() {
  const t = useTranslations('creationCanvas.surface.world');

  return (
    <div className={styles.worldPalette}>
      <p className={styles.worldPaletteHint}>{t('palette.hint')}</p>
      {GROUPS.map((group) => (
        <section key={group.id} className={styles.worldPaletteGroup}>
          <h4 className={styles.worldPaletteGroupTitle}>{t(`palette.group.${group.id}`)}</h4>
          <div className={styles.worldPaletteTiles}>
            {group.kinds.map((kind) => <PaletteTile key={kind} kind={kind} label={t(`palette.kind.${kind}`)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function PaletteTile({ kind, label }: { kind: CanvasWorldPropKind; label: string }) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(PROP_DRAG_MIME, kind);
        event.dataTransfer.setData('text/plain', kind);
      }}
      className={styles.worldPaletteTile}
      title={label}
      role="button"
      aria-label={label}
    >
      <span aria-hidden>{KIND_GLYPH[kind]}</span>
      <span>{label}</span>
    </div>
  );
}
