'use client';

import { useTranslations } from 'next-intl';
import {
  CanvasRailToggle,
  ChatSurfaceIcon,
  GraphSurfaceIcon,
  ThreeDIcon,
} from '@/components/canvas/CanvasCommands';
import {
  CANVAS_SURFACES,
  DEFAULT_CANVAS_SURFACE,
  type CanvasSurfaceId,
} from '@/lib/canvasSurfaces';
import styles from './CreationCanvas.module.css';

/**
 * The ONE control that picks the canvas surface.
 *
 * The board used to carry a single 3D toggle, duplicated between the desktop command
 * rail and the phone-sized action stack. Adding a second runtime by adding a second
 * toggle beside it would have given one decision two controls that can disagree — press
 * "chat" while 3D is lit and neither button can say what you are looking at. So the
 * decision is a list of surfaces with exactly one pressed, rendered once here and placed
 * in both chromes.
 *
 * Pressing the surface you are already on returns you to the board. That is what keeps
 * the 3D command a TOGGLE — the behaviour the rail has always had — without the registry
 * needing to know that 3D is special.
 *
 * The two variants differ only in button chrome: the desktop rail's commands are React
 * Flow `ControlButton`s (so they inherit the rail's own styling) and the phone stack's
 * are plain buttons the canvas stylesheet sizes. Which surfaces exist, what they are
 * called, which one is lit and what a press does are decided ONCE, above the split.
 */

const SURFACE_ICON: Record<CanvasSurfaceId, () => React.JSX.Element> = {
  chat: ChatSurfaceIcon,
  graph: GraphSurfaceIcon,
  scene3d: ThreeDIcon,
};

export interface CanvasSurfaceSwitcherProps {
  surface: CanvasSurfaceId;
  onChange: (surface: CanvasSurfaceId) => void;
  /** `rail` = the desktop command rail; `mobile` = the phone-sized action stack. */
  variant: 'rail' | 'mobile';
}

export function CanvasSurfaceSwitcher({ surface, onChange, variant }: CanvasSurfaceSwitcherProps) {
  const t = useTranslations('creationCanvas');
  const ordered = [...CANVAS_SURFACES].sort((a, b) => a.order - b.order);

  return <>{ordered.map((def) => {
    const Glyph = SURFACE_ICON[def.id];
    const pressed = surface === def.id;
    // A pressed surface hands the board back. Without it the lit command is inert, and
    // the only way out of 3D would be to know that "board" is where you came from.
    const press = () => onChange(pressed ? DEFAULT_CANVAS_SURFACE : def.id);
    // Stable accessible name — it names the surface, not the current state, so it does
    // not change under a screen reader when the mode flips.
    const label = t(`surface.${def.id}.label` as 'surface.chat.label');
    const activeTitle = t(`surface.${def.id}.active` as 'surface.chat.active');
    const inactiveTitle = t(`surface.${def.id}.enter` as 'surface.chat.enter');

    if (variant === 'mobile') {
      return <button
        key={def.id}
        type="button"
        className={styles.surfaceSwitcherButton}
        onClick={press}
        aria-pressed={pressed}
        aria-label={label}
        title={pressed ? activeTitle : inactiveTitle}
      ><Glyph /></button>;
    }

    return <CanvasRailToggle
      key={def.id}
      pressed={pressed}
      onClick={press}
      label={label}
      activeTitle={activeTitle}
      inactiveTitle={inactiveTitle}
    ><Glyph /></CanvasRailToggle>;
  })}</>;
}
