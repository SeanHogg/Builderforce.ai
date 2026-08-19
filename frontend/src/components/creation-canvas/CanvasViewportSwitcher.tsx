/*
 * No `'use client'`: only ever rendered by surfaces `CreationCanvas.tsx` already draws
 * inside its own client boundary, and a second directive would add an entry point the
 * architecture ratchet counts but nothing imports.
 */
import { useTranslations } from 'next-intl';
import { ViewportDesktopIcon, ViewportMobileIcon, ViewportTabletIcon } from '@/components/canvas/CanvasCommands';
import { CANVAS_VIEWPORTS, type CanvasViewport } from '@/lib/canvasViewport';
import styles from './CreationCanvas.module.css';

/**
 * THE width switcher — "which width is the reader checking?" — drawn once.
 *
 * It existed twice: the App surface published one into the command bar and the Site
 * surface drew another in its own header, with two copies of the same three buttons, two
 * copies of the same segmented trough in the stylesheet, and two sets of catalogue keys
 * (`surface.app.viewportName.*` and `surface.site.desktop`) that could drift into calling
 * the same width two different things in the same product. A third surface with a preview
 * would have made three. The WIDTHS behind the words are `lib/canvasViewport`, shared with
 * the live web page panel, for the same reason.
 *
 * The VALUE stays with the caller. What the reader is checking is not what the artifact
 * IS — the Site surface's own header says why `data.viewport` must not be re-authored by
 * a glance at a phone frame — so this component owns the control and never the state.
 *
 * Icons, not words: this renders into a bar whose every other control is a 15px glyph, and
 * three worded buttons beside three more worded readings is what wrapped that bar onto a
 * second row. The words survive as the accessible name and the tooltip.
 */
export interface CanvasViewportSwitcherProps {
  value: CanvasViewport;
  onChange: (viewport: CanvasViewport) => void;
}

const VIEWPORT_ICON: Record<CanvasViewport, () => React.ReactElement> = {
  desktop: ViewportDesktopIcon,
  tablet: ViewportTabletIcon,
  mobile: ViewportMobileIcon,
};

export function CanvasViewportSwitcher({ value, onChange }: CanvasViewportSwitcherProps) {
  const t = useTranslations('creationCanvas');
  return (
    <div className={styles.segmentedGroup} role="group" aria-label={t('previewWidth')}>
      {CANVAS_VIEWPORTS.map((option) => {
        const Glyph = VIEWPORT_ICON[option];
        const name = t(`viewportName.${option}` as 'viewportName.desktop');
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            aria-label={name}
            title={name}
          ><Glyph /></button>
        );
      })}
    </div>
  );
}
