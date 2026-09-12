import { useTranslations } from 'next-intl';
import { pressKey, releaseKey } from './walkerInput';
import styles from './walkerTouchControls.module.css';

/**
 * An on-screen pad for walking without a keyboard — a phone, a tablet, a laptop
 * whose owner would rather tap.
 *
 * Each button presses the SAME key the keyboard would (`walkerInput.ts`), so the
 * controller cannot tell them apart and there is one movement model, not two. A
 * pointer that leaves a button mid-press releases it: a finger that slid off
 * "forward" must not leave the walker running into a wall.
 *
 * Shown only on a coarse pointer by its stylesheet — a mouse-and-keyboard reader
 * never sees it — and never in the way of the scene, because it is fixed to the
 * viewport's lower corners with `pointer-events` only on the buttons themselves.
 * Decides its own visibility: nothing in a host has to know whether this device
 * needs it.
 */

const PAD: ReadonlyArray<{ code: string; labelKey: 'forward' | 'back' | 'left' | 'right' | 'jump'; glyph: string; slot: string }> = [
  { code: 'KeyW', labelKey: 'forward', glyph: '▲', slot: 'up' },
  { code: 'KeyA', labelKey: 'left', glyph: '◀', slot: 'left' },
  { code: 'KeyD', labelKey: 'right', glyph: '▶', slot: 'right' },
  { code: 'KeyS', labelKey: 'back', glyph: '▼', slot: 'down' },
  { code: 'Space', labelKey: 'jump', glyph: '⤒', slot: 'jump' },
];

export function WalkerTouchControls() {
  const t = useTranslations('creationCanvas.surface.world.touch');
  return (
    <div className={styles.pad} aria-label={t('label')} role="group">
      {PAD.map((button) => (
        <button
          key={button.code}
          type="button"
          className={styles.button}
          data-slot={button.slot}
          aria-label={t(button.labelKey)}
          onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pressKey(button.code); }}
          onPointerUp={() => releaseKey(button.code)}
          onPointerCancel={() => releaseKey(button.code)}
          onPointerLeave={() => releaseKey(button.code)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span aria-hidden>{button.glyph}</span>
        </button>
      ))}
    </div>
  );
}
